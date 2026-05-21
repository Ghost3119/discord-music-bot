import { DisTube, Events, InfoExtractorPlugin, Playlist, Queue, Song } from 'distube';
import { EmbedBuilder } from 'discord.js';
import { createNowPlayingEmbed, createAddQueueEmbed, createPlayerButtons } from '../utils/embed';
import { PLAYLIST_SEARCH_WARM_LIMIT, YtDlpSearchPlugin } from './ytDlpSearchPlugin';

function findSearchPlugin(distube: DisTube): YtDlpSearchPlugin | undefined {
  return distube.plugins.find((plugin): plugin is YtDlpSearchPlugin => plugin instanceof YtDlpSearchPlugin);
}

async function getSearchQuery(song: Song): Promise<string | null> {
  if (song.stream.playFromSource) return null;
  if (song.plugin instanceof InfoExtractorPlugin) {
    return song.plugin.createSearchQuery(song);
  }
  return song.name ?? null;
}

function warmSongSearchCache(distube: DisTube, songs: Song[], metadata: unknown): void {
  const searchPlugin = findSearchPlugin(distube);
  if (!searchPlugin || songs.length === 0) return;

  void (async () => {
    try {
      const queries = await Promise.all(songs.slice(0, PLAYLIST_SEARCH_WARM_LIMIT).map(getSearchQuery));
      await searchPlugin.warmSearchCache(
        queries.filter((query): query is string => typeof query === 'string' && query.trim().length > 0),
        metadata,
      );
    } catch (error) {
      console.warn('No se pudo precalentar el cache de busquedas:', error);
    }
  })();
}

function warmUpcomingSearchCache(distube: DisTube, queue: Queue, currentSong: Song): void {
  warmSongSearchCache(distube, queue.songs.slice(1), currentSong.metadata);
}

function warmPlaylistSearchCache(distube: DisTube, playlist: Playlist): void {
  warmSongSearchCache(distube, playlist.songs, playlist.metadata);
}

export function registerDisTubeEvents(distube: DisTube) {
  distube.on(Events.PLAY_SONG, (queue, song) => {
    const embed = createNowPlayingEmbed(song);
    const row = createPlayerButtons(false);
    queue.textChannel?.send({ embeds: [embed], components: [row] });
    warmUpcomingSearchCache(distube, queue, song);
  });

  distube.on(Events.ADD_SONG, (queue, song) => {
    queue.textChannel?.send({ embeds: [createAddQueueEmbed(song)] });
  });

  distube.on(Events.ADD_LIST, (queue, playlist) => {
    queue.textChannel?.send({
      embeds: [
        new EmbedBuilder()
          .setColor('#5865F2')
          .setDescription(`📚 Añadida playlist: **${playlist.name ?? 'Playlist'}** — \`${playlist.songs.length} canciones\``),
      ],
    });
    warmPlaylistSearchCache(distube, playlist);
  });

  distube.on(Events.DISCONNECT, (queue) => {
    queue.textChannel?.send({
      embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('🔌 Desconectado del canal de voz.')],
    });
  });

  distube.on(Events.ERROR, (error, queue) => {
    console.error('DisTube Error:', error);
    queue.textChannel?.send({
      embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error: ${error.message ?? 'Error desconocido'}`)],
    });
  });

  distube.on(Events.NO_RELATED, (queue) => {
    queue.textChannel?.send({
      embeds: [new EmbedBuilder().setColor('#FFA500').setDescription('🔇 No se encontraron canciones relacionadas.')],
    });
  });
}
