import { and, asc, count, eq, lte, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PersistenceError, type Repositories, type SavedPlaylist, type Track, type TrackMetadata } from '../../domain/persistence';
import { sanitizeThumbnailUrl, youtubeThumbnail } from '../../music/artwork';
import { PostgresDatabase, type PostgresOrm } from './database';
import * as schema from './schema';
const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
function track(row: TrackMetadata & { id: string }): Track {
  return { id: row.id, url: row.url, title: row.title, artist: row.artist, duration: row.duration, thumbnail: sanitizeThumbnailUrl(row.thumbnail) || youtubeThumbnail(row.source, undefined, row.url) || null, source: row.source };
}
const owned = (userId: string, guildId: string) => and(eq(schema.playlists.userId, userId), eq(schema.playlists.guildId, guildId));
const favoriteScope = (userId: string, guildId: string) => and(eq(schema.favorites.userId, userId), eq(schema.favorites.guildId, guildId));
async function tracks(db: PostgresOrm, id: string): Promise<Track[]> {
  return (await db.select().from(schema.playlistTracks).where(eq(schema.playlistTracks.playlistId, id)).orderBy(asc(schema.playlistTracks.position))).map(track);
}
async function playlist(db: PostgresOrm, userId: string, guildId: string, id: string): Promise<SavedPlaylist> {
  const [row] = await db.select().from(schema.playlists).where(and(owned(userId, guildId), eq(schema.playlists.id, id)));
  if (!row) throw new PersistenceError('not_found', 'Playlist not found');
  return { id: row.id, name: row.name, tracks: await tracks(db, id) };
}
async function lock(tx: PostgresOrm, scope: string): Promise<void> {
  // Transaction-scoped locks are shared across pools/processes, never a JS mutex.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${scope}))`);
}
async function order(tx: PostgresOrm, playlistId: string, ids: string[]): Promise<void> {
  for (const [position, id] of ids.entries()) await tx.update(schema.playlistTracks).set({ position: -position - 1 }).where(and(eq(schema.playlistTracks.id, id), eq(schema.playlistTracks.playlistId, playlistId)));
  for (const [position, id] of ids.entries()) await tx.update(schema.playlistTracks).set({ position }).where(and(eq(schema.playlistTracks.id, id), eq(schema.playlistTracks.playlistId, playlistId)));
}
async function guild(tx: PostgresOrm, guildId: string, now: number): Promise<void> {
  await tx.insert(schema.guildSettings).values({ guildId, updatedAt: now }).onConflictDoNothing();
}

