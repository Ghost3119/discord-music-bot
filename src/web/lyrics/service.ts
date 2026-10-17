import type { LyricsProvider, LyricsQuery, LyricsResult, LyricsSearchResult, LyricsFailureReason } from './contracts';
import { cleanLyricsQuery, isLyricsRecord, lyricsCandidate, matchLyrics, resultForLyricsRecord, type LyricsRecord } from './matching';

export interface LyricsService extends LyricsProvider {
  searchLyrics?(query: LyricsQuery, signal?: AbortSignal): Promise<LyricsSearchResult>;
  selectLyrics?(recordId: number, signal?: AbortSignal): Promise<LyricsResult>;
  close(): void;
}
export interface LyricsServiceOptions {
  fetch?: typeof fetch; now?: () => number; requestTimeoutMs?: number; requestDelayMs?: number;
  lookupTimeoutMs?: number; maxPending?: number; cacheTtlMs?: number; negativeTtlMs?: number; maxCacheEntries?: number;
}
type OperationResult = LyricsResult | LyricsSearchResult;
interface Subscriber { resolve: (result: OperationResult) => void; reject: (reason: unknown) => void; cleanup: () => void }
interface Job { key: string; run: (signal: AbortSignal) => Promise<OperationResult>; controller: AbortController; subscribers: Set<Subscriber>; settled: boolean; timer: ReturnType<typeof setTimeout> }
interface CacheEntry { result: OperationResult; expiresAt: number }
const MAX_SEARCH_BODY_BYTES = 1_048_576;
const MAX_RECORD_BODY_BYTES = 262_144;
const USER_AGENT = 'SONORA v1.0 (https://github.com/Ghost3119/discord-music-bot)';
const temporary = (retryAfterMs = 30_000, reason: LyricsFailureReason = 'unavailable'): Extract<LyricsResult, { status: 'temporary_error' }> => ({ status: 'temporary_error', retryAfterMs: Math.min(2_147_483_647, Math.max(1000, Math.ceil(retryAfterMs))), reason });
const abortError = (): Error => Object.assign(new Error('Lyrics request cancelled'), { name: 'AbortError' });
class ProviderFailure extends Error { constructor(readonly retryAfterMs: number, readonly reason: LyricsFailureReason = 'unavailable') { super('Lyrics provider unavailable'); } }
function providerErrorReason(error: unknown, response?: Response): LyricsFailureReason {
  if (error instanceof ProviderFailure) return error.reason;
  const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;
  const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' ? cause.code : '';
  if (/^(?:ETIMEDOUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT)$/.test(code)) return 'timeout';
  if (/^(?:ENOTFOUND|EAI_AGAIN|ECONN|ENET|EHOST|UND_ERR_SOCKET)/.test(code)) return 'connection';
  if (error instanceof SyntaxError || error instanceof TypeError && response?.status === 200) return 'invalid_response';
  return error instanceof TypeError ? 'connection' : 'unavailable';
}
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = (): void => { reject(abortError()); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = (): void => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
function retryDelay(header: string | null, now: number, fallback: number): number {
  if (!header) return fallback;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(1000, date - now) : fallback;
}
async function readBoundedJson(response: Response, signal: AbortSignal, maxBytes: number): Promise<unknown> {
  if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new ProviderFailure(30_000, 'invalid_response');
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new ProviderFailure(30_000, 'invalid_response');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderFailure(30_000, 'invalid_response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ProviderFailure(30_000, 'invalid_response');
      chunks.push(value);
    }
    // Content-Length describes encoded bytes when compression is present.
    if (length !== null && !response.headers.has('content-encoding') && Number(length) !== size) throw new ProviderFailure(30_000, 'invalid_response');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } finally {
    void reader.cancel().catch(() => {});
  }
}

