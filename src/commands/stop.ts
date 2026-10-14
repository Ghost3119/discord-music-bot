import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { ensureControlChannel, ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';

export const stop: Command = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Detiene la música y desconecta al bot del canal'),

  async execute(interaction) {
    const guild = await ensureGuild(interaction);
    if (!guild) return;

    const distube = interaction.client.distube;
    const queue = distube.getQueue(guild.id);

    if (!queue) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    if (!await ensureControlChannel(interaction, queue)) return;
    if (distube.getQueue(guild.id) !== queue || queue.stopped) throw Object.assign(new Error('La sesión terminó mientras esperaba.'), { errorCode: 'SESSION_CHANGED' });
    await queue.stop();
    await interaction.editReply({
      embeds: [
        new EmbedBuilder().setColor(BotColors.Error).setDescription('⏹️ Música detenida. ¡Hasta luego!'),
      ],
    });
  },
};
