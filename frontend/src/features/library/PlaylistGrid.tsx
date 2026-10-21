import { Music2, Pencil, Play, Plus, Search, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/common/IconButton';
import { EmptyState } from '../../components/common/StateFeedback';
import { Button } from '../../components/ui/button';
import type { Playlist } from '../../lib/api';
import { PlaylistArtwork } from './PlaylistArtwork';
import { PlaylistCard } from './PlaylistCard';
import {
  summarizePlaylistDuration,
  summarizePlaylistSources,
  type FilteredPlaylistEntry,
  type LibraryLayoutMode,
} from './library-Catalog';

export interface PlaylistGridProps {
  entries: FilteredPlaylistEntry[];
  layoutMode: LibraryLayoutMode;
  searchQuery: string;
  busy: string;
  playbackReady: boolean;
  onClearSearch: () => void;
  onSelectPlaylist: (id: string) => void;
  onCreatePlaylist: () => void;
  onLoadPlaylist: (playlist: Playlist) => void | Promise<void>;
  onAddTrack: (playlist: Playlist) => void;
  onRenamePlaylist: (playlist: Playlist) => void;
  onDeletePlaylist: (playlist: Playlist) => void;
}

export function PlaylistGrid({
  entries,
  layoutMode,
  searchQuery,
  busy,
  playbackReady,
  onClearSearch,
  onSelectPlaylist,
  onCreatePlaylist,
  onLoadPlaylist,
  onAddTrack,
  onRenamePlaylist,
  onDeletePlaylist,
}: PlaylistGridProps) {
  const hasActiveSearch = searchQuery.trim().length > 0;

  if (entries.length === 0 && hasActiveSearch) {
    return (
      <EmptyState
        icon={<Search size={28} />}
        title="Sin coincidencias en tu biblioteca"
        text={`No encontramos playlists ni canciones para «${searchQuery.trim()}».`}
        action={
          <Button variant="secondary" size="sm" onClick={onClearSearch}>
            Limpiar búsqueda
          </Button>
        }
      />
    );
  }

  if (layoutMode === 'list') {
    return (
      <div className="playlist-list" role="list" aria-label="Lista de playlists">
        {entries.map((entry, displayIndex) => {
          const { playlist, originalIndex, matchingTracks, matchedByName } = entry;
          const sources = summarizePlaylistSources(playlist.tracks);
          const durationInfo = summarizePlaylistDuration(playlist.tracks);
          const trackCountLabel = `${playlist.tracks.length} ${playlist.tracks.length === 1 ? 'canción' : 'canciones'}`;
          const originLabel = sources.length > 0 ? sources.slice(0, 2).join(' · ') : 'Tu colección';

          return (
            <div
              key={playlist.id}
              className={`playlist-list-row ${displayIndex >= 24 ? 'playlist-item-deferred' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelectPlaylist(playlist.id)}
              onKeyDown={(event) => {
                if (event.target && event.currentTarget && event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectPlaylist(playlist.id);
                }
              }}
            >
              <span className="playlist-list-index">{String(originalIndex + 1).padStart(2, '0')}</span>
              <div className={`playlist-list-art playlist-color-${originalIndex % 4}`}>
                {PlaylistArtwork({
                  playlist,
                  colorIndex: originalIndex,
                  className: 'playlist-list-mosaic',
                })}
              </div>

              <div className="playlist-list-copy">
                <strong>{playlist.name}</strong>
                <span>
                  {trackCountLabel} · {originLabel}
                </span>
                {matchingTracks.length > 0 && !matchedByName && (
                  <small className="playlist-card-match">
                    <Music2 size={10} aria-hidden="true" /> Incluye «{matchingTracks[0]!.title}»
                    {matchingTracks.length > 1 ? ` y ${matchingTracks.length - 1} más` : ''}
                  </small>
                )}
              </div>

              <span className="playlist-list-duration">{durationInfo.label}</span>

              <div
                className="playlist-list-actions"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <IconButton
                  label={`Escuchar ${playlist.name}`}
                  disabled={!!busy || !playlist.tracks.length || !playbackReady}
                  onClick={() => void onLoadPlaylist(playlist)}
                >
                  <Play size={15} fill="currentColor" />
                </IconButton>
                <IconButton
                  label={`Agregar canción a ${playlist.name}`}
                  disabled={!!busy}
                  onClick={() => onAddTrack(playlist)}
                >
                  <Plus size={15} />
                </IconButton>
                <IconButton
                  label={`Renombrar ${playlist.name}`}
                  disabled={!!busy}
                  onClick={() => onRenamePlaylist(playlist)}
                >
                  <Pencil size={15} />
                </IconButton>
                <IconButton
                  label={`Eliminar ${playlist.name}`}
                  disabled={!!busy}
                  onClick={() => onDeletePlaylist(playlist)}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="playlist-grid">
      {entries.map((entry, displayIndex) =>
        PlaylistCard({
          entry,
          displayIndex,
          busy,
          playbackReady,
          onSelectPlaylist,
          onLoadPlaylist,
          onAddTrack,
          onRenamePlaylist,
          onDeletePlaylist,
        }),
      )}
      {!hasActiveSearch && (
        <button type="button" className="playlist-new" onClick={onCreatePlaylist} disabled={!!busy}>
          <span>
            <Plus size={27} />
          </span>
          <strong>Crea tu próxima playlist</strong>
          <p>Para cada versión de ti.</p>
        </button>
      )}
    </div>
  );
}
