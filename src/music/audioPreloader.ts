import { DisTube, DisTubeStream, InfoExtractorPlugin, Queue, Song } from 'distube';
import { classifyMusicError } from './errors';
import { getPlaybackState } from './playbackState';
import { PlaybackRecovery, PreparationRecovery } from './playbackRecovery';
import { audioStreamOptions, PrebufferedStream, PREBUFFER_MAX_BYTES } from './prebufferedStream';
import { YtDlpSearchPlugin } from './ytDlpSearchPlugin';
import { observeQueueChanges } from './queueChanges';

export const PRELOAD_WINDOW_SECONDS = 30;
export const PRELOAD_URL_TTL_MS = 120_000;
export const PRELOAD_BUFFER_TTL_MS = 45_000;
export const PRELOAD_OPERATION_MS = 45_000;
const MAX_QUEUES = 100;

export class PreparationSlots {
  private occupied = 0;
  constructor(readonly limit = 2) {}
  acquire(): (() => void) | undefined {
    if (this.occupied >= this.limit) return undefined;
    this.occupied++;
    let released = false;
    return () => { if (!released) { released = true; this.occupied--; } };
  }
  get active(): number { return this.occupied; }
}
const resolutionSlots = new PreparationSlots(), bufferSlots = new PreparationSlots();
const managers = new WeakMap<DisTube, AudioPreloader>();
export function getAudioPreloader(distube: DisTube): AudioPreloader | undefined { return managers.get(distube); }

export function streamValidUntil(url: string, now: number): number {
  let until = now + PRELOAD_URL_TTL_MS;
  try {
    for (const [key, value] of new URL(url).searchParams) {
      if (!['expire', 'expires'].includes(key.toLowerCase())) continue;
      const expires = Number(value);
      if (Number.isFinite(expires) && expires > 0) until = Math.min(until, expires * 1000 - 15_000);
    }
  } catch { return now; }
  return until;
}

