import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { createNowPlayingEmbed } from '../utils/embed';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';
import { getPlayerPanels } from '../music/playerPanel';

export const nowplaying: Command = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Muestra la canción actual con progreso') as SlashCommandBuilder,

  async execute(interaction) {
    const guild = await ensureGuild(interaction);
    if (!guild) return;

    const distube = interaction.client.distube;
    const queue = distube.getQueue(guild.id);

    if (!queue || !queue.songs[0]) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const panels = getPlayerPanels(distube);
    await panels?.show(queue, queue.songs[0], true);
    if (distube.getQueue(guild.id) !== queue || queue.stopped || !queue.songs[0]) {
      await interaction.editReply({ content: '⌛ La sesión terminó. Usa `/nowplaying` para consultar la cola actual.' });
      return;
    }
    const url = panels?.url(queue);
    await interaction.editReply(url
      ? { content: `🎵 [Abrir el reproductor actual](${url})` }
      : { embeds: [createNowPlayingEmbed(queue.songs[0], queue.currentTime * 1000, {
        paused: queue.paused, volume: queue.volume, nextSong: queue.songs[1], queued: queue.songs.length - 1,
        autoplay: queue.autoplay, repeatMode: queue.repeatMode,
      })] });
  },
};
