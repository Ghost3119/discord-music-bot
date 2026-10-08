import { DisTube, DisTubeEvents, TypedDisTubeEvents, Events, InfoExtractorPlugin, Playlist, Queue, Song, DisTubeStream } from 'distube';
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
import { PlaybackHealth, HealthOptions, stallError } from './playbackHealth';
import { getPlaybackState, markQueueEdited, resetObservation } from './playbackState';
import { HistoryStore } from './history';
import { checkpointQueue } from './queueChanges';

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

export function registerDisTubeEvents(distube: DisTube, history?: HistoryStore, options?: HealthOptions): () => void {
  const notices = new RecoveryNotices();
  const panels = new PlayerPanels(distube);
  let health: PlaybackHealth;
  const recovery = new PlaybackRecovery((status) => { health.recovery(status); void notices.update(status); });
  health = new PlaybackHealth(distube, history, queue => {
    void panels.refresh(queue); checkpointQueue(distube, queue);
  }, async queue => {
    if (queue.stopped || getPlaybackState(queue)?.blocked || !queue.songs[0]) return;
    const song = queue.songs.shift()!;
    queue.voice.emittedError = true;
    queue.voice.stream?.kill();
    distube.emit(Events.ERROR, stallError(), queue, song);
    if (queue.songs.length) await distube.queues.playSong(queue);
    else { queue.voice.stop(); queue.remove(); }
  }, options);
  const restoreControls = new Map<Queue, () => void>();
  const alternativePlays = new WeakMap<Queue, { song: Song; pending: Promise<void> }>();
  const nativePlay = distube.queues?.playSong;
  // Keep ownership across attachStreamInfo's await. The library's implementation
  // starts the resolved stream even if its old queue ended during extraction.
  async function startSong(queue: Queue, emit = true): Promise<void> {
    if (!distube.handler?.attachStreamInfo) { await nativePlay?.call(distube.queues, queue, emit); return; }
    const song = queue.songs[0];
    if (!song || queue.stopped) return;
    let stream: DisTubeStream | undefined;
    const owns = () => !queue.stopped && !getPlaybackState(queue)?.closing && distube.getQueue(queue.id) === queue && queue.songs[0] === song;
    try {
      await distube.handler.attachStreamInfo(song);
      if (!owns() || getPlaybackState(queue)?.blocked) return;
      const playable = song.stream.playFromSource ? song : song.stream.song;
      if (!playable?.stream.playFromSource || !playable.stream.url) throw Object.assign(new Error('No stream URL attached'), { errorCode: 'NO_STREAM_URL' });
      stream = new DisTubeStream(playable.stream.url, {
        ffmpeg: { path: distube.options.ffmpeg.path, args: { global: { ...queue.ffmpegArgs.global }, input: { ...queue.ffmpegArgs.input },
          output: { ...queue.ffmpegArgs.output, ...queue.filters.ffmpegArgs } } }, ...(playable.duration ? { seek: queue._beginTime } : {}),
      });
      queue._beginTime = 0;
      stream.on('debug', data => distube.emit(Events.FFMPEG_DEBUG, `[${queue.id}] ${data}`));
      await queue.voice.play(stream);
      if (!owns()) { stream.kill(); return; }
      if (emit) distube.emit(Events.PLAY_SONG, queue, song);
    } catch (error) {
      stream?.kill();
      if (!owns()) return;
      queue.songs.shift();
      distube.emit(Events.ERROR, error instanceof Error ? error : new Error(String(error)), queue, song);
      if (queue.songs.length) await distube.queues.playSong(queue);
      else { queue.voice.stop(); queue.remove(); }
    }
  }
  const nativeFinish = distube.queues?.handleSongFinish;
  if (nativeFinish) distube.queues.handleSongFinish = async queue => {
    const state = getPlaybackState(queue);
    if (state?.blocked || state?.busy || (state && ['recovering', 'alternative'].includes(state.mode) &&
      (queue.voice.emittedError || !(queue.voice.stream?.audioResource?.playbackDuration)))) return;
    try { await nativeFinish.call(distube.queues, queue); }
    catch (error) { console.error('[Fin de canción]', error); }
  };
  if (nativePlay) {
    // ERROR listeners are not awaited. Hold the reinserted head here, before
    // native playback, so an asynchronous alternative never races the next song.
    const playWithRecovery: typeof nativePlay = async (queue, emitPlaySong) => {
      const failed = queue.songs[0];
      if (queue.stopped) return;
      if (getPlaybackState(queue)?.blocked) { await panels.show(queue); return; }
      const plugin = findSearchPlugin(distube);
      const existing = alternativePlays.get(queue);
      if (existing && existing.song === failed) return existing.pending;
      if (failed && plugin && recovery.needsAlternative(queue, failed)) {
        const pending = (async () => {
          health.beforePlay(queue, failed);
          try {
            const prepared = await recovery.prepareAlternative(queue, failed, plugin);
            if (queue.stopped || getPlaybackState(queue)?.closing || distube.getQueue(queue.id) !== queue) { recovery.cancelQueue(queue); return; }
            if (!prepared) {
              if (queue.songs[0] === failed) return; // cancelled lookup; never replay the failed head
              // A manual skip already owns playback of its new head.
              if (!recovery.alternativeFailed(queue, failed)) return;
              // Do not await stop() while DisTube holds the queue task lock.
              if (!queue.songs.length) { queue.voice.stop(); queue.remove(); return; }
            }
            await startSong(queue, emitPlaySong);
          } finally { health.afterPlay(queue); }
        })();
        alternativePlays.set(queue, { song: failed, pending });
        try { await pending; }
        finally { if (alternativePlays.get(queue)?.pending === pending) alternativePlays.delete(queue); }
        return;
      }
      if (failed) health.beforePlay(queue, failed);
      try { await startSong(queue, emitPlaySong); }
      finally { health.afterPlay(queue); }
    };
    distube.queues.playSong = playWithRecovery;
  }
  const observedVoices = new WeakSet<Queue['voice']>();
  const listeners: (() => void)[] = [];
  function on<E extends keyof DisTubeEvents>(event: E, handler: (...args: DisTubeEvents[E]) => unknown): void {
    const listener = guardedEvent(`DisTube ${event}`, handler) as TypedDisTubeEvents[E];
    distube.on(event, listener);
    listeners.push(() => { distube.off(event, listener); });
  }

  on(Events.INIT_QUEUE, (queue) => {
    health.init(queue);
    if (!restoreControls.has(queue)) {
      const skip = queue.skip;
      const stop = queue.stop;
      const seek = queue.seek;
      const resume = queue.resume;
      // Abort extraction before these methods wait for DisTube's task lock.
      // Otherwise a user pressing Stop/Next could wait for the whole lookup.
      if (skip) queue.skip = async (...args) => {
        const failed = queue.songs[0];
        const searching = failed && recovery.needsAlternative(queue, failed);
        recovery.cancelQueue(queue);
        if (getPlaybackState(queue)?.blocked) throw Object.assign(new Error('La cola está pausada por fallos. Usa Reintentar o Detener.'), { errorCode: 'QUEUE_BLOCKED' });
        resetObservation(queue, health.now());
        try {
          const result = await skip.apply(queue, args);
          markQueueEdited(queue);
          if (failed) health.history.finish(queue, failed, 'skipped');
          return result;
        }
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
      if (stop) queue.stop = (...args) => {
        if (queue.stopped) return Promise.resolve();
        const state = getPlaybackState(queue); if (state) state.closing = true;
        markQueueEdited(queue); recovery.cancelQueue(queue); return stop.apply(queue, args);
      };
      if (seek) queue.seek = (...args) => {
        if (getPlaybackState(queue)?.blocked) return Promise.reject(Object.assign(new Error('Usa Reintentar para recuperar la cola.'), { errorCode: 'QUEUE_BLOCKED' }));
        recovery.cancelQueue(queue); resetObservation(queue, health.now());
        return seek.apply(queue, args);
      };
      if (resume) queue.resume = (...args) => getPlaybackState(queue)?.blocked ? health.retryBlocked(queue).then(() => queue) : resume.apply(queue, args);
      restoreControls.set(queue, () => {
        if (skip) queue.skip = skip;
        if (stop && !queue.stopped) queue.stop = stop;
        if (seek) queue.seek = seek;
        if (resume) queue.resume = resume;
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
    if (queue.stopped || distube.getQueue?.(queue.id) && distube.getQueue(queue.id) !== queue) return;
    health.started(queue, song);
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
  on(Events.FINISH_SONG, (queue, song) => { if (song) health.completed(queue, song); });
  on(Events.DELETE_QUEUE, (queue) => {
    health.end(queue);
    recovery.cancelQueue(queue);
    restoreControls.get(queue)?.(); restoreControls.delete(queue);
    return panels.close(queue);
  });

  on(Events.ERROR, async (error, queue: Queue, song) => {
    console.error('DisTube Error:', error);
    const diagnostics = getStreamDiagnostics(error);
    if (diagnostics.length) console.error('[FFmpeg]', diagnostics.join('\n'));
    if (queue.stopped) return;
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
    for (const remove of listeners.splice(0)) remove();
    notices.dispose(); recovery.dispose(); panels.dispose(); health.dispose();
    for (const restore of restoreControls.values()) restore();
    restoreControls.clear();
    if (nativePlay) distube.queues.playSong = nativePlay;
    if (nativeFinish) distube.queues.handleSongFinish = nativeFinish;
  };
}
