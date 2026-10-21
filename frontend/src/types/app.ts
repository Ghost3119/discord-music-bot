import type { Playlist, Track } from '../lib/api';

export type View = 'player' | 'search' | 'library' | 'favorites' | 'diagnostics';

export type Modal =
  | { type: 'playlist'; playlist?: Playlist }
  | { type: 'delete'; playlist: Playlist }
  | { type: 'save'; track: Track }
  | { type: 'add'; playlist: Playlist }
  | { type: 'import' }
  | null;

export type LibraryModal = Modal;
