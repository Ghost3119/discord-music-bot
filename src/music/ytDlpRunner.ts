import { json } from '@distube/yt-dlp';
import { setTimeout as delay } from 'node:timers/promises';
import { classifyMusicError } from './errors';

export type YtDlpFlags = NonNullable<Parameters<typeof json>[1]> & { jsRuntimes?: string };
export type ExtractionPriority = 'interactive' | 'background';
const TRANSIENT = new Set(['NETWORK_TIMEOUT', 'NETWORK_ERROR', 'SOURCE_UNAVAILABLE']);
export function isTransientMusicError(error: unknown): boolean {
  return TRANSIENT.has(classifyMusicError(error));
}

export class ExtractionPool {
  private active = 0;
  private readonly waiting: { start: () => void; priority: ExtractionPriority }[] = [];
  private interactiveGrants = 0;
  constructor(private readonly limit = 3, private readonly maxWaiting = 50) {}

  async run<T>(task: () => Promise<T>, signal: AbortSignal, priority: ExtractionPriority = 'interactive'): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.limit) {
      const reserved = Math.min(this.limit, Math.max(0, this.maxWaiting - 1));
      const background = this.waiting.filter(waiter => waiter.priority === 'background').length;
      if (this.waiting.length >= this.maxWaiting || priority === 'background' && background >= this.maxWaiting - reserved) {
        throw Object.assign(new Error('Demasiadas consultas pendientes'), { code: 'MUSIC_BUSY' });
      }
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          const index = this.waiting.indexOf(waiter);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(signal.reason);
        };
        const start = () => {
          signal.removeEventListener('abort', abort);
          resolve();
        };
        const waiter = { start, priority };
        this.waiting.push(waiter);
        signal.addEventListener('abort', abort, { once: true });
      });
    } else {
      this.active += 1;
    }
    try {
      signal.throwIfAborted();
      return await task();
    } finally {
      const interactive = this.waiting.findIndex(waiter => waiter.priority === 'interactive');
      const background = this.waiting.findIndex(waiter => waiter.priority === 'background');
      // Prefer user work, but give warmups a slot after at most three user grants.
      const index = background !== -1 && (interactive === -1 || this.interactiveGrants >= 3) ? background : interactive;
      const next = index === -1 ? undefined : this.waiting.splice(index, 1)[0];
      if (next) {
        this.interactiveGrants = next.priority === 'background' ? 0 : Math.min(3, this.interactiveGrants + 1);
        next.start(); // Transfer the occupied slot to the next caller.
      } else {
        this.interactiveGrants = 0;
        this.active -= 1;
      }
    }
  }
}

const pool = new ExtractionPool();

export async function retryTransient<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  retries = 2,
  wait: (ms: number, signal: AbortSignal) => Promise<unknown> = (ms, abort) => delay(ms, undefined, { signal: abort }),
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      if (signal.aborted || attempt >= retries || !isTransientMusicError(error)) throw error;
      await wait(500 * 2 ** attempt, signal);
    }
  }
}

export async function runYtDlp(
  input: string,
  flags: YtDlpFlags = {},
  signal?: AbortSignal,
  priority: ExtractionPriority = 'interactive',
): Promise<unknown> {
  // Waiting for a slot and retry backoff share the total operation budget.
  const deadline = AbortSignal.timeout(60_000);
  const budget = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    return await retryTransient(() => pool.run(async () => {
      // Only a real extraction consumes an attempt and its 20 s allowance.
      const attempt = AbortSignal.any([budget, AbortSignal.timeout(20_000)]);
      try {
        return await json(input, {
          dumpSingleJson: true, noWarnings: true, skipDownload: true, simulate: true,
          jsRuntimes: `node:${process.execPath}`,
          socketTimeout: 8, retries: 0, extractorRetries: 0,
          ...flags,
        }, { signal: attempt, windowsHide: true });
      } catch (error) {
        budget.throwIfAborted();
        if (attempt.aborted) throw Object.assign(new Error('yt-dlp: tiempo de espera agotado', { cause: error }), { code: 'ETIMEDOUT' });
        throw error;
      }
    }, budget, priority), budget);
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted) throw Object.assign(new Error('yt-dlp: tiempo total de espera agotado', { cause: error }), { code: 'ETIMEDOUT' });
    throw error;
  }
}
