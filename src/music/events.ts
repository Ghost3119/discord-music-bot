import { DisTube, DisTubeEvents, TypedDisTubeEvents, Events, InfoExtractorPlugin, Playlist, Queue, Song, DisTubeStream, DisTubeError } from 'distube';
import { EmbedBuilder } from 'discord.js';
import { createAddQueueEmbed } from '../utils/embed';
import { BotColors } from '../utils/colors';
import { PLAYLIST_SEARCH_WARM_LIMIT, YtDlpSearchPlugin } from './ytDlpSearchPlugin';
import { getStreamDiagnostics, observeStreamErrors, observeVoiceErrors } from './streamErrors';
import { describeMusicError } from './errors';
import { PlaybackRecovery } from './playbackRecovery';
import { guardedEvent } from '../runtime/safety';
import { PlayerPanels } from './playerPanel';
import { RecoveryNotices } from './recoveryNotices';
import { PlaybackHealth, HealthOptions, stallError } from './playbackHealth';
import { getPlaybackState, markQueueEdited, resetObservation } from './playbackState';
import { HistoryStore } from './history';
import { checkpointQueue } from './queueChanges';
import { AudioPreloader, PreloaderOptions } from './audioPreloader';
import { PrebufferedStream } from './prebufferedStream';

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

export function registerDisTubeEvents(distube: DisTube, history?: HistoryStore, options?: HealthOptions, preloaderOptions?: PreloaderOptions): () => void {
  const notices = new RecoveryNotices();
  const panels = new PlayerPanels(distube);
  let disposed = false;
  const failedStreams = new WeakSet<object>();
  const ownsQueue = (queue: Queue) => !disposed && !queue.stopped && !getPlaybackState(queue)?.closing &&
    (typeof distube.getQueue !== 'function' || distube.getQueue(queue.id) === queue);
  async function failSong(queue: Queue, error: unknown, song = queue.songs[0]): Promise<void> {
    if (!ownsQueue(queue) || getPlaybackState(queue)?.blocked || !song || queue.songs[0] !== song) return;
    const stream = queue.voice.stream;
    if (stream) failedStreams.add(stream);
    queue.voice.emittedError = true;
    queue.songs.shift();
    distube.emit(Events.ERROR, error instanceof Error ? error : new Error(String(error)), queue, song);
    try { stream?.kill(); } catch (killError) { console.error('[Cerrar stream fallido]', killError); }
    if (queue.songs.length) await distube.queues.playSong(queue);
    else {
      // Native error handling awaits stop() without guarding its rejected promise.
      // Cleanup here also avoids reacquiring a task lock held by extraction.
      try { queue.voice.stop(); } finally { queue.remove(); }
    }
  }
  let health: PlaybackHealth;
  const recovery = new PlaybackRecovery((status) => { health.recovery(status); void notices.update(status); });
  health = new PlaybackHealth(distube, history, queue => {
    void panels.refresh(queue); checkpointQueue(distube, queue);
  }, queue => failSong(queue, stallError()), options);
  const preloader = new AudioPreloader(distube, recovery, { interval: options?.interval === 0 ? 0 : 1000, clock: health.now, ...preloaderOptions });
  const restoreControls = new Map<Queue, () => void>();
  const alternativePlays = new WeakMap<Queue, { song: Song; pending: Promise<void> }>();
  const nativePlay = distube.queues?.playSong;
  // Keep ownership across attachStreamInfo's await. The library's implementation
  // starts the resolved stream even if its old queue ended during extraction.
  async function startSong(queue: Queue, emit = true): Promise<void> {
    if (!distube.handler?.attachStreamInfo) { await nativePlay?.call(distube.queues, queue, emit); return; }
    let song = queue.songs[0];
    if (!song || queue.stopped) return;
    const signal = recovery.signalFor(queue, song);
    let stream: DisTubeStream | undefined;
    const owns = () => ownsQueue(queue) && queue.songs[0] === song;
    try {
      const prepared = signal ? undefined : await preloader.take(queue, song);
      if (prepared?.stream && !preloader.compatible(queue, prepared)) { await prepared.stream.dispose(); delete prepared.stream; }
      if (!owns() || getPlaybackState(queue)?.blocked) { await prepared?.stream?.dispose(); return; }
      if (prepared) {
        if (prepared.replacement) {
          health.history.alias(queue, song, prepared.replacement);
          if (song.playlist) prepared.replacement.playlist = song.playlist;
          queue.songs[0] = prepared.replacement; song = prepared.replacement;
        }
        if (!song.stream.playFromSource) song.stream.song = prepared.playable;
        const playable = song.stream.playFromSource ? song : prepared.playable;
        if (playable.stream.playFromSource) playable.stream.url = prepared.url;
        stream = prepared.stream;
      }
      if (!prepared) {
        const renewing = song.stream.playFromSource ? song : song.stream.song;
        if (signal && renewing?.plugin instanceof YtDlpSearchPlugin && renewing.stream.playFromSource && !renewing.stream.url) {
          const url = await renewing.plugin.getStreamURL(renewing, signal);
          if (signal.aborted || !owns()) return;
          renewing.stream.url = url;
        } else await distube.handler.attachStreamInfo(song);
      }
      if (signal?.aborted || !owns() || getPlaybackState(queue)?.blocked) return;
      const playable = song.stream.playFromSource ? song : song.stream.song;
      if (!playable?.stream.playFromSource || !playable.stream.url) throw Object.assign(new Error('No stream URL attached'), { errorCode: 'NO_STREAM_URL' });
      stream ??= new DisTubeStream(playable.stream.url, {
        ffmpeg: { path: distube.options.ffmpeg.path, args: { global: { ...queue.ffmpegArgs.global }, input: { ...queue.ffmpegArgs.input },
          output: { ...queue.ffmpegArgs.output, ...queue.filters.ffmpegArgs } } }, ...(playable.duration ? { seek: queue._beginTime } : {}),
      });
      queue._beginTime = 0;
      stream.on('debug', data => distube.emit(Events.FFMPEG_DEBUG, `[${queue.id}] ${data}`));
      await queue.voice.play(stream);
      if (signal?.aborted || !owns()) { if (stream instanceof PrebufferedStream) await stream.dispose(); else stream.kill(); return; }
      preloader.started(queue, stream, prepared?.stream ? 'buffer' : prepared ? 'url' : 'fallback');
      if (emit) distube.emit(Events.PLAY_SONG, queue, song);
    } catch (error) {
      if (stream instanceof PrebufferedStream) await stream.dispose(); else stream?.kill();
      if (signal?.aborted || !owns()) return;
      await failSong(queue, error, song);
    }
  }
  const nativeFinish = distube.queues?.handleSongFinish;
  const pendingFinishes = new WeakMap<Queue, { song: Song | undefined; stream: DisTubeStream | undefined; manual: boolean; pending: Promise<void> }>();
  if (nativeFinish) distube.queues.handleSongFinish = async queue => {
    const song = queue.songs[0], stream = queue.voice.stream, manual = queue._manualUpdate;
    if (!song) return;
    const eligible = () => {
      const state = getPlaybackState(queue);
      return ownsQueue(queue) && !state?.blocked && !state?.busy && queue.songs[0] === song && queue.voice.stream === stream &&
        queue._manualUpdate === manual && (manual || !queue.voice.emittedError &&
          !(state && ['recovering', 'alternative'].includes(state.mode) && !stream?.audioResource?.playbackDuration));
    };
    if (!eligible()) return;
    const existing = pendingFinishes.get(queue);
    if (existing && existing.song === song && existing.stream === stream && existing.manual === manual) return existing.pending;
    const pending = (async () => {
      try {
        for (;;) {
          await queue._taskQueue.queuing();
          let finishing: Promise<void>;
          try {
            if (!eligible()) return;
            // Drain commands already waiting before delegating: native finish
            // captures the head before acquiring its own task lock.
            if (queue._taskQueue.remaining > 1) continue;
            finishing = nativeFinish.call(distube.queues, queue);
          } finally { queue._taskQueue.resolve(); }
          await finishing;
          return;
        }
      } catch (error) { console.error('[Fin de canción]', error); }
    })();
    pendingFinishes.set(queue, { song, stream, manual, pending });
    try { await pending; }
    finally { if (pendingFinishes.get(queue)?.pending === pending) pendingFinishes.delete(queue); }
  };
  if (nativePlay) {
    // ERROR listeners are not awaited. Hold the reinserted head here, before
    // native playback, so an asynchronous alternative never races the next song.
    const playWithRecovery: typeof nativePlay = async (queue, emitPlaySong) => {
      const failed = queue.songs[0];
      if (!ownsQueue(queue)) return;
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
    observeVoiceErrors(queue.voice);
    if (!restoreControls.has(queue)) {
      const previousError = queue._listeners?.error;
      const voiceError = guardedEvent('Error de reproducción de voz', async (error: Error) => {
        if (queue.voice.stream && failedStreams.has(queue.voice.stream)) return;
        await failSong(queue, error);
      });
      if (previousError) {
        queue.voice.off('error', previousError);
        queue._listeners!.error = voiceError;
        queue.voice.on('error', voiceError);
      }
      const skip = queue.skip;
      const stop = queue.stop;
      const seek = queue.seek;
      const resume = queue.resume;
      // Abort extraction before these methods wait for DisTube's task lock.
      // Otherwise a user pressing Stop/Next could wait for the whole lookup.
      if (skip) queue.skip = async (...args) => {
        const failed = queue.songs[0];
        const recovering = failed && recovery.signalFor(queue, failed);
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
          if (recovering && recovery.abandonCancelled(queue, failed)) {
            if (queue.songs.length) await queue.play();
            else await queue.stop();
          }
          throw error;
        }
      };
      if (stop) queue.stop = (...args) => {
        if (queue.stopped) return Promise.resolve();
        const state = getPlaybackState(queue); if (state) state.closing = true;
        preloader.end(queue);
        markQueueEdited(queue); recovery.cancelQueue(queue); return stop.apply(queue, args);
      };
      if (typeof seek === 'function') queue.seek = async (time) => {
        const song = queue.songs[0];
        if (getPlaybackState(queue)?.blocked) throw Object.assign(new Error('Usa Reintentar para recuperar la cola.'), { errorCode: 'QUEUE_BLOCKED' });
        preloader.cancel(queue, 'seek');
        recovery.cancelQueue(queue); resetObservation(queue, health.now());
        // Native seek reads its head only after waiting. Keep the command bound
        // to the song the user saw, and validate inside the same task lock.
        await queue._taskQueue.queuing();
        try {
          if (!ownsQueue(queue) || !song || queue.songs[0] !== song) throw Object.assign(new Error('La canción cambió mientras esperaba.'), { errorCode: 'SESSION_CHANGED' });
          if (getPlaybackState(queue)?.blocked) throw Object.assign(new Error('Usa Reintentar para recuperar la cola.'), { errorCode: 'QUEUE_BLOCKED' });
          if (typeof time !== 'number') throw new DisTubeError('INVALID_TYPE', 'number', time, 'time');
          if (Number.isNaN(time) || time < 0) throw new DisTubeError('NUMBER_COMPARE', 'time', 'bigger or equal to', 0);
          queue._beginTime = time;
          await queue.play(false);
          return queue;
        } finally { queue._taskQueue.resolve(); }
      };
      if (resume) queue.resume = (...args) => getPlaybackState(queue)?.blocked ? health.retryBlocked(queue).then(() => queue) : resume.apply(queue, args);
      restoreControls.set(queue, () => {
        if (previousError && queue._listeners?.error === voiceError) {
          queue.voice.off('error', voiceError);
          queue._listeners.error = previousError;
          if (!queue.stopped) queue.voice.on('error', previousError);
        }
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
    preloader.changed(queue);
    await panels.refresh(queue);
    await queue.textChannel?.send({ embeds: [createAddQueueEmbed(song)] });
  });

  on(Events.ADD_LIST, async (queue, playlist: Playlist) => {
    preloader.changed(queue);
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
  on(Events.FINISH_SONG, (queue, song) => { if (song) { preloader.finished(queue); health.completed(queue, song); } });
  on(Events.DELETE_QUEUE, (queue) => {
    preloader.end(queue);
    health.end(queue);
    recovery.cancelQueue(queue);
    restoreControls.get(queue)?.(); restoreControls.delete(queue);
    return panels.close(queue);
  });

  on(Events.ERROR, async (error, queue: Queue, song) => {
    console.error('DisTube Error:', error);
    const diagnostics = getStreamDiagnostics(error);
    if (diagnostics.length) console.error('[FFmpeg]', diagnostics.join('\n'));
    if (!ownsQueue(queue)) return;
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
    disposed = true;
    for (const remove of listeners.splice(0)) remove();
    preloader.dispose(); notices.dispose(); recovery.dispose(); panels.dispose(); health.dispose();
    for (const restore of restoreControls.values()) restore();
    restoreControls.clear();
    if (nativePlay) distube.queues.playSong = nativePlay;
    if (nativeFinish) distube.queues.handleSongFinish = nativeFinish;
  };
}