export function createPostgresRepositories(database: PostgresDatabase): Repositories {
  const db = database.orm;
  const create = async (userId: string, guildId: string, name: string, now: number, items: TrackMetadata[], requireTracks = false): Promise<SavedPlaylist> => db.transaction(async tx => {
    await lock(tx, `playlists:${userId}:${guildId}`);
    if (requireTracks && (!items.length || items.length > 500)) throw new PersistenceError('invalid', 'Playlists must contain between 1 and 500 tracks');
    const [total] = await tx.select({ count: count() }).from(schema.playlists).where(owned(userId, guildId));
    if (total!.count >= 100) throw new PersistenceError('conflict', 'Playlist limit reached');
    const id = randomUUID();
    await guild(tx, guildId, now);
    await tx.insert(schema.playlists).values({ id, userId, guildId, name, createdAt: now });
    const rows = items.map((item, position) => ({ ...item, id: randomUUID(), playlistId: id, position }));
    for (let offset = 0; offset < rows.length; offset += 50) await tx.insert(schema.playlistTracks).values(rows.slice(offset, offset + 50));
    return { id, name, tracks: rows.map(track) };
  });
  return {
    sessions: {
      async createSession(user, now, ttlMs) {
        const token = randomBytes(32).toString('base64url'), csrfToken = randomBytes(32).toString('hex');
        await db.transaction(async tx => {
          // Session creation also purges other users' expired rows: serialize that scan.
          await lock(tx, 'sessions:write');
          await tx.insert(schema.users).values({ ...user, updatedAt: now }).onConflictDoUpdate({ target: schema.users.id, set: { username: user.username, avatar: user.avatar, updatedAt: now } });
          await tx.delete(schema.webSessions).where(eq(schema.webSessions.userId, user.id));
          await tx.delete(schema.webSessions).where(lte(schema.webSessions.expiresAt, now));
          await tx.insert(schema.webSessions).values({ tokenHash: hash(token), csrfHash: hash(csrfToken), userId: user.id, createdAt: now, expiresAt: now + ttlMs });
        });
        return { token, csrfToken };
      },
      async getSession(token, now) {
        if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
        const [row] = await db.select({ session: schema.webSessions, user: schema.users }).from(schema.webSessions).innerJoin(schema.users, eq(schema.users.id, schema.webSessions.userId)).where(eq(schema.webSessions.tokenHash, hash(token)));
        if (!row) return null;
        if (row.session.expiresAt <= now || row.session.csrfHash === hash(hash(`dashboard-csrf:${token}`))) {
          await db.delete(schema.webSessions).where(eq(schema.webSessions.tokenHash, hash(token))); return null;
        }
        return { user: { id: row.user.id, username: row.user.username, avatar: row.user.avatar }, tokenHash: row.session.tokenHash, csrfHash: row.session.csrfHash, expiresAt: row.session.expiresAt };
      },
      async deleteSession(token) { if (token) await db.delete(schema.webSessions).where(eq(schema.webSessions.tokenHash, hash(token))); },
      async deleteUserSessions(userId) { await db.delete(schema.webSessions).where(eq(schema.webSessions.userId, userId)); },
      async purgeExpired(now) { await db.transaction(async tx => {
        await lock(tx, 'sessions:write');
        await tx.delete(schema.webSessions).where(lte(schema.webSessions.expiresAt, now));
      }); },
    },
    playlists: {
      async listPlaylists(userId, guildId) {
        const rows = await db.select().from(schema.playlists).where(owned(userId, guildId)).orderBy(asc(schema.playlists.createdAt));
        return await Promise.all(rows.map(async row => ({ id: row.id, name: row.name, tracks: await tracks(db, row.id) })));
      },
      async getPlaylist(userId, guildId, id) { return await playlist(db, userId, guildId, id); },
      async createPlaylist(userId, guildId, name, now) { return await create(userId, guildId, name, now, []); },
      async createPlaylistWithTracks(userId, guildId, name, items, now) {
        return await create(userId, guildId, name, now, items.map(item => ({ ...item })), true);
      },
      async renamePlaylist(userId, guildId, id, name) { return await db.transaction(async tx => {
        await lock(tx, `playlist:${id}`);
        await playlist(tx, userId, guildId, id);
        await tx.update(schema.playlists).set({ name }).where(eq(schema.playlists.id, id));
        return await playlist(tx, userId, guildId, id);
      }); },
      async deletePlaylist(userId, guildId, id) { await db.transaction(async tx => {
        await lock(tx, `playlist:${id}`);
        await playlist(tx, userId, guildId, id);
        await tx.delete(schema.playlists).where(eq(schema.playlists.id, id));
      }); },
      async addPlaylistTrack(userId, guildId, id, metadata) { return await db.transaction(async tx => {
        await lock(tx, `playlist:${id}`);
        const p = await playlist(tx, userId, guildId, id);
        if (p.tracks.length >= 500) throw new PersistenceError('conflict', 'Playlist track limit reached');
        const row = { ...metadata, id: randomUUID(), playlistId: id, position: p.tracks.length };
        await tx.insert(schema.playlistTracks).values(row);
        return track(row);
      }); },
      async deletePlaylistTrack(userId, guildId, id, trackId) { await db.transaction(async tx => {
        await lock(tx, `playlist:${id}`);
        const p = await playlist(tx, userId, guildId, id);
        if (!p.tracks.some(t => t.id === trackId)) throw new PersistenceError('not_found', 'Track not found');
        await tx.delete(schema.playlistTracks).where(and(eq(schema.playlistTracks.id, trackId), eq(schema.playlistTracks.playlistId, id)));
        await order(tx, id, p.tracks.filter(t => t.id !== trackId).map(t => t.id));
      }); },
      async reorderPlaylist(userId, guildId, id, trackIds) { return await db.transaction(async tx => {
        await lock(tx, `playlist:${id}`);
        const p = await playlist(tx, userId, guildId, id);
        const existing = new Set(p.tracks.map(t => t.id));
        if (existing.size !== trackIds.length || new Set(trackIds).size !== trackIds.length || trackIds.some(id => !existing.has(id))) throw new PersistenceError('invalid', 'trackIds must contain every playlist track exactly once');
        await order(tx, id, trackIds);
        return await playlist(tx, userId, guildId, id);
      }); },
    },
    favorites: {
      async listFavorites(userId, guildId) { return (await db.select().from(schema.favorites).where(favoriteScope(userId, guildId)).orderBy(asc(schema.favorites.createdAt))).map(track); },
      async addFavorite(userId, guildId, metadata, now) { return await db.transaction(async tx => {
        await lock(tx, `favorites:${userId}:${guildId}`);
        const [duplicate] = await tx.select().from(schema.favorites).where(and(favoriteScope(userId, guildId), eq(schema.favorites.url, metadata.url)));
        if (duplicate) return track(duplicate);
        const [total] = await tx.select({ count: count() }).from(schema.favorites).where(favoriteScope(userId, guildId));
        if (total!.count >= 1000) throw new PersistenceError('conflict', 'Favorite limit reached');
        await guild(tx, guildId, now);
        const row = { ...metadata, id: randomUUID(), userId, guildId, createdAt: now };
        await tx.insert(schema.favorites).values(row);
        return track(row);
      }); },
      async deleteFavorite(userId, guildId, id) { await db.transaction(async tx => {
        await lock(tx, `favorites:${userId}:${guildId}`);
        const rows = await tx.delete(schema.favorites).where(and(favoriteScope(userId, guildId), eq(schema.favorites.id, id))).returning({ id: schema.favorites.id });
        if (!rows.length) throw new PersistenceError('not_found', 'Favorite not found');
      }); },
    },
    close: async () => await database.close(),
  };
}
