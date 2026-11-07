import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  avatar: text('avatar'),
  updatedAt: integer('updated_at').notNull(),
});
export const webSessions = sqliteTable('web_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  csrfHash: text('csrf_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('web_sessions_expiry').on(table.expiresAt)]);
export const guildSettings = sqliteTable('guild_settings', {
  guildId: text('guild_id').primaryKey(),
  updatedAt: integer('updated_at').notNull(),
});
export const playlists = sqliteTable('playlists', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  guildId: text('guild_id').notNull().references(() => guildSettings.guildId, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [index('playlists_owner_guild').on(table.userId, table.guildId)]);
export const playlistTracks = sqliteTable('playlist_tracks', {
  id: text('id').primaryKey(),
  playlistId: text('playlist_id').notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  url: text('url').notNull(), title: text('title').notNull(), artist: text('artist').notNull(),
  duration: integer('duration').notNull(), thumbnail: text('thumbnail'), source: text('source').notNull(),
  position: integer('position').notNull(),
}, table => [uniqueIndex('playlist_tracks_order').on(table.playlistId, table.position)]);
export const favorites = sqliteTable('favorites', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  guildId: text('guild_id').notNull().references(() => guildSettings.guildId, { onDelete: 'cascade' }),
  url: text('url').notNull(), title: text('title').notNull(), artist: text('artist').notNull(),
  duration: integer('duration').notNull(), thumbnail: text('thumbnail'), source: text('source').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [uniqueIndex('favorites_owner_url').on(table.userId, table.guildId, table.url)]);
