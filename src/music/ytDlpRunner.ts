import { json } from '@distube/yt-dlp';
import { setTimeout as delay } from 'node:timers/promises';
import { classifyMusicError } from './errors';

export type YtDlpFlags = NonNullable<Parameters<typeof json>[1]> & { jsRuntimes?: string };
const TRANSIENT = new Set(['NETWORK_TIMEOUT', 'NETWORK_ERROR', 'SOURCE_UNAVAILABLE']);
export function isTransientMusicError(error: unknown): boolean {
  return TRANSIENT.has(classifyMusicError(error));
}

export class ExtractionPool {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly limit = 3, private readonly maxWaiting = 50) {}

  async run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.limit) {
      if (this.waiting.length >= this.maxWaiting) throw Object.assign(new Error('Demasiadas consultas pendientes'), { code: 'MUSIC_BUSY' });
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          const index = this.waiting.indexOf(start);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(signal.reason);
        };
        const start = () => {
          signal.removeEventListener('abort', abort);
          resolve();
        };
        this.waiting.push(start);
        signal.addEventListener('abort', abort, { once: true });
      });
    } else {
      this.active += 1;
    }
    try {
      signal.throwIfAborted();
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // Transfer the occupied slot to the next caller.
      else this.active -= 1;
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

export async function runYtDlp(input: string, flags: YtDlpFlags = {}, signal?: AbortSignal): Promise<unknown> {
  const deadline = AbortSignal.timeout(60_000);
  const budget = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    return await retryTransient(async () => {
      const attempt = AbortSignal.any([budget, AbortSignal.timeout(20_000)]);
      try {
        return await pool.run(() => json(input, {
          dumpSingleJson: true, noWarnings: true, skipDownload: true, simulate: true,
          jsRuntimes: `node:${process.execPath}`,
          socketTimeout: 8, retries: 0, extractorRetries: 0,
          ...flags,
        }, { signal: attempt, windowsHide: true }), attempt);
      } catch (error) {
        if (attempt.aborted) throw Object.assign(new Error('yt-dlp: tiempo de espera agotado', { cause: error }), { code: 'ETIMEDOUT' });
        throw error;
      }
    }, budget);
  } catch (error) {
    if (budget.aborted) throw Object.assign(new Error('yt-dlp: tiempo total de espera agotado', { cause: error }), { code: 'ETIMEDOUT' });
    throw error;
  }
}
