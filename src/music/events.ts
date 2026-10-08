import { DisTube, DisTubeEvents, TypedDisTubeEvents, Events, InfoExtractorPlugin, Playlist, Queue, Song } from 'distube';
import { EmbedBuilder } from 'discord.js';
import { createNowPlayingEmbed, createAddQueueEmbed, createPlayerButtons } from '../utils/embed';
import { BotColors } from '../utils/colors';
import { PLAYLIST_SEARCH_WARM_LIMIT, YtDlpSearchPlugin } from './ytDlpSearchPlugin';
import { observeStreamErrors } from './streamErrors';
import { describeMusicError } from './errors';
import { PlaybackRecovery } from './playbackRecovery';
import { guardedEvent } from '../runtime/safety';

function findSearchPlugin(distube: DisTube): YtDlpSearchPlugin | undefined {
  return distube.plugins?.find((plugin): plugin is YtDlpSearchPlugin => plugin instanceof YtDlpSearchPlugin);
}

async function getSearchQuery(song: Song): Promise<string | null> {
  if (song.stream.playFromSource) return null;
  if (song.plugin instanceof InfoExtractorPlugin) return song.plugin.createSearchQuery(song);
  return song.name ?? null;
}

function warmSearchCache(distube: DisTube, songs: Song[], metadata: unknown): void {
  const plugin = findSearchPlugin(distube);
  if (!plugin || !songs.length) return;
  guardedEvent('Precalentamiento de búsquedas', async () => {
    const queries = await Promise.all(songs.slice(0, PLAYLIST_SEARCH_WARM_LIMIT).map(getSearchQuery));
    await plugin.warmSearchCache(queries.filter((query): query is string => Boolean(query?.trim())), metadata);
  })();
}

export function registerDisTubeEvents(distube: DisTube): void {
  const recovery = new PlaybackRecovery();
  const observedVoices = new WeakSet<Queue['voice']>();
  function on<E extends keyof DisTubeEvents>(event: E, handler: (...args: DisTubeEvents[E]) => unknown): void {
    distube.on(event, guardedEvent(`DisTube ${event}`, handler) as TypedDisTubeEvents[E]);
  }

  on(Events.INIT_QUEUE, (queue) => {
    if (observedVoices.has(queue.voice)) return;
    observedVoices.add(queue.voice);
    const playStream = queue.voice.play.bind(queue.voice);
    queue.voice.play = (stream) => {
      observeStreamErrors(stream);
      return playStream(stream);
    };
  });

  on(Events.PLAY_SONG, async (queue, song) => {
    recovery.markStarted(queue, song);
    if (queue.voice.stream) observeStreamErrors(queue.voice.stream);
    warmSearchCache(distube, queue.songs.slice(1), song.metadata);
    await queue.textChannel?.send({ embeds: [createNowPlayingEmbed(song)], components: [createPlayerButtons(false)] });
  });

  on(Events.ADD_SONG, async (queue, song) => {
    await queue.textChannel?.send({ embeds: [createAddQueueEmbed(song)] });
  });

  on(Events.ADD_LIST, async (queue, playlist: Playlist) => {
    warmSearchCache(distube, playlist.songs, playlist.metadata);
    await queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(BotColors.Info)
      .setDescription(`📚 Añadida playlist: **${playlist.name ?? 'Playlist'}** — ${playlist.songs.length} canciones`)] });
  });

  on(Events.DISCONNECT, async (queue) => {
    await queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('🔌 Desconectado del canal de voz.')] });
  });

  on(Events.ERROR, async (error, queue: Queue, song) => {
    console.error('DisTube Error:', error);
    // Must run before the first await: DisTube decides whether to stop immediately after emit.
    const retry = recovery.retry(queue, song, error, findSearchPlugin(distube));
    const description = describeMusicError(error, song?.name ? { songName: song.name } : {});
    await queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription(
      `${description}\n\n${retry ? `🔄 Renovando el audio y reintentando (${retry}/2).` : 'Si quedan canciones en cola, continuaré con la siguiente.'}`,
    )] });
  });

  on(Events.DEBUG, (message) => {
    if (/QueueManager|voice|join/i.test(message)) console.log(`[DisTube Debug] ${message}`);
  });

  on(Events.NO_RELATED, async (queue) => {
    await queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(BotColors.Warning)
      .setDescription('🔇 No se encontraron canciones relacionadas. Puedes añadir otra con /play.')] });
  });
}
