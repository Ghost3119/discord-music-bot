import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Queue, Song } from 'distube';

export interface HistoryEntry {
  id: string; guildId: string; title: string; source: string; time: number;
  result: 'completed' | 'skipped' | 'failed'; code: string; reference: string;
  url: string | undefined; searchSource: 'youtube' | 'soundcloud'; alternative: string | undefined;
}
interface Request { id: string; original: Song; done: boolean; }
const WEEK = 7 * 24 * 60 * 60_000;
export function publicMusicUrl(input: string | undefined): string | undefined {
  if (!input || input.length > 1000) return undefined;
  try {
    const url = new URL(input ?? '');
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase();
    if (['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
      const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
      return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : undefined;
    }
    if (['soundcloud.com', 'www.soundcloud.com'].includes(host) && /^\/[^/]+\/[^/]+\/?$/.test(url.pathname)) return `https://soundcloud.com${url.pathname}`;
    if (host === 'open.spotify.com' && /^\/track\/[a-zA-Z0-9]+$/.test(url.pathname)) return `${url.origin}${url.pathname}`;
    if (host === 'music.apple.com' && url.pathname.includes('/album/') && /^\d+$/.test(url.searchParams.get('i') ?? '')) return `${url.origin}${url.pathname}?i=${url.searchParams.get('i')}`;
  } catch { /* Unusable sources stay visible without a retry button. */ }
  return undefined;
}

export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private readonly requests = new WeakMap<Queue, WeakMap<Song, Request>>();
  private readonly claims = new Map<string, number>();
  private pending: Promise<void> | undefined;
  private dirty = false;
  private retryAt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly path?: string) {
    if (!path) return;
    try {
      if (!existsSync(path)) return;
      if (statSync(path).size > 3_000_000) throw new Error('Historial demasiado grande');
      const input: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!Array.isArray(input)) throw new Error('Formato de historial inválido');
      this.entries = input.slice(0, 2000).filter((e): e is HistoryEntry => Boolean(e && typeof e === 'object' &&
        /^[a-f0-9]{16}$/.test(e.id) && /^\d{15,22}$/.test(e.guildId) && typeof e.title === 'string' && e.title.length <= 200 &&
        typeof e.source === 'string' && e.source.length <= 60 && Number.isFinite(e.time) && e.time <= Date.now() &&
        ['completed', 'skipped', 'failed'].includes(e.result) && typeof e.code === 'string' && /^[A-Z0-9_]{0,64}$/.test(e.code) &&
        typeof e.reference === 'string' && /^[a-f0-9]{0,16}$/.test(e.reference) &&
        (!e.url || publicMusicUrl(e.url) === e.url) && ['youtube', 'soundcloud'].includes(e.searchSource) &&
        (!e.alternative || typeof e.alternative === 'string' && e.alternative.length <= 200)));
      this.prune();
    } catch (error) { console.error('[Historial] No se pudo leer; el bot continúa:', error); }
  }
  private book(queue: Queue): WeakMap<Song, Request> {
    let book = this.requests.get(queue);
    if (!book) { book = new WeakMap(); this.requests.set(queue, book); }
    return book;
  }
  begin(queue: Queue, song: Song): void {
    const book = this.book(queue), current = book.get(song);
    if (!current || current.done) book.set(song, { id: randomBytes(8).toString('hex'), original: song, done: false });
  }
  alias(queue: Queue, original: Song, alternative: Song): void {
    if (!this.book(queue).has(original)) this.begin(queue, original);
    this.book(queue).set(alternative, this.book(queue).get(original)!);
  }
  finish(queue: Queue, song: Song, result: HistoryEntry['result'], code = '', reference = ''): boolean {
    const book = this.book(queue);
    if (!book.has(song)) this.begin(queue, song);
    const request = book.get(song)!;
    if (request.done) return false;
    request.done = true;
    const original = request.original;
    const source = (song.stream.playFromSource ? song.source : song.stream.song?.source) ?? song.source;
    this.entries.unshift({ id: request.id, guildId: queue.id, title: (original.name ?? 'Canción sin título').slice(0, 200),
      source: source.slice(0, 60), time: Date.now(), result, code: code.slice(0, 64), reference,
      url: publicMusicUrl(original.url), searchSource: source.includes('soundcloud') ? 'soundcloud' : 'youtube',
      alternative: song !== original ? (song.name ?? '').slice(0, 200) : undefined });
    this.prune(); this.save(); return true;
  }
  list(guildId: string): HistoryEntry[] { this.prune(); return this.entries.filter(e => e.guildId === guildId).map(e => ({ ...e })); }
  get(guildId: string, id: string): HistoryEntry | undefined { return this.list(guildId).find(e => e.id === id); }
  claim(guildId: string, id: string): HistoryEntry | undefined {
    const entry = this.get(guildId, id), key = `${guildId}:${id}`, now = Date.now();
    for (const [claim, time] of this.claims) if (now - time >= 30_000) this.claims.delete(claim);
    if (!entry?.url || this.claims.has(key)) return undefined;
    if (this.claims.size >= 2000) this.claims.delete(this.claims.keys().next().value!);
    this.claims.set(key, now); return entry;
  }
  private prune(): void {
    const counts = new Map<string, number>(), now = Date.now();
    let bytes = 2;
    this.entries = this.entries.filter(e => {
      const count = counts.get(e.guildId) ?? 0;
      if (now - e.time > WEEK || count >= 100) return false;
      const size = Buffer.byteLength(JSON.stringify(e)) + 1;
      if (bytes + size > 2_500_000) return false;
      bytes += size;
      counts.set(e.guildId, count + 1); return true;
    }).slice(0, 2000);
  }
  private save(): void {
    if (!this.path || this.closed) return;
    this.dirty = true;
    void this.write();
  }
  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }
  private scheduleRetry(): void {
    if (!this.path || this.closed || !this.dirty || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.write();
    }, Math.max(0, this.retryAt - Date.now()));
    this.retryTimer.unref();
  }
  private write(force = false): Promise<void> | undefined {
    if (this.pending) return this.pending;
    if (!this.path || !this.dirty || this.closed && !force) return undefined;
    if (!force && Date.now() < this.retryAt) { this.scheduleRetry(); return undefined; }
    this.clearRetry();
    this.pending = (async () => {
      try {
        await mkdir(dirname(this.path!), { recursive: true });
        while (this.dirty) {
          this.prune();
          this.dirty = false;
          await writeFile(`${this.path}.tmp`, JSON.stringify(this.entries), { mode: 0o600 });
          await rename(`${this.path}.tmp`, this.path!);
        }
        this.retryAt = 0;
      } catch (error) {
        this.retryAt = Date.now() + 60_000;
        this.dirty = true;
        console.error(this.closed ? '[Historial] No se pudo guardar durante el cierre:' :
          '[Historial] No se pudo guardar; se reintentará en 60 segundos:', error);
      } finally {
        this.pending = undefined;
        this.scheduleRetry();
      }
    })();
    return this.pending;
  }
  async flush(): Promise<void> { await this.write(); }
  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      this.clearRetry();
      this.closing = (async () => {
        await this.pending;
        // One final attempt may bypass the cooldown; failures never restart it.
        await this.write(true);
      })();
    }
    return this.closing;
  }
}
