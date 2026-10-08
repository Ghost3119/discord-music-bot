import { DisTube, DisTubeEvents, TypedDisTubeEvents, Events, InfoExtractorPlugin, Playlist, Queue, Song } from 'distube';
import { EmbedBuilder } from 'discord.js';
import { createAddQueueEmbed } from '../utils/embed';
import { BotColors } from '../utils/colors';
import { PLAYLIST_SEARCH_WARM_LIMIT, YtDlpSearchPlugin } from './ytDlpSearchPlugin';
import { getStreamDiagnostics, observeStreamErrors } from './streamErrors';
import { describeMusicError } from './errors';
import { PlaybackRecovery } from './playbackRecovery';
import { guardedEvent } from '../runtime/safety';
import { PlayerPanels } from './playerPanel';
import { RecoveryNotices } from './recoveryNotices';

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

export function registerDisTubeEvents(distube: DisTube): () => void {
  const notices = new RecoveryNotices();
  const recovery = new PlaybackRecovery((status) => { void notices.update(status); });
  const panels = new PlayerPanels(distube);
  const restoreControls = new Map<Queue, () => void>();
  const alternativePlays = new WeakMap<Queue, { song: Song; pending: Promise<void> }>();
  const nativePlay = distube.queues?.playSong;
  if (nativePlay) {
    // ERROR listeners are not awaited. Hold the reinserted head here, before
    // native playback, so an asynchronous alternative never races the next song.
    const playWithRecovery: typeof nativePlay = async (queue, emitPlaySong) => {
      const failed = queue.songs[0];
      const plugin = findSearchPlugin(distube);
      const existing = alternativePlays.get(queue);
      if (existing && existing.song === failed) return existing.pending;
      if (failed && plugin && recovery.needsAlternative(queue, failed)) {
        const pending = (async () => {
          const prepared = await recovery.prepareAlternative(queue, failed, plugin);
          if (queue.stopped || distube.getQueue(queue.id) !== queue) { recovery.cancelQueue(queue); return; }
          if (!prepared) {
            if (queue.songs[0] === failed) return; // cancelled lookup; never replay the failed head
            // A manual skip already owns playback of its new head.
            if (!recovery.alternativeFailed(queue, failed)) return;
            // playSong may run while DisTube already holds the queue task lock.
            // Calling the async stop() here would wait on that same lock forever.
            if (!queue.songs.length) { queue.voice.stop(); queue.remove(); return; }
          }
          await nativePlay.call(distube.queues, queue, emitPlaySong);
        })();
        alternativePlays.set(queue, { song: failed, pending });
        try { await pending; }
        finally { if (alternativePlays.get(queue)?.pending === pending) alternativePlays.delete(queue); }
        return;
      }
      await nativePlay.call(distube.queues, queue, emitPlaySong);
    };
    distube.queues.playSong = playWithRecovery;
  }
  const observedVoices = new WeakSet<Queue['voice']>();
  function on<E extends keyof DisTubeEvents>(event: E, handler: (...args: DisTubeEvents[E]) => unknown): void {
    distube.on(event, guardedEvent(`DisTube ${event}`, handler) as TypedDisTubeEvents[E]);
  }

  on(Events.INIT_QUEUE, (queue) => {
    if (!restoreControls.has(queue)) {
      const skip = queue.skip;
      const stop = queue.stop;
      // Abort extraction before these methods wait for DisTube's task lock.
      // Otherwise a user pressing Stop/Next could wait for the whole lookup.
      if (skip) queue.skip = async (...args) => {
        const failed = queue.songs[0];
        const searching = failed && recovery.needsAlternative(queue, failed);
        recovery.cancelQueue(queue);
        try { return await skip.apply(queue, args); }
        catch (error) {
          // Skip can reject (e.g. there is no next song, or radio lookup fails).
          // Do not leave an aborted recovery at the head with no active audio.
          if (searching && recovery.abandonCancelled(queue, failed)) {
            if (queue.songs.length) await queue.play();
            else await queue.stop();
          }
          throw error;
        }
      };
      if (stop) queue.stop = (...args) => { recovery.cancelQueue(queue); return stop.apply(queue, args); };
      restoreControls.set(queue, () => {
        if (skip) queue.skip = skip;
        if (stop) queue.stop = stop;
      });
    }
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
    await panels.show(queue, song);
  });

  on(Events.ADD_SONG, async (queue, song) => {
    await panels.refresh(queue);
    await queue.textChannel?.send({ embeds: [createAddQueueEmbed(song)] });
  });

  on(Events.ADD_LIST, async (queue, playlist: Playlist) => {
    warmSearchCache(distube, playlist.songs, playlist.metadata);
    await panels.refresh(queue);
    await queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(BotColors.Info)
      .setDescription(`📚 Añadida playlist: **${playlist.name ?? 'Playlist'}** — ${playlist.songs.length} canciones`)] });
  });

  on(Events.DISCONNECT, async (queue) => {
    await panels.close(queue, '🔌 Desconectado');
    await queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('🔌 Desconectado del canal de voz.')] });
  });

  on(Events.FINISH, (queue) => panels.close(queue, '✓ Cola terminada'));
  on(Events.DELETE_QUEUE, (queue) => {
    recovery.cancelQueue(queue);
    restoreControls.get(queue)?.(); restoreControls.delete(queue);
    return panels.close(queue);
  });

  on(Events.ERROR, async (error, queue: Queue, song) => {
    console.error('DisTube Error:', error);
    const diagnostics = getStreamDiagnostics(error);
    if (diagnostics.length) console.error('[FFmpeg]', diagnostics.join('\n'));
    // Must run before the first await: DisTube decides whether to stop immediately after emit.
    recovery.retry(queue, song, error, findSearchPlugin(distube));
    if (!song) await queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription(describeMusicError(error))] });
  });

  on(Events.DEBUG, (message) => {
    if (/QueueManager|voice|join/i.test(message)) console.log(`[DisTube Debug] ${message}`);
  });

  on(Events.NO_RELATED, async (queue) => {
    await queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(BotColors.Warning)
      .setDescription('🔇 No se encontraron canciones relacionadas. Puedes añadir otra con /play.')] });
  });
  return () => {
    notices.dispose(); recovery.dispose(); panels.dispose();
    for (const restore of restoreControls.values()) restore();
    restoreControls.clear();
    if (nativePlay) distube.queues.playSong = nativePlay;
  };
}
