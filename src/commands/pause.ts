import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';

export const pause: Command = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pausa la canción actual') as SlashCommandBuilder,

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

    if (queue.paused) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor('#FFA500').setDescription('⏸️ La música ya está pausada.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    distube.pause(interaction.guild!.id);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor('#FFA500').setDescription('⏸️ Música pausada. Usa `/resume` para reanudar.')],
    });
  },
};