/** Private, bounded RAM cache. One HTTP request at a time, with LRCLIB's required spacing. */
export function createLyricsService(options: LyricsServiceOptions = {}): LyricsService {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const delayMs = options.requestDelayMs ?? 300;
  const timeoutMs = options.requestTimeoutMs ?? 8000;
  const lookupTimeoutMs = options.lookupTimeoutMs ?? 20_000;
  const maxPending = options.maxPending ?? 8;
  const maxCache = options.maxCacheEntries ?? 64;
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Job>();
  const queue: Job[] = [];
  let running = false, closed = false, lastRequestFinished = -Infinity, cooldownUntil = 0, failures = 0;
  let cooldownReason: LyricsFailureReason = 'unavailable';

  function remember(key: string, result: OperationResult): void {
    if (result.status === 'temporary_error') return;
    const ttl = result.status === 'not_found' || result.status === 'ambiguous' || result.status === 'results' && !result.candidates.length ? options.negativeTtlMs ?? 60_000 : options.cacheTtlMs ?? 600_000;
    if (ttl <= 0 || maxCache <= 0) return;
    for (const [cacheKey, entry] of cache) if (entry.expiresAt <= now()) cache.delete(cacheKey);
    cache.delete(key);
    while (cache.size >= maxCache) cache.delete(cache.keys().next().value!);
    cache.set(key, { result: structuredClone(result), expiresAt: now() + ttl });
  }
  function settle(job: Job, result?: OperationResult): void {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    if (inflight.get(job.key) === job) inflight.delete(job.key);
    for (const subscriber of job.subscribers) {
      subscriber.cleanup();
      if (result) subscriber.resolve(structuredClone(result)); else subscriber.reject(abortError());
    }
    job.subscribers.clear();
  }
  async function request(url: URL, signal: AbortSignal, single = false): Promise<unknown> {
    signal.throwIfAborted();
    if (cooldownUntil > now()) throw new ProviderFailure(cooldownUntil - now(), cooldownReason);
    await wait(Math.max(0, lastRequestFinished + delayMs - now()), signal);
    signal.throwIfAborted();
    if (cooldownUntil > now()) throw new ProviderFailure(cooldownUntil - now(), cooldownReason);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const combined = AbortSignal.any([signal, timeout.signal]);
    let response: Response | undefined;
    try {
      response = await raceAbort(fetcher(url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, redirect: 'error', signal: combined }), combined);
      if (response.status === 429 || response.status === 503) {
        const retry = retryDelay(response.headers.get('retry-after'), now(), response.status === 429 ? 60_000 : 1000);
        cooldownUntil = Math.max(cooldownUntil, now() + retry);
        throw new ProviderFailure(retry, response.status === 429 ? 'rate_limited' : 'unavailable');
      }
      if (response.status === 404) { failures = 0; return single ? null : []; }
      if (response.status !== 200) throw new ProviderFailure(30_000);
      const body = await readBoundedJson(response, combined, single ? MAX_RECORD_BODY_BYTES : MAX_SEARCH_BODY_BYTES);
      if (single ? !isLyricsRecord(body) : !Array.isArray(body) || body.length > 20 || body.length > 0 && !body.some(isLyricsRecord)) throw new ProviderFailure(30_000, 'invalid_response');
      failures = 0;
      return body;
    } catch (error) {
      if (signal.aborted) throw abortError();
      const retry = error instanceof ProviderFailure ? error.retryAfterMs : 30_000;
      const reason = timeout.signal.aborted ? 'timeout' : providerErrorReason(error, response);
      cooldownReason = reason;
      failures++;
      cooldownUntil = Math.max(cooldownUntil, now() + Math.min(retry, 1000 * 2 ** Math.min(5, failures - 1)));
      throw new ProviderFailure(retry, reason);
    } finally {
      clearTimeout(timer);
      lastRequestFinished = now();
      void response?.body?.cancel().catch(() => {});
    }
  }
  async function search(query: LyricsQuery, signal: AbortSignal): Promise<LyricsRecord[]> {
    const url = new URL('https://lrclib.net/api/search');
    url.searchParams.set('track_name', query.title);
    url.searchParams.set('artist_name', query.artist);
    if (query.album) url.searchParams.set('album_name', query.album);
    return (await request(url, signal) as unknown[]).filter(isLyricsRecord);
  }
  async function lookup(query: LyricsQuery, signal: AbortSignal): Promise<LyricsResult> {
    if (!query.title.trim() || !query.artist.trim() || query.title.length > 200 || query.artist.length > 200 || (query.album?.length ?? 0) > 200
      || !Number.isFinite(query.duration) || query.duration <= 0) return { status: 'ambiguous' };
    const first = await search(query, signal);
    let result = matchLyrics(query, first);
    const clean = cleanLyricsQuery(query);
    if ((result.status === 'not_found' || result.status === 'ambiguous') && (clean.title !== query.title || clean.artist !== query.artist)) {
      const second = await search(clean, signal);
      result = matchLyrics(query, second);
    }
    return result;
  }
  async function drain(): Promise<void> {
    if (running || closed) return;
    running = true;
    try {
      while (queue.length && !closed) {
        const job = queue.shift()!;
        if (job.settled || job.controller.signal.aborted) continue;
        try {
          const result = await job.run(job.controller.signal);
          if (!job.settled && !job.controller.signal.aborted) { remember(job.key, result); settle(job, result); }
        } catch (error) {
          if (!job.settled) settle(job, job.controller.signal.aborted ? undefined : temporary(error instanceof ProviderFailure ? error.retryAfterMs : 30_000, error instanceof ProviderFailure ? error.reason : 'unavailable'));
        }
      }
    } finally { running = false; }
  }
  function enqueue<T extends OperationResult>(key: string, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (closed || signal?.aborted) return Promise.reject(abortError());
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) {
        cache.delete(key); cache.set(key, cached);
        return Promise.resolve(structuredClone(cached.result) as T);
      }
      if (cached) cache.delete(key);
      let job = inflight.get(key);
      if (!job) {
        if (cooldownUntil > now()) return Promise.resolve(temporary(cooldownUntil - now(), cooldownReason) as T);
        if (inflight.size >= maxPending) return Promise.resolve(temporary(1000, 'busy') as T);
        const controller = new AbortController();
        job = { key, run, controller, subscribers: new Set(), settled: false, timer: setTimeout(() => {}, 0) };
        clearTimeout(job.timer);
        const pending = job;
        job.timer = setTimeout(() => { settle(pending, temporary(30_000, 'timeout')); pending.controller.abort(); }, lookupTimeoutMs);
        inflight.set(key, job);
        queue.push(job);
      }
      const pending = job;
      const result = new Promise<OperationResult>((resolve, reject) => {
        const abort = (): void => {
          pending.subscribers.delete(subscriber);
          subscriber.cleanup(); reject(abortError());
          if (!pending.subscribers.size) { settle(pending); pending.controller.abort(); }
        };
        const subscriber: Subscriber = { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) };
        pending.subscribers.add(subscriber);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
      void drain();
      return result as Promise<T>;
  }
  function queryKey(query: LyricsQuery): unknown[] {
    const clean = cleanLyricsQuery(query);
    return [clean.title, clean.artist, clean.album ?? '', query.duration, query.durationReliable !== false];
  }
  return {
    findLyrics(query, signal): Promise<LyricsResult> {
      const snapshot = { ...query };
      return enqueue(JSON.stringify(['auto', ...queryKey(snapshot)]), abort => lookup(snapshot, abort), signal);
    },
    searchLyrics(query, signal): Promise<LyricsSearchResult> {
      if (!query.title.trim() || !query.artist.trim() || query.title.length > 200 || query.artist.length > 200 || (query.album?.length ?? 0) > 200
        || !Number.isFinite(query.duration) || query.duration <= 0) return Promise.resolve(temporary(30_000, 'invalid_response'));
      const snapshot = { ...query };
      return enqueue(JSON.stringify(['search', ...queryKey(snapshot)]), async abort => {
        const records = await search(cleanLyricsQuery(snapshot), abort);
        return { status: 'results', candidates: records.map(record => lyricsCandidate(snapshot, record)) };
      }, signal);
    },
    selectLyrics(recordId, signal): Promise<LyricsResult> {
      if (!Number.isSafeInteger(recordId) || recordId <= 0) return Promise.resolve(temporary(30_000, 'invalid_response'));
      return enqueue(JSON.stringify(['record', recordId]), async abort => {
        const record = await request(new URL(`https://lrclib.net/api/get/${recordId}`), abort, true);
        if (record === null) return { status: 'not_found' };
        if (!isLyricsRecord(record) || record.id !== recordId) return temporary(30_000, 'invalid_response');
        return resultForLyricsRecord(record);
      }, signal);
    },
    close(): void {
      closed = true;
      for (const job of inflight.values()) { settle(job); job.controller.abort(); }
      queue.length = 0; cache.clear();
    },
  };
}
