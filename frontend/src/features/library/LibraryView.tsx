import * as React from 'react';
import {
  ArrowLeft,
  Download,
  Library,
  Plus,
} from 'lucide-react';
import { EmptyState, Loading } from '../../components/common/StateFeedback';
import { Button } from '../../components/ui/button';
import type { TrackActions } from '../../components/queue/TrackList';
import type { Playlist } from '../../lib/api';
import { LibraryToolbar } from './LibraryToolbar';
import { PlaylistDetails } from './PlaylistDetails';
import { PlaylistGrid } from './PlaylistGrid';
import {
  filterAndSortPlaylists,
  readStoredLayoutMode,
  readStoredSortOrder,
  writeStoredLayoutMode,
  writeStoredSortOrder,
  type LibraryLayoutMode,
  type LibrarySortOrder,
} from './library-Catalog';

export interface LibraryViewBindings {
  guildId?: string;
  playlist?: Playlist;
  playlists: Playlist[];
  libraryLoading: boolean;
  busy: string;
  playbackReady: boolean;
  onSelectPlaylist: (id: string) => void;
  onCreatePlaylist: () => void;
  onImportPlaylist?: () => void;
  onRenamePlaylist: (playlist: Playlist) => void;
  onDeletePlaylist: (playlist: Playlist) => void;
  onAddTrack: (playlist: Playlist) => void;
  onLoadPlaylist: (playlist: Playlist) => void | Promise<void>;
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  sortOrder?: LibrarySortOrder;
  onSortOrderChange?: (value: LibrarySortOrder) => void;
  layoutMode?: LibraryLayoutMode;
  onLayoutModeChange?: (value: LibraryLayoutMode) => void;
}

export interface LibraryViewProps {
  library: LibraryViewBindings;
  trackActions: TrackActions;
}

function hasReactDispatcher(): boolean {
  const internals = (
    React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H: unknown };
    }
  ).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  return Boolean(internals && internals.H);
}

function useCatalogState(library: LibraryViewBindings) {
  if (!hasReactDispatcher()) {
    return {
      searchQuery: library.searchQuery ?? '',
      setSearchQuery: (next: string) => library.onSearchQueryChange?.(next),
      sortOrder: library.sortOrder ?? readStoredSortOrder(),
      setSortOrder: (next: LibrarySortOrder) => {
        writeStoredSortOrder(next);
        library.onSortOrderChange?.(next);
      },
      layoutMode: library.layoutMode ?? readStoredLayoutMode(),
      setLayoutMode: (next: LibraryLayoutMode) => {
        writeStoredLayoutMode(next);
        library.onLayoutModeChange?.(next);
      },
    };
  }

  const [localSearch, setLocalSearch] = React.useState('');
  const [prevGuildId, setPrevGuildId] = React.useState(library.guildId);
  if (library.guildId !== prevGuildId) {
    setPrevGuildId(library.guildId);
    if (localSearch) setLocalSearch('');
  }
  const [localSort, setLocalSort] = React.useState<LibrarySortOrder>(() =>
    readStoredSortOrder(),
  );
  const [localLayout, setLocalLayout] = React.useState<LibraryLayoutMode>(() =>
    readStoredLayoutMode(),
  );

  const searchQuery = library.searchQuery !== undefined ? library.searchQuery : localSearch;
  const sortOrder = library.sortOrder !== undefined ? library.sortOrder : localSort;
  const layoutMode = library.layoutMode !== undefined ? library.layoutMode : localLayout;

  const setSearchQuery = (next: string) => {
    setLocalSearch(next);
    library.onSearchQueryChange?.(next);
  };

  const setSortOrder = (next: LibrarySortOrder) => {
    setLocalSort(next);
    writeStoredSortOrder(next);
    library.onSortOrderChange?.(next);
  };

  const setLayoutMode = (next: LibraryLayoutMode) => {
    setLocalLayout(next);
    writeStoredLayoutMode(next);
    library.onLayoutModeChange?.(next);
  };

  return {
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
    layoutMode,
    setLayoutMode,
  };
}

export function LibraryView({ library, trackActions }: LibraryViewProps) {
  const {
    playlist,
    playlists,
    libraryLoading,
    busy,
    playbackReady,
    onSelectPlaylist,
    onCreatePlaylist,
    onImportPlaylist,
    onRenamePlaylist,
    onDeletePlaylist,
    onAddTrack,
    onLoadPlaylist,
  } = library;

  const {
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
    layoutMode,
    setLayoutMode,
  } = useCatalogState(library);

  const entries = filterAndSortPlaylists(playlists, searchQuery, sortOrder);
  const selectedIndex = playlist ? Math.max(0, playlists.findIndex((item) => item.id === playlist.id)) : 0;

  return (
    <section className="library-view">
      <div className="section-heading">
        <div>
          {playlist ? (
            <Button variant="ghost" size="sm" onClick={() => onSelectPlaylist('')}>
              <ArrowLeft size={15} /> Todas las playlists
            </Button>
          ) : (
            <p>Las canciones que merecen quedarse.</p>
          )}
        </div>
        {!playlist && (
          <div className="heading-actions">
            {onImportPlaylist && (
              <Button variant="secondary" size="sm" onClick={onImportPlaylist} disabled={!!busy}>
                <Download size={15} /> Importar playlist
              </Button>
            )}
            <Button size="sm" onClick={onCreatePlaylist} disabled={!!busy}>
              <Plus size={16} /> Nueva playlist
            </Button>
          </div>
        )}
      </div>

      {libraryLoading ? (
        <Loading text="Abriendo tu biblioteca…" />
      ) : playlist ? (
        PlaylistDetails({
          playlist,
          colorIndex: selectedIndex,
          busy,
          playbackReady,
          onLoadPlaylist,
          onAddTrack,
          onRenamePlaylist,
          onDeletePlaylist,
          trackActions,
        })
      ) : playlists.length ? (
        <>
          {LibraryToolbar({
            totalPlaylists: playlists.length,
            visiblePlaylists: entries.length,
            searchQuery,
            sortOrder,
            layoutMode,
            onSearchChange: setSearchQuery,
            onClearSearch: () => setSearchQuery(''),
            onSortChange: setSortOrder,
            onLayoutChange: setLayoutMode,
          })}
          {PlaylistGrid({
            entries,
            layoutMode,
            searchQuery,
            busy,
            playbackReady,
            onClearSearch: () => setSearchQuery(''),
            onSelectPlaylist,
            onCreatePlaylist,
            onLoadPlaylist,
            onAddTrack,
            onRenamePlaylist,
            onDeletePlaylist,
          })}
        </>
      ) : (
        <EmptyState
          icon={<Library size={30} />}
          title="Tu próximo soundtrack empieza aquí"
          text="Crea una playlist o importa una colección existente para guardar las canciones que quieras volver a escuchar."
          action={
            <div className="empty-state-actions">
              <Button onClick={onCreatePlaylist} disabled={!!busy}>
                <Plus size={16} /> Crear mi primera playlist
              </Button>
              {onImportPlaylist && (
                <Button variant="secondary" onClick={onImportPlaylist} disabled={!!busy}>
                  <Download size={15} /> Importar playlist
                </Button>
              )}
            </div>
          }
        />
      )}
    </section>
  );
}
