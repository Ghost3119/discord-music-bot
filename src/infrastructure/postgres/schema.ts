import { pgTable, text, integer, bigint, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  avatar: text('avatar'),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
export const webSessions = pgTable('web_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  csrfHash: text('csrf_hash').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
}, table => [index('web_sessions_expiry').on(table.expiresAt)]);
export const guildSettings = pgTable('guild_settings', {
  guildId: text('guild_id').primaryKey(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
export const playlists = pgTable('playlists', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  guildId: text('guild_id').notNull().references(() => guildSettings.guildId, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, table => [index('playlists_owner_guild').on(table.userId, table.guildId)]);
export const playlistTracks = pgTable('playlist_tracks', {
  id: text('id').primaryKey(),
  playlistId: text('playlist_id').notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  url: text('url').notNull(), title: text('title').notNull(), artist: text('artist').notNull(),
  duration: integer('duration').notNull(), thumbnail: text('thumbnail'), source: text('source').notNull(),
  position: integer('position').notNull(),
}, table => [uniqueIndex('playlist_tracks_order').on(table.playlistId, table.position)]);
export const favorites = pgTable('favorites', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  guildId: text('guild_id').notNull().references(() => guildSettings.guildId, { onDelete: 'cascade' }),
  url: text('url').notNull(), title: text('title').notNull(), artist: text('artist').notNull(),
  duration: integer('duration').notNull(), thumbnail: text('thumbnail'), source: text('source').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, table => [uniqueIndex('favorites_owner_url').on(table.userId, table.guildId, table.url)]);
