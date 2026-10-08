import { Queue, Song } from 'distube';
import { classifyMusicError } from './errors';
import { YtDlpSearchPlugin } from './ytDlpSearchPlugin';

const RECOVERABLE = new Set(['FFMPEG_EXITED', 'ERR_STREAM_PREMATURE_CLOSE', 'NETWORK_ERROR', 'NETWORK_TIMEOUT', 'SOURCE_UNAVAILABLE', 'SOURCE_BLOCKED']);
export type RecoveryStage = 'renew' | 'alternative' | 'recovered' | 'failed' | 'cancelled' | 'unconfirmed';
export interface RecoveryStatus {
  queue: Queue;
  original: Song;
  song: Song;
  stage: RecoveryStage;
  attempt: number;
  code: string;
}
interface RecoveryState {
  queue: Queue;
  original: Song;
  song: Song;
  attempt: number;
  code: string;
  stage: RecoveryStage;
  controller: AbortController;
  timer: NodeJS.Timeout | undefined;
  preparation: Promise<boolean> | undefined;
}

export class PlaybackRecovery {
  private readonly states = new WeakMap<Song, RecoveryState>();
  private readonly started = new WeakMap<Queue, Song>();
  private readonly active = new Set<RecoveryState>();
  private disposed = false;

  constructor(private readonly onStatus: (status: RecoveryStatus) => void = () => {}, private readonly confirmMs = 1_000) {}

  markStarted(queue: Queue, song: Song): void {
    this.started.set(queue, song);
    for (const state of this.active) if (state.queue === queue && state.song !== song) this.cancel(state);
    const state = this.states.get(song);
    if (!state || state.queue !== queue || !['renew', 'alternative'].includes(state.stage)) return;
    this.clearTimer(state);
    let waiting = 0;
    // playSong fires before FFmpeg's HTTP request succeeds. Confirm consumed audio.
    state.timer = setInterval(() => {
      if (queue.stopped || queue.songs[0] !== song || this.disposed) { this.cancel(state); return; }
      if ((queue.voice?.stream?.audioResource?.playbackDuration ?? 0) > 0) {
        this.clearTimer(state); this.active.delete(state); this.publish(state, 'recovered');
      } else if (!queue.paused && ++waiting * this.confirmMs >= 30_000) {
        this.clearTimer(state); this.publish(state, 'unconfirmed');
      }
    }, this.confirmMs);
    state.timer.unref();
  }

  retry(queue: Queue, song: Song | undefined, error: unknown, plugin: YtDlpSearchPlugin | undefined): number {
    if (!song || queue.stopped || this.disposed) return 0;
    const code = classifyMusicError(error);
    let state = this.states.get(song);
    if (!state || state.queue !== queue) {
      state = { queue, original: song, song, attempt: 0, code, stage: 'renew', controller: new AbortController(), timer: undefined, preparation: undefined };
      this.states.set(song, state);
    }
    this.clearTimer(state); state.code = code;
    const playable = song.stream.playFromSource ? song : song.stream.song;
    if (!plugin || !playable || playable.plugin !== plugin || !RECOVERABLE.has(code) || state.attempt >= 3 || state.controller.signal.aborted) {
      this.active.delete(state); this.publish(state, 'failed'); return 0;
    }
    state.attempt += 1;
    const position = queue.currentTime;
    if (this.started.get(queue) === song && Number.isFinite(position) && position > 1 && position < song.duration - 2) queue._beginTime = Math.max(0, position - 1);
    if (state.attempt <= 2) plugin.invalidateStream(song, state.attempt * 1_000);
    this.active.add(state);
    // DisTube shifts the failed song before emitting; reinsert before emit returns.
    if (!queue.songs.includes(song)) queue.songs.unshift(song);
    this.publish(state, state.attempt <= 2 ? 'renew' : 'alternative');
    return state.attempt;
  }

  needsAlternative(queue: Queue, song: Song): boolean {
    const state = this.states.get(song);
    return state?.queue === queue && state.stage === 'alternative' && state.song === state.original;
  }

  alternativeFailed(queue: Queue, song: Song): boolean {
    const state = this.states.get(song);
    return state?.queue === queue && state.stage === 'failed';
  }

  abandonCancelled(queue: Queue, song: Song): boolean {
    const state = this.states.get(song);
    if (!state || state.queue !== queue || state.stage !== 'cancelled' || queue.stopped || queue.songs[0] !== song) return false;
    this.failAlternative(state);
    return true;
  }

  async prepareAlternative(queue: Queue, song: Song, plugin: YtDlpSearchPlugin): Promise<boolean> {
    const state = this.states.get(song);
    if (!state || !this.needsAlternative(queue, song)) return true;
    if (!state.preparation) state.preparation = this.prepare(state, plugin);
    return state.preparation;
  }

  private async prepare(state: RecoveryState, plugin: YtDlpSearchPlugin): Promise<boolean> {
    const { queue, song } = state;
    try {
      const alternative = await plugin.findAlternative(song, state.controller.signal);
      if (this.disposed || state.controller.signal.aborted || queue.stopped || queue.songs[0] !== song) { this.cancel(state); return false; }
      if (!alternative) { this.failAlternative(state); return false; }
      queue.songs[0] = alternative;
      queue._beginTime = 0;
      state.song = alternative;
      this.states.set(alternative, state);
      return true;
    } catch (error) {
      if (this.disposed || state.controller.signal.aborted || queue.stopped || queue.songs[0] !== song) { this.cancel(state); return false; }
      console.error('[Búsqueda de alternativa]', { guildId: queue.id, code: classifyMusicError(error) });
      this.failAlternative(state); return false;
    }
  }

  private failAlternative(state: RecoveryState): void {
    if (state.queue.songs[0] === state.song) state.queue.songs.shift();
    state.queue._beginTime = 0;
    this.active.delete(state); this.publish(state, 'failed');
  }

  cancelQueue(queue: Queue): void {
    for (const state of this.active) if (state.queue === queue) this.cancel(state);
  }

  dispose(): void {
    this.disposed = true;
    for (const state of this.active) this.cancel(state);
  }

  private clearTimer(state: RecoveryState): void {
    if (state.timer) clearInterval(state.timer);
    state.timer = undefined;
  }

  private cancel(state: RecoveryState): void {
    if (state.stage === 'cancelled' || state.stage === 'failed') return;
    this.clearTimer(state); state.controller.abort(); this.active.delete(state);
    this.publish(state, 'cancelled');
  }

  private publish(state: RecoveryState, stage: RecoveryStage): void {
    state.stage = stage;
    const source = (state.song.stream.playFromSource ? state.song.source : state.song.stream.song?.source) ?? state.song.source;
    console.info('[Recuperación]', JSON.stringify({ guildId: state.queue.id, song: state.original.name, songId: state.original.id,
      source, attempt: state.attempt, maxAttempts: 3, code: state.code, result: stage, alternative: state.song !== state.original,
      ...(state.song !== state.original ? { alternativeId: state.song.id, alternativeName: state.song.name } : {}) }));
    try { this.onStatus({ queue: state.queue, original: state.original, song: state.song, stage, attempt: state.attempt, code: state.code }); }
    catch (error) { console.error('[Aviso de recuperación]', error); }
  }
}
