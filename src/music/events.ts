import { DisTube, Events, InfoExtractorPlugin, Playlist, Queue, Song } from 'distube';
import { EmbedBuilder } from 'discord.js';
import { createNowPlayingEmbed, createAddQueueEmbed, createPlayerButtons } from '../utils/embed';
import { BotColors } from '../utils/colors';
import { PLAYLIST_SEARCH_WARM_LIMIT, YtDlpSearchPlugin } from './ytDlpSearchPlugin';

const EMPTY_TIMEOUT_MS = 60_000;

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
  const emptyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  distube.on(Events.PLAY_SONG, (queue, song) => {
    const embed = createNowPlayingEmbed(song);
    const row = createPlayerButtons(false);
    queue.textChannel?.send({ embeds: [embed], components: [row] });
    warmUpcomingSearchCache(distube, queue, song);

    const timer = emptyTimers.get(queue.id);
    if (timer) {
      clearTimeout(timer);
      emptyTimers.delete(queue.id);
    }
  });

  distube.on(Events.ADD_SONG, (queue, song) => {
    queue.textChannel?.send({ embeds: [createAddQueueEmbed(song)] });
  });

  distube.on(Events.ADD_LIST, (queue, playlist) => {
    queue.textChannel?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(BotColors.Info)
          .setDescription(`📚 Añadida playlist: **${playlist.name ?? 'Playlist'}** — \`${playlist.songs.length} canciones\``),
      ],
    });
    warmPlaylistSearchCache(distube, playlist);
  });

  distube.on(Events.DISCONNECT, (queue) => {
    queue.textChannel?.send({
      embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('🔌 Desconectado del canal de voz.')],
    });
    const timer = emptyTimers.get(queue.id);
    if (timer) {
      clearTimeout(timer);
      emptyTimers.delete(queue.id);
    }
  });

  (distube as DisTube).on('empty' as keyof import('distube').DisTubeEvents, (queue: Queue) => {
    const timer = setTimeout(() => {
      emptyTimers.delete(queue.id);
      const currentQueue = distube.getQueue(queue.id);
      if (currentQueue) {
        currentQueue.stop();
        queue.textChannel?.send({
          embeds: [
            new EmbedBuilder()
              .setColor(BotColors.Warning)
              .setDescription('🔇 Canal vacío por 1 minuto — desconectando.'),
          ],
        });
      }
    }, EMPTY_TIMEOUT_MS);
    emptyTimers.set(queue.id, timer);
  });

  distube.on(Events.ERROR, (error, queue) => {
    console.error('DisTube Error:', error);
    queue.textChannel?.send({
      embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription(`❌ Error: ${error.message ?? 'Error desconocido'}`)],
    });
  });

  distube.on(Events.DEBUG, (msg) => {
    if (msg.includes('QueueManager') || msg.includes('Voice') || msg.includes('voice') || msg.includes('join')) {
      console.log(`[DisTube Debug] ${msg}`);
    }
  });

  distube.on(Events.NO_RELATED, (queue) => {
    queue.textChannel?.send({
      embeds: [new EmbedBuilder().setColor(BotColors.Warning).setDescription('🔇 No se encontraron canciones relacionadas.')],
    });
  });
}
