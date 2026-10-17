import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, asc, eq, lte } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as schema from './schema';
import type { Track } from './contracts';
import { youtubeThumbnail } from '../music/artwork';

export interface WebUser { id: string; username: string; avatar: string | null }
export interface WebSession { user: WebUser; tokenHash: string; csrfHash: string; expiresAt: number }
export interface SavedPlaylist { id: string; name: string; tracks: Track[] }
export type TrackMetadata = Omit<Track, 'id'>;
export class WebError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}
export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function csrfTokenFor(token: string): string { return hashToken(`dashboard-csrf:${token}`); }

function track(row: TrackMetadata & { id: string }): Track {
  return { id: row.id, url: row.url, title: row.title, artist: row.artist, duration: row.duration, thumbnail: row.thumbnail || youtubeThumbnail(row.source, undefined, row.url) || null, source: row.source };
}

/** Synchronous, short SQLite transactions never contain network or playback work. */
export class WebDatabase {
  readonly orm: BetterSQLite3Database<typeof schema>;
  constructor(readonly sqlite: Database.Database) { this.orm = drizzle(sqlite, { schema }); }
  close(): void { this.sqlite.close(); }
  createSession(user: WebUser, now: number, ttlMs: number): { token: string; csrfToken: string } {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = csrfTokenFor(token);
    this.orm.transaction(tx => {
      tx.insert(schema.users).values({ ...user, updatedAt: now }).onConflictDoUpdate({ target: schema.users.id, set: { username: user.username, avatar: user.avatar, updatedAt: now } }).run();
      tx.delete(schema.webSessions).where(lte(schema.webSessions.expiresAt, now)).run();
      tx.insert(schema.webSessions).values({ tokenHash: hashToken(token), csrfHash: hashToken(csrfToken), userId: user.id, createdAt: now, expiresAt: now + ttlMs }).run();
    });
    return { token, csrfToken };
  }
  getSession(token: string | undefined, now: number): WebSession | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = this.orm.select({ session: schema.webSessions, user: schema.users }).from(schema.webSessions).innerJoin(schema.users, eq(schema.users.id, schema.webSessions.userId)).where(eq(schema.webSessions.tokenHash, hashToken(token))).get();
    if (!row) return null;
    if (row.session.expiresAt <= now) { this.deleteSession(token); return null; }
    return { user: { id: row.user.id, username: row.user.username, avatar: row.user.avatar }, tokenHash: row.session.tokenHash, csrfHash: row.session.csrfHash, expiresAt: row.session.expiresAt };
  }
  deleteSession(token: string | undefined): void {
    if (token) this.orm.delete(schema.webSessions).where(eq(schema.webSessions.tokenHash, hashToken(token))).run();
  }
  purgeExpired(now: number): void { this.orm.delete(schema.webSessions).where(lte(schema.webSessions.expiresAt, now)).run(); }
  ensureGuild(guildId: string, now: number): void {
    this.orm.insert(schema.guildSettings).values({ guildId, updatedAt: now }).onConflictDoNothing().run();
  }
  listPlaylists(userId: string, guildId: string): SavedPlaylist[] {
    return this.orm.select().from(schema.playlists).where(and(eq(schema.playlists.userId, userId), eq(schema.playlists.guildId, guildId))).orderBy(asc(schema.playlists.createdAt)).all().map(row => ({ id: row.id, name: row.name, tracks: this.playlistTracks(row.id) }));
  }
  private playlistTracks(playlistId: string): Track[] {
    return this.orm.select().from(schema.playlistTracks).where(eq(schema.playlistTracks.playlistId, playlistId)).orderBy(asc(schema.playlistTracks.position)).all().map(track);
  }
  getPlaylist(userId: string, guildId: string, playlistId: string): SavedPlaylist {
    const row = this.orm.select().from(schema.playlists).where(and(eq(schema.playlists.id, playlistId), eq(schema.playlists.userId, userId), eq(schema.playlists.guildId, guildId))).get();
    if (!row) throw new WebError(404, 'Playlist not found');
    return { id: row.id, name: row.name, tracks: this.playlistTracks(playlistId) };
  }
  createPlaylist(userId: string, guildId: string, name: string, now: number): SavedPlaylist {
    if (this.listPlaylists(userId, guildId).length >= 100) throw new WebError(409, 'Playlist limit reached');
    const id = randomUUID();
    this.orm.transaction(tx => {
      tx.insert(schema.guildSettings).values({ guildId, updatedAt: now }).onConflictDoNothing().run();
      tx.insert(schema.playlists).values({ id, userId, guildId, name, createdAt: now }).run();
    });
    return { id, name, tracks: [] };
  }
  renamePlaylist(userId: string, guildId: string, id: string, name: string): SavedPlaylist {
    this.getPlaylist(userId, guildId, id);
    this.orm.update(schema.playlists).set({ name }).where(eq(schema.playlists.id, id)).run();
    return this.getPlaylist(userId, guildId, id);
  }
  deletePlaylist(userId: string, guildId: string, id: string): void {
    this.getPlaylist(userId, guildId, id);
    this.orm.delete(schema.playlists).where(eq(schema.playlists.id, id)).run();
  }
  addPlaylistTrack(userId: string, guildId: string, playlistId: string, metadata: TrackMetadata): Track {
    const playlist = this.getPlaylist(userId, guildId, playlistId);
    if (playlist.tracks.length >= 500) throw new WebError(409, 'Playlist track limit reached');
    const row = { ...metadata, id: randomUUID(), playlistId, position: playlist.tracks.length };
    this.orm.insert(schema.playlistTracks).values(row).run();
    return track(row);
  }
  deletePlaylistTrack(userId: string, guildId: string, playlistId: string, trackId: string): void {
    const playlist = this.getPlaylist(userId, guildId, playlistId);
    if (!playlist.tracks.some(item => item.id === trackId)) throw new WebError(404, 'Track not found');
    this.orm.transaction(() => {
      this.orm.delete(schema.playlistTracks).where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.id, trackId))).run();
      this.writeOrder(playlistId, playlist.tracks.filter(item => item.id !== trackId).map(item => item.id));
    });
  }
  reorderPlaylist(userId: string, guildId: string, playlistId: string, trackIds: string[]): SavedPlaylist {
    const playlist = this.getPlaylist(userId, guildId, playlistId);
    const existing = new Set(playlist.tracks.map(item => item.id));
    if (existing.size !== trackIds.length || new Set(trackIds).size !== trackIds.length || trackIds.some(id => !existing.has(id))) throw new WebError(400, 'trackIds must contain every playlist track exactly once');
    this.orm.transaction(() => this.writeOrder(playlistId, trackIds));
    return this.getPlaylist(userId, guildId, playlistId);
  }
  private writeOrder(playlistId: string, trackIds: string[]): void {
    // Temporary negative positions avoid collisions in the unique ordering index.
    trackIds.forEach((id, position) => this.orm.update(schema.playlistTracks).set({ position: -position - 1 }).where(and(eq(schema.playlistTracks.id, id), eq(schema.playlistTracks.playlistId, playlistId))).run());
    trackIds.forEach((id, position) => this.orm.update(schema.playlistTracks).set({ position }).where(and(eq(schema.playlistTracks.id, id), eq(schema.playlistTracks.playlistId, playlistId))).run());
  }
  listFavorites(userId: string, guildId: string): Track[] {
    return this.orm.select().from(schema.favorites).where(and(eq(schema.favorites.userId, userId), eq(schema.favorites.guildId, guildId))).orderBy(asc(schema.favorites.createdAt)).all().map(track);
  }
  addFavorite(userId: string, guildId: string, metadata: TrackMetadata, now: number): Track {
    const existing = this.listFavorites(userId, guildId);
    const duplicate = existing.find(item => item.url === metadata.url);
    if (duplicate) return duplicate;
    if (existing.length >= 1000) throw new WebError(409, 'Favorite limit reached');
    const row = { ...metadata, id: randomUUID(), userId, guildId, createdAt: now };
    this.orm.transaction(tx => {
      tx.insert(schema.guildSettings).values({ guildId, updatedAt: now }).onConflictDoNothing().run();
      tx.insert(schema.favorites).values(row).run();
    });
    return track(row);
  }
  deleteFavorite(userId: string, guildId: string, id: string): void {
    const result = this.orm.delete(schema.favorites).where(and(eq(schema.favorites.id, id), eq(schema.favorites.userId, userId), eq(schema.favorites.guildId, guildId))).run();
    if (!result.changes) throw new WebError(404, 'Favorite not found');
  }
}

export function openWebDatabase(filename: string): WebDatabase {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('busy_timeout = 5000');
    sqlite.exec('CREATE TABLE IF NOT EXISTS web_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const applied = sqlite.prepare('SELECT version FROM web_migrations WHERE version = ?').get(1);
    if (!applied) sqlite.transaction(() => {
      sqlite.exec(readFileSync(path.resolve(__dirname, '../../migrations/0001_dashboard.sql'), 'utf8'));
      sqlite.prepare('INSERT INTO web_migrations(version, applied_at) VALUES (?, ?)').run(1, Date.now());
    })();
    return new WebDatabase(sqlite);
  } catch (error) { sqlite.close(); throw error; }
}
