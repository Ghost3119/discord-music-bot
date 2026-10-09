import { randomBytes } from 'node:crypto';
import { DisTube, Queue, Song } from 'distube';
import { getPlaybackState, initPlaybackState, resetObservation } from './playbackState';
import { HistoryStore } from './history';
import type { RecoveryStatus } from './playbackRecovery';
import { YtDlpSearchPlugin } from './ytDlpSearchPlugin';

export interface HealthOptions { monitor?: boolean; breaker?: boolean; clock?: () => number; interval?: number; }
const managers = new WeakMap<DisTube, PlaybackHealth>();
export function getPlaybackHealth(distube: DisTube): PlaybackHealth | undefined { return managers.get(distube); }

export class PlaybackHealth {
  private readonly queues = new Set<Queue>();
  private readonly timer: NodeJS.Timeout | undefined;
  readonly now: () => number;
  private disposed = false;
  readonly monitor: boolean;
  readonly breaker: boolean;
  constructor(private readonly distube: DisTube, readonly history = new HistoryStore(),
    private readonly changed: (queue: Queue) => void = () => {}, private readonly stall: (queue: Queue) => Promise<void> = async () => {}, options: HealthOptions = {}) {
    this.now = options.clock ?? Date.now;
    this.monitor = options.monitor ?? process.env['AUDIO_WATCHDOG_ENABLED'] !== 'false';
    this.breaker = options.breaker ?? process.env['AUDIO_BREAKER_ENABLED'] !== 'false';
    managers.set(distube, this);
    if (options.interval !== 0) { this.timer = setInterval(() => this.tick(), options.interval ?? 2000); this.timer.unref(); }
  }
  init(queue: Queue): void { initPlaybackState(queue, this.now()); this.queues.add(queue); }
  beforePlay(queue: Queue, song: Song): void {
    this.init(queue);
    const state = getPlaybackState(queue)!;
    if (state.song !== song && !['recovering', 'alternative'].includes(state.mode)) state.attempt = 0;
    this.history.begin(queue, song);
    state.song = song; state.busy++;
    if (!state.blocked && !['recovering', 'alternative'].includes(state.mode)) state.mode = 'preparing';
    resetObservation(queue, this.now()); this.changed(queue);
  }
  afterPlay(queue: Queue): void { const state = getPlaybackState(queue); if (state) state.busy = Math.max(0, state.busy - 1); }
  started(queue: Queue, song: Song): void {
    this.init(queue); this.history.begin(queue, song);
    const state = getPlaybackState(queue)!;
    if (state.song !== song && !['recovering', 'alternative'].includes(state.mode)) state.attempt = 0;
    state.song = song;
    if (!state.blocked && !['recovering', 'alternative'].includes(state.mode)) state.mode = queue.paused ? 'paused' : 'preparing';
    resetObservation(queue, this.now());
  }
  recovery(status: RecoveryStatus): void {
    const { queue, original, song, stage } = status;
    if (this.disposed || queue.stopped || getPlaybackState(queue)?.closing ||
      (typeof this.distube.getQueue === 'function' && this.distube.getQueue(queue.id) !== queue)) return;
    this.init(queue);
    const state = getPlaybackState(queue)!;
    if (original !== song) this.history.alias(queue, original, song);
    state.attempt = status.attempt;
    if (['renew', 'alternative', 'failed'].includes(stage)) {
      if (!state.lastError || state.lastError.code !== status.code || state.errorSong !== original) {
        state.lastError = { code: status.code, reference: randomBytes(6).toString('hex'), time: this.now() };
        state.errorSong = original;
      }
      console.info('[Incidente]', JSON.stringify({ guildId: queue.id, session: state.session, song: original.name,
        code: status.code, reference: state.lastError.reference, attempt: status.attempt, result: stage }));
    }
    if (stage === 'renew') state.mode = 'recovering';
    if (stage === 'alternative') state.mode = 'alternative';
    if (stage === 'recovered') state.mode = queue.paused ? 'paused' : 'playing';
    if (stage === 'cancelled') { state.mode = queue.paused ? 'paused' : 'preparing'; state.attempt = 0; }
    if (stage === 'failed') this.failed(queue, song, status.code);
    if (state.blocked) state.mode = 'blocked';
    this.changed(queue);
  }
  private failed(queue: Queue, song: Song, code: string): void {
    const state = getPlaybackState(queue)!;
    if (!this.history.finish(queue, song, 'failed', code, state.lastError?.reference)) return;
    state.failures = state.failures.filter(time => this.now() - time < 300_000);
    state.failures.push(this.now());
    if (!state.blocked) state.mode = 'preparing';
    if (this.breaker && (state.failures.length >= 3 || state.probe)) {
      state.blocked = true; state.probe = false; state.mode = 'blocked'; queue.paused = true;
      if (!queue.songs.includes(song)) queue.songs.unshift(song);
      queue.voice.pause?.();
      console.warn('[Cola bloqueada]', JSON.stringify({ guildId: queue.id, session: state.session, failures: state.failures.length, reference: state.lastError?.reference }));
    }
  }
  completed(queue: Queue, song: Song): void {
    this.history.finish(queue, song, 'completed');
    const state = getPlaybackState(queue);
    if (state) { state.failures = []; state.probe = false; state.attempt = 0; }
  }
  async retryBlocked(queue: Queue): Promise<void> {
    const state = getPlaybackState(queue);
    if (!state?.blocked || state.busy || queue.stopped || this.distube.getQueue(queue.id) !== queue) return;
    const original = queue.songs[0];
    if (!original) return;
    const plugin = (original.stream.playFromSource ? original : original.stream.song)?.plugin;
    if (plugin instanceof YtDlpSearchPlugin) plugin.invalidateStream(original, 0);
    const copy = new Song({ plugin: original.plugin, source: original.source, id: original.id, name: original.name ?? original.id,
      duration: original.duration, ...(original.url ? { url: original.url } : {}), isLive: Boolean(original.isLive),
      ...(original.thumbnail ? { thumbnail: original.thumbnail } : {}), uploader: original.uploader,
      ageRestricted: Boolean(original.ageRestricted), playFromSource: original.stream.playFromSource }, { metadata: original.metadata, ...(original.member ? { member: original.member } : {}) });
    state.blocked = false; state.probe = true; state.mode = 'preparing'; queue.paused = false;
    queue.songs[0] = copy; queue._beginTime = 0; queue.voice.unpause?.();
    resetObservation(queue, this.now()); this.changed(queue);
    await queue.play();
  }
  restoreBlocked(queue: Queue): void { this.init(queue); const state = getPlaybackState(queue)!; state.blocked = true; state.mode = 'blocked'; queue.paused = true; this.changed(queue); }
  tick(): void {
    if (this.disposed) return;
    for (const queue of this.queues) {
      try {
        if (queue.stopped || this.distube.getQueue(queue.id) !== queue) { this.end(queue); continue; }
        const state = getPlaybackState(queue)!, now = this.now();
        const elapsed = Math.max(0, Math.min(5000, now - state.observedAt)); state.observedAt = now;
        if (state.closing || state.blocked || state.busy || queue.paused || queue.voice.isDisconnected) {
          state.continuous = 0;
          if (queue.voice.isDisconnected) state.mode = 'disconnected';
          else if (!state.blocked && queue.paused) state.mode = 'paused';
          continue;
        }
        const song = queue.songs[0], resource = queue.voice.stream?.audioResource, frames = resource?.playbackDuration ?? 0;
        if (!song) continue;
        if (resource !== state.resource || song !== state.song) {
          state.resource = resource; state.song = song; state.frames = 0; state.waiting = 0; state.continuous = 0; state.stalled = false;
        }
        if (frames > state.frames) {
          state.lastProgress = now; state.waiting = 0; state.continuous += elapsed; state.stalled = false;
          if (state.mode !== 'playing') { state.mode = 'playing'; this.changed(queue); }
          if (state.continuous >= 30_000) { state.failures = []; state.probe = false; }
        } else {
          state.continuous = 0; state.waiting += elapsed;
          const threshold = frames > 0 ? 8000 : 12_000;
          if (this.monitor && state.waiting >= threshold && !state.stalled) {
            state.stalled = true; state.mode = 'recovering'; this.changed(queue);
            void this.stall(queue).catch(error => { console.error('[Detector de audio]', error); });
          }
        }
        state.frames = frames;
      } catch (error) { console.error('[Monitor de reproducción]', error); }
    }
  }
  end(queue: Queue): void { this.queues.delete(queue); const state = getPlaybackState(queue); if (state) state.mode = 'ended'; }
  dispose(): void { this.disposed = true; if (this.timer) clearInterval(this.timer); this.queues.clear(); }
}

export function stallError(): Error { return Object.assign(new Error('El audio dejó de avanzar'), { errorCode: 'AUDIO_STALLED' }); }
