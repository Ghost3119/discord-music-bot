import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';
import { YtDlpSearchPlugin } from '../music/ytDlpSearchPlugin';
import { MAX_RECOMMENDATIONS, recommendForQueue } from '../music/recommendations';
export { selectRecommendations } from '../music/recommendations';

export const recommend: Command = {
  data: new SlashCommandBuilder()
    .setName('recommend')
    .setDescription('Añade canciones de YouTube Mix basadas en la cola')
    .addIntegerOption((option) => option
      .setName('cantidad')
      .setDescription('Cantidad de canciones a añadir (1 a 20)')
      .setMinValue(1)
      .setMaxValue(MAX_RECOMMENDATIONS)) as SlashCommandBuilder,

  async execute(interaction) {
    const guild = await ensureGuild(interaction);
    if (!guild) return;

    const queue = interaction.client.distube.getQueue(guild.id);
    const current = queue?.songs[0];
    if (!queue || !current) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ Primero reproduce una canción.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = guild.members.cache.get(interaction.user.id);
    if (!member?.voice.channel || member.voice.channel.id !== queue.voiceChannel?.id) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ Debes estar en el mismo canal de voz que el bot.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const plugin = interaction.client.distube.plugins.find((item): item is YtDlpSearchPlugin => item instanceof YtDlpSearchPlugin);
    if (!plugin) throw new Error('No se encontró el extractor de YouTube.');

    const amount = interaction.options.getInteger('cantidad') ?? 5;
    await interaction.deferReply();
    try {
      const count = await recommendForQueue(interaction.client.distube, queue, plugin, member, amount);
      if (!count) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(BotColors.Warning).setDescription('No encontré recomendaciones nuevas para esta cola.')],
        });
        return;
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(BotColors.Info)
          .setDescription(`🎵 Añadidas **${count}** recomendaciones a la cola.`)],
      });
    } catch (error) {
      if (['SESSION_CHANGED', 'CONTROL_CHANNEL_REQUIRED'].includes((error as { errorCode?: string }).errorCode ?? '')) {
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BotColors.Warning).setDescription('La cola terminó o cambió, o cambiaste de canal de voz mientras buscaba recomendaciones.')] });
        return;
      }
      console.error('Error en /recommend:', error);
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No pude obtener recomendaciones ahora mismo.')],
      });
    }
  },
};
