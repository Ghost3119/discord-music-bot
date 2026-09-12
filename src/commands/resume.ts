import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';

export const resume: Command = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Reanuda la canción pausada') as SlashCommandBuilder,

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

    if (!queue.paused) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(BotColors.Success).setDescription('▶️ La música ya se está reproduciendo.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    distube.resume(guild.id);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(BotColors.Success).setDescription('▶️ Música reanudada.')],
    });
  },
};