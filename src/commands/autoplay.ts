import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';
import { updateRadio } from '../music/recommendations';

export const autoplay: Command = {
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Activa o desactiva la radio al terminar la cola'),

  async execute(interaction) {
    const guild = await ensureGuild(interaction);
    if (!guild) return;

    const queue = interaction.client.distube.getQueue(guild.id);
    if (!queue?.songs[0]) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.')],
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

    const enabled = updateRadio(queue);
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(BotColors.Info)
        .setDescription(enabled
          ? '▶️ Radio activada. Al terminar la cola buscaré canciones relacionadas en YouTube.'
          : '⏹️ Radio desactivada.')],
    });
  },
};
