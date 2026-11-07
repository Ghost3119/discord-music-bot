import type { Repositories } from '../../domain/persistence';
import { WebDatabase } from './database';

/** Async facade; each SQLite operation still completes in one synchronous transaction. */
export function createSqliteRepositories(db: WebDatabase): Repositories {
  return {
    sessions: {
      createSession: async (...args) => db.createSession(...args),
      getSession: async (...args) => db.getSession(...args),
      deleteSession: async (...args) => db.deleteSession(...args),
      deleteUserSessions: async (...args) => db.deleteUserSessions(...args),
      purgeExpired: async (...args) => db.purgeExpired(...args),
    },
    playlists: {
      listPlaylists: async (...args) => db.listPlaylists(...args),
      getPlaylist: async (...args) => db.getPlaylist(...args),
      createPlaylist: async (...args) => db.createPlaylist(...args),
      createPlaylistWithTracks: async (...args) => db.createPlaylistWithTracks(...args),
      renamePlaylist: async (...args) => db.renamePlaylist(...args),
      deletePlaylist: async (...args) => db.deletePlaylist(...args),
      addPlaylistTrack: async (...args) => db.addPlaylistTrack(...args),
      deletePlaylistTrack: async (...args) => db.deletePlaylistTrack(...args),
      reorderPlaylist: async (...args) => db.reorderPlaylist(...args),
    },
    favorites: {
      listFavorites: async (...args) => db.listFavorites(...args),
      addFavorite: async (...args) => db.addFavorite(...args),
      deleteFavorite: async (...args) => db.deleteFavorite(...args),
    },
    async close(): Promise<void> {
      if (db.sqlite.open) db.close();
    },
  };
}
