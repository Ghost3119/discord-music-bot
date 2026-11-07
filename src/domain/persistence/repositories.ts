import type { WebUser, WebSession, SavedPlaylist, Track, TrackMetadata } from './types';

export interface SessionRepository {
  createSession(user: WebUser, now: number, ttlMs: number): Promise<{ token: string; csrfToken: string }>;
  getSession(token: string | undefined, now: number): Promise<WebSession | null>;
  deleteSession(token: string | undefined): Promise<void>;
  deleteUserSessions(userId: string): Promise<void>;
  purgeExpired(now: number): Promise<void>;
}

export interface PlaylistRepository {
  listPlaylists(userId: string, guildId: string): Promise<SavedPlaylist[]>;
  getPlaylist(userId: string, guildId: string, playlistId: string): Promise<SavedPlaylist>;
  createPlaylist(userId: string, guildId: string, name: string, now: number): Promise<SavedPlaylist>;
  createPlaylistWithTracks(userId: string, guildId: string, name: string, items: TrackMetadata[], now: number): Promise<SavedPlaylist>;
  renamePlaylist(userId: string, guildId: string, id: string, name: string): Promise<SavedPlaylist>;
  deletePlaylist(userId: string, guildId: string, id: string): Promise<void>;
  addPlaylistTrack(userId: string, guildId: string, playlistId: string, metadata: TrackMetadata): Promise<Track>;
  deletePlaylistTrack(userId: string, guildId: string, playlistId: string, trackId: string): Promise<void>;
  reorderPlaylist(userId: string, guildId: string, playlistId: string, trackIds: string[]): Promise<SavedPlaylist>;
}

export interface FavoriteRepository {
  listFavorites(userId: string, guildId: string): Promise<Track[]>;
  addFavorite(userId: string, guildId: string, metadata: TrackMetadata, now: number): Promise<Track>;
  deleteFavorite(userId: string, guildId: string, id: string): Promise<void>;
}

/**
 * Async ports; the SQLite facade wraps synchronous WebDatabase operations.
 * ensureGuild is deliberately omitted: WebDatabase.ensureGuild has no production
 * callers, and playlist/favorite writes already ensure their guild internally.
 */
export interface Repositories {
  sessions: SessionRepository;
  playlists: PlaylistRepository;
  favorites: FavoriteRepository;
  close(): Promise<void>;
}
