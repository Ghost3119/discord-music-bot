import { createJsonHistoryStorage } from '../infrastructure/json/history';
import { publicMusicUrl, type HistoryEntry, type HistoryStorage } from '../domain/persistence/history';
export { publicMusicUrl, type HistoryEntry } from '../domain/persistence/history';
import { randomBytes } from 'node:crypto';
import { Queue, Song } from 'distube';

interface Request { id: string; original: Song; done: boolean; }
const WEEK = 7 * 24 * 60 * 60_000;

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
  private readonly storage: HistoryStorage | undefined;
  constructor(path?: string, storage?: HistoryStorage) {
    this.storage = storage ?? (path ? createJsonHistoryStorage(path) : undefined);
    if (!this.storage) return;
    try { this.entries = this.storage.read(); this.prune(); }
    catch (error) { console.error('[Historial] No se pudo leer; el bot continúa:', error); }
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
    if (!this.storage || this.closed) return;
    this.dirty = true;
    void this.write();
  }
  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }
  private scheduleRetry(): void {
    if (!this.storage || this.closed || !this.dirty || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.write();
    }, Math.max(0, this.retryAt - Date.now()));
    this.retryTimer.unref();
  }
  private write(force = false): Promise<void> | undefined {
    if (this.pending) return this.pending;
    if (!this.storage || !this.dirty || this.closed && !force) return undefined;
    if (!force && Date.now() < this.retryAt) { this.scheduleRetry(); return undefined; }
    this.clearRetry();
    this.pending = (async () => {
      try {
        while (this.dirty) {
          this.prune();
          this.dirty = false;
          await this.storage!.write(this.entries);
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
