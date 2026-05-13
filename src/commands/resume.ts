import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';

export const resume: Command = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Reanuda la canción pausada') as SlashCommandBuilder,

  async execute(interaction) {
    const distube = interaction.client.distube;
    const queue = distube.getQueue(interaction.guild!.id);

    if (!queue) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ No hay música reproduciéndose.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!queue.paused) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor('#00FF00').setDescription('▶️ La música ya se está reproduciendo.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    distube.resume(interaction.guild!.id);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor('#00FF00').setDescription('▶️ Música reanudada.')],
    });
  },
};