function copySong(song: Song): Song {
  return new Song({ plugin: song.plugin, source: song.source, id: song.id, name: song.name ?? song.id,
    duration: song.duration, isLive: Boolean(song.isLive), ageRestricted: Boolean(song.ageRestricted),
    uploader: song.uploader, playFromSource: song.stream.playFromSource,
    ...(song.url ? { url: song.url } : {}), ...(song.thumbnail ? { thumbnail: song.thumbnail } : {}) },
  { metadata: song.metadata, ...(song.member ? { member: song.member } : {}) });
}
function withCancellation<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function signature(queue: Queue): string {
  return JSON.stringify([queue.repeatMode, queue.autoplay, queue.volume, queue.ffmpegArgs, queue.filters?.ffmpegArgs]);
}
function nextSong(queue: Queue): Song | undefined {
  return queue.repeatMode === 1 ? queue.songs[0] : queue.songs[1] ?? (queue.repeatMode === 2 ? queue.songs[0] : undefined);
}
interface Entry {
  queue: Queue; head: Song; target: Song; signature: string; controller: AbortController;
  recovery: PreparationRecovery; phase: 'resolving' | 'url' | 'buffering' | 'ready' | 'failed';
  playable?: Song; url?: string; validUntil: number; bufferUntil: number;
  buffer?: PrebufferedStream; releaseBuffer?: () => void; pending?: Promise<void>;
}
export interface PreparedPlayback {
  playable: Song; url: string; fingerprint: string; replacement?: Song; stream?: PrebufferedStream;
}
export interface PreloaderOptions {
  interval?: number; clock?: () => number; enabled?: boolean;
  resolutionSlots?: PreparationSlots; bufferSlots?: PreparationSlots;
  factory?: (url: string, queue: Queue) => PrebufferedStream;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export class AudioPreloader {
  private readonly queues = new Set<Queue>();
  private readonly entries = new Map<Queue, Entry>();
  private readonly transitions = new Map<Queue, { endedAt: number; stream?: DisTubeStream; source?: string }>();
  private readonly timer: NodeJS.Timeout | undefined;
  private readonly detach: () => void;
  private progressTimer: NodeJS.Timeout | undefined;
  private readonly now: () => number;
  private readonly resolutions: PreparationSlots;
  private readonly buffers: PreparationSlots;
  private readonly factory: (url: string, queue: Queue) => PrebufferedStream;
  private disposed = false;
  private readonly enabled: boolean;
  private readonly log: (event: string, fields: Record<string, unknown>) => void;
  private readonly counts = { requested: 0, urlsReady: 0, buffersStarted: 0, buffersReady: 0,
    reusedBuffer: 0, reusedUrl: 0, fallback: 0, failures: 0, cancellations: 0, transitions: 0, gapMsTotal: 0 };

  constructor(private readonly distube: DisTube, private readonly recovery: PlaybackRecovery, options: PreloaderOptions = {}) {
    this.now = options.clock ?? Date.now;
    this.enabled = options.enabled ?? process.env['AUDIO_PRELOADER_ENABLED'] !== 'false';
    this.resolutions = options.resolutionSlots ?? resolutionSlots;
    this.buffers = options.bufferSlots ?? bufferSlots;
    this.factory = options.factory ?? ((url, queue) => new PrebufferedStream(url, audioStreamOptions(queue), queue.volume));
    this.log = options.log ?? ((event, fields) => console.info('[Precarga]', JSON.stringify({ event, ...fields })));
    managers.set(distube, this);
    this.detach = observeQueueChanges(distube, queue => this.changed(queue));
    if (this.enabled && options.interval !== 0) {
      this.timer = setInterval(() => this.tick(), options.interval ?? 1000); this.timer.unref();
    }
  }
  get metrics() {
    return { ...this.counts, tracked: this.queues.size, preparations: this.entries.size,
      activeResolutions: this.resolutions.active, activeBuffers: this.buffers.active,
      bufferSuccessPercent: this.counts.buffersStarted ? this.counts.buffersReady / this.counts.buffersStarted * 100 : 0 };
  }
  private owns(queue: Queue): boolean {
    return !this.disposed && !queue.stopped && !getPlaybackState(queue)?.closing && this.distube.getQueue(queue.id) === queue;
  }
  watch(queue: Queue): void { if (this.enabled && this.owns(queue) && this.queues.size < MAX_QUEUES) this.queues.add(queue); }
  private usableContext(queue: Queue): boolean {
    const state = getPlaybackState(queue);
    return this.owns(queue) && !queue.paused && !queue.voice.isDisconnected && !state?.blocked &&
      !state?.busy && !['recovering', 'alternative'].includes(state?.mode ?? '') &&
      (queue.voice.stream?.audioResource?.playbackDuration ?? 0) > 0;
  }
  private valid(entry: Entry, taking = false): boolean {
    const { queue } = entry;
    return this.owns(queue) && !entry.controller.signal.aborted && signature(queue) === entry.signature &&
      (taking ? queue.songs[0] === entry.target : queue.songs[0] === entry.head && nextSong(queue) === entry.target);
  }

  // Queue checkpoints call this only to invalidate. They never start network work
  // synchronously during a command or before a queue has audible playback.
  changed(queue: Queue): void {
    const entry = this.entries.get(queue);
    if (!entry) return;
    if (entry.head !== entry.target && queue.songs[0] === entry.target && this.valid(entry, true)) return; // about to hand off
    if (!this.valid(entry) || queue.paused || getPlaybackState(queue)?.blocked || getPlaybackState(queue)?.closing ||
      ['recovering', 'alternative'].includes(getPlaybackState(queue)?.mode ?? '')) this.cancel(queue, 'changed');
  }
  tick(): void {
    if (this.disposed) return;
    this.observeProgress();
    // Rotate traversal so global limits cannot indefinitely favor insertion order.
    const first = this.queues.values().next().value as Queue | undefined;
    if (first) { this.queues.delete(first); this.queues.add(first); }
    for (const queue of this.queues) {
      try { this.sync(queue); }
      catch (error) { this.log('internal_error', { guildId: queue.id, code: classifyMusicError(error) }); this.cancel(queue, 'error'); }
    }
  }
  private sync(queue: Queue): void {
    if (!this.owns(queue)) { this.end(queue); return; }
    if (!this.usableContext(queue)) { this.cancel(queue, 'inactive'); return; }
    let entry = this.entries.get(queue);
    // The new head is being consumed by startSong; don't destroy its preparation.
    if (entry && queue.songs[0] === entry.target && entry.head !== entry.target) return;
    if (entry && (!this.valid(entry) || this.now() >= entry.validUntil && entry.phase !== 'resolving' && entry.phase !== 'failed')) {
      if (entry.playable) this.plugin()?.invalidateStream(entry.playable, 0);
      this.cancel(queue, 'expired_or_reordered'); entry = undefined;
    }
    const head = queue.songs[0], target = nextSong(queue);
    if (!head || !target || !this.plugin()) { this.cancel(queue, 'no_next'); return; }
    if (!entry) {
      const release = this.resolutions.acquire();
      if (!release) return;
      const original = copySong(target);
      entry = { queue, head, target, signature: signature(queue), controller: new AbortController(),
        recovery: { original, candidate: original, renewals: 0, alternativeUsed: false },
        phase: 'resolving', validUntil: 0, bufferUntil: 0 };
      this.entries.set(queue, entry); this.counts.requested++;
      entry.pending = this.resolve(entry).finally(release);
      return;
    }
    if (entry.pending || entry.phase === 'failed') return;
    if (entry.buffer && (this.now() >= entry.bufferUntil || entry.buffer.bufferedBytes > PREBUFFER_MAX_BYTES)) {
      this.cancel(queue, 'buffer_limit'); return;
    }
    const remaining = head.duration - queue.currentTime;
    if (!head.isLive && head.duration > 0 && !target.isLive && target.duration > 0 &&
      Number.isFinite(remaining) && remaining <= PRELOAD_WINDOW_SECONDS && remaining >= 0 &&
      (entry.phase === 'url' || entry.phase === 'ready' && !entry.buffer?.usable)) {
      const release = entry.releaseBuffer ?? this.buffers.acquire();
      if (!release) return;
      entry.releaseBuffer = release; entry.phase = 'buffering'; this.counts.buffersStarted++;
      entry.pending = this.prebuffer(entry);
    }
  }
  private plugin(): YtDlpSearchPlugin | undefined {
    return this.distube.plugins?.find((plugin): plugin is YtDlpSearchPlugin => plugin instanceof YtDlpSearchPlugin);
  }
  private async playable(song: Song, signal: AbortSignal): Promise<Song> {
    if (song.stream.playFromSource) return song;
    const attached = song.stream.song;
    if (attached && attached.plugin === this.plugin()) return attached;
    const query = song.plugin instanceof InfoExtractorPlugin ? await withCancellation(Promise.resolve(song.plugin.createSearchQuery(song)), signal) : song.name;
    signal.throwIfAborted();
    if (!query) throw Object.assign(new Error('No preload query'), { errorCode: 'NO_RESULT' });
    const result = await this.plugin()!.searchSong(query, { metadata: song.metadata, ...(song.member ? { member: song.member } : {}) }, signal, 'background');
    if (!result) throw Object.assign(new Error('No preload match'), { errorCode: 'NO_RESULT' });
    song.stream.song = result;
    return result;
  }
  private async url(candidate: Song, signal: AbortSignal): Promise<{ playable: Song; url: string }> {
    const playable = await this.playable(candidate, signal), plugin = this.plugin()!;
    if (playable.plugin !== plugin) throw Object.assign(new Error('Preload requires the audio extractor'), { errorCode: 'NOT_SUPPORTED_SONG' });
    const url = await plugin.getStreamURL(playable, signal, 'background');
    signal.throwIfAborted();
    if (streamValidUntil(url, this.now()) <= this.now()) {
      plugin.invalidateStream(playable, 0);
      throw Object.assign(new Error('Preload URL already expired'), { errorCode: 'SOURCE_BLOCKED' });
    }
    return { playable, url };
  }
  private async resolve(entry: Entry): Promise<void> {
    const startedAt = this.now(), signal = AbortSignal.any([entry.controller.signal, AbortSignal.timeout(PRELOAD_OPERATION_MS)]);
    try {
      const result = await this.recovery.prepareAhead(entry.recovery, this.plugin()!, candidate => this.url(candidate, signal), signal);
      if (!this.valid(entry) && !this.valid(entry, true)) return;
      entry.playable = result.playable; entry.url = result.url;
      entry.validUntil = streamValidUntil(result.url, this.now()); entry.phase = 'url'; this.counts.urlsReady++;
      this.log('url_ready', { guildId: entry.queue.id, resolutionMs: Math.max(0, this.now() - startedAt),
        renewals: entry.recovery.renewals, alternative: entry.recovery.alternativeUsed });
    } catch (error) { this.failed(entry, error); }
    finally { delete entry.pending; }
  }
  private async prebuffer(entry: Entry): Promise<void> {
    const startedAt = this.now();
    const signal = AbortSignal.any([entry.controller.signal, AbortSignal.timeout(PRELOAD_OPERATION_MS)]);
    try {
      let priorError = entry.buffer?.failure;
      if (entry.buffer) { await entry.buffer.dispose(); delete entry.buffer; }
      await this.recovery.prepareAhead(entry.recovery, this.plugin()!, async candidate => {
        if (priorError) { const error = priorError; priorError = undefined; throw error; }
        const result = await this.url(candidate, signal);
        signal.throwIfAborted();
        if (!this.valid(entry)) throw new DOMException('Session changed', 'AbortError');
        entry.playable = result.playable; entry.url = result.url; entry.validUntil = streamValidUntil(result.url, this.now());
        const stream = this.factory(result.url, entry.queue); entry.buffer = stream;
        try {
          await stream.prepare(signal);
          if (stream.bufferedBytes > PREBUFFER_MAX_BYTES) throw Object.assign(new Error('Prebuffer memory limit'), { errorCode: 'MUSIC_BUSY' });
        } catch (error) { await stream.dispose(); if (entry.buffer === stream) delete entry.buffer; throw error; }
      }, signal);
      if (!this.valid(entry)) { this.cancel(entry.queue, 'late_buffer'); return; }
      entry.phase = 'ready'; entry.bufferUntil = Math.min(entry.validUntil, this.now() + PRELOAD_BUFFER_TTL_MS);
      this.counts.buffersReady++;
      const readyBuffer = entry.buffer as PrebufferedStream | undefined;
      this.log('audio_ready', { guildId: entry.queue.id, preparationMs: Math.max(0, this.now() - startedAt), bufferedBytesUpperBound: readyBuffer?.bufferedBytes,
        renewals: entry.recovery.renewals, alternative: entry.recovery.alternativeUsed });
    } catch (error) { this.failed(entry, error); this.releaseBuffer(entry); }
    finally { delete entry.pending; }
  }
  private failed(entry: Entry, error: unknown): void {
    if (entry.controller.signal.aborted) return;
    entry.phase = 'failed'; this.counts.failures++;
    this.log('failed', { guildId: entry.queue.id, code: classifyMusicError(error) });
  }
  private releaseBuffer(entry: Entry): void { entry.releaseBuffer?.(); delete entry.releaseBuffer; }
  compatible(queue: Queue, prepared: PreparedPlayback): boolean { return signature(queue) === prepared.fingerprint; }

  async take(queue: Queue, song: Song): Promise<PreparedPlayback | undefined> {
    if (!this.enabled) return undefined;
    const entry = this.entries.get(queue);
    if (entry && entry.target === song && this.valid(entry, true) && !queue._beginTime) {
      if (entry.phase === 'resolving') await entry.pending;
      if (this.valid(entry, true) && entry.phase !== 'failed' && entry.url && entry.playable && entry.validUntil > this.now()) {
        const result: PreparedPlayback = { playable: entry.playable, url: entry.url, fingerprint: entry.signature };
        if (entry.recovery.candidate !== entry.recovery.original) result.replacement = entry.recovery.candidate;
        if (entry.phase === 'ready' && entry.buffer?.usable && entry.bufferUntil > this.now() && entry.buffer.bufferedBytes <= PREBUFFER_MAX_BYTES) {
          result.stream = entry.buffer; delete entry.buffer; this.releaseBuffer(entry);
        }
        this.entries.delete(queue);
        entry.controller.abort();
        if (entry.buffer) void entry.buffer.dispose().finally(() => this.releaseBuffer(entry));
        this.log('acquired', { guildId: queue.id, source: result.stream ? 'buffer' : 'url' });
        return result;
      }
    }
    if (entry?.playable && entry.validUntil <= this.now()) {
      this.plugin()?.invalidateStream(entry.playable, 0);
      if (entry.target === song) this.plugin()?.invalidateStream(song, 0);
    }
    this.cancel(queue, 'fallback');
    return undefined;
  }
  cancel(queue: Queue, reason: string): void {
    const entry = this.entries.get(queue);
    if (!entry) return;
    this.entries.delete(queue); entry.controller.abort(); this.counts.cancellations++;
    if (entry.buffer) void entry.buffer.dispose().finally(() => this.releaseBuffer(entry));
    else if (!entry.pending) this.releaseBuffer(entry);
    this.log('cancelled', { guildId: queue.id, reason });
  }
  end(queue: Queue): void { this.cancel(queue, 'ended'); this.queues.delete(queue); this.transitions.delete(queue); }
  finished(queue: Queue): void {
    if (!this.enabled || !this.owns(queue) || this.transitions.has(queue)) return;
    this.transitions.set(queue, { endedAt: this.now() });
  }
  started(queue: Queue, stream: DisTubeStream, source: string): void {
    if (!this.enabled) return;
    if (source === 'buffer') this.counts.reusedBuffer++;
    else if (source === 'url') this.counts.reusedUrl++;
    else this.counts.fallback++;
    this.log('used', { guildId: queue.id, source });
    const transition = this.transitions.get(queue);
    if (transition) {
      transition.stream = stream; transition.source = source;
      if (!this.progressTimer && this.timer) { this.progressTimer = setInterval(() => this.observeProgress(), 50); this.progressTimer.unref(); }
    }
    this.watch(queue);
  }
  private observeProgress(): void {
    for (const [queue, transition] of this.transitions) {
      if (!this.owns(queue)) { this.transitions.delete(queue); continue; }
      const gapMs = Math.max(0, this.now() - transition.endedAt);
      if (transition.stream && queue.voice.stream === transition.stream && transition.stream.audioResource.playbackDuration > 0) {
        this.counts.transitions++; this.counts.gapMsTotal += gapMs;
        this.log('transition', { guildId: queue.id, gapMs, source: transition.source, observationMs: 50 });
        this.transitions.delete(queue);
      } else if (gapMs >= 60_000) { this.log('transition_unconfirmed', { guildId: queue.id, elapsedMs: gapMs }); this.transitions.delete(queue); }
    }
    if (!this.transitions.size && this.progressTimer) { clearInterval(this.progressTimer); this.progressTimer = undefined; }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    if (this.timer) clearInterval(this.timer);
    if (this.progressTimer) clearInterval(this.progressTimer);
    for (const queue of this.entries.keys()) this.cancel(queue, 'shutdown');
    this.queues.clear(); this.transitions.clear();
    this.log('summary', this.metrics);
    if (managers.get(this.distube) === this) managers.delete(this.distube);
  }
}
