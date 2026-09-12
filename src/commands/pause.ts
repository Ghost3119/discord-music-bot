import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';

export const pause: Command = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pausa la canción actual') as SlashCommandBuilder,

  async execute(interaction) {
    const guild = await ensureGuild(interaction);
    if (!guild) return;

    const distube = interaction.client.distube;
    const queue = distube.getQueue(guild.id);

    if (!queue) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (queue.paused) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(BotColors.Warning).setDescription('⏸️ La música ya está pausada.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    distube.pause(guild.id);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(BotColors.Warning).setDescription('⏸️ Música pausada. Usa `/resume` para reanudar.')],
    });
  },
};