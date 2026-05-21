import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { createNowPlayingEmbed, createPlayerButtons } from '../utils/embed';

export const nowplaying: Command = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Muestra la canción actual con progreso') as SlashCommandBuilder,

  async execute(interaction) {
    const distube = interaction.client.distube;
    const queue = distube.getQueue(interaction.guild!.id);

    if (!queue || !queue.songs[0]) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ No hay música reproduciéndose.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const song = queue.songs[0];
    const currentTime = queue.currentTime ?? 0;

    const embed = createNowPlayingEmbed(song, currentTime * 1000);
    const row = createPlayerButtons(queue.paused);

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};
