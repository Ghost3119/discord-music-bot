import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Song } from 'distube';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';
import { YtDlpSearchPlugin } from '../music/ytDlpSearchPlugin';

const MAX_RECOMMENDATIONS = 20;

export function selectRecommendations(candidates: Song[], excluded: Song[], amount: number): Song[] {
  const seenIds = new Set(excluded.map((song) => song.id));
  const seenUrls = new Set(excluded.map((song) => song.url).filter((url): url is string => Boolean(url)));
  const selected: Song[] = [];

  for (const song of candidates) {
    if (seenIds.has(song.id) || (song.url && seenUrls.has(song.url))) continue;
    selected.push(song);
    seenIds.add(song.id);
    if (song.url) seenUrls.add(song.url);
    if (selected.length >= amount) break;
  }

  return selected;
}

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
      const seeds = [current, queue.songs[queue.songs.length - 1]]
        .filter((song): song is Song => Boolean(song))
        .filter((song, index, songs) => songs.findIndex((item) => item.id === song.id) === index);
      const candidates: Song[] = [];

      for (const seed of seeds) {
        try {
          candidates.push(...await plugin.getRecommendations(seed));
        } catch (error) {
          console.warn(`No se pudo consultar YouTube Mix para ${seed.name ?? seed.id}:`, error);
        }
        if (selectRecommendations(candidates, [...queue.songs, ...queue.previousSongs], amount).length >= amount) break;
      }

      if (interaction.client.distube.getQueue(guild.id) !== queue || queue.stopped) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(BotColors.Warning).setDescription('La cola terminó mientras buscaba recomendaciones.')],
        });
        return;
      }

      const selected = selectRecommendations(candidates, [...queue.songs, ...queue.previousSongs], amount);
      if (!selected.length) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(BotColors.Warning).setDescription('No encontré recomendaciones nuevas para esta cola.')],
        });
        return;
      }

      for (const song of selected) song.member = member;
      queue.addToQueue(selected);
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(BotColors.Info)
          .setDescription(`🎵 Añadidas **${selected.length}** recomendaciones a la cola.`)],
      });
    } catch (error) {
      console.error('Error en /recommend:', error);
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No pude obtener recomendaciones ahora mismo.')],
      });
    }
  },
};
