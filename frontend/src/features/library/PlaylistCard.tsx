import { MoreHorizontal, Music2, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { Playlist } from '../../lib/api';
import { PlaylistArtwork } from './PlaylistArtwork';
import {
  summarizePlaylistDuration,
  summarizePlaylistSources,
  type FilteredPlaylistEntry,
} from './library-Catalog';

export interface PlaylistCardProps {
  entry: FilteredPlaylistEntry;
  displayIndex: number;
  busy: string;
  playbackReady: boolean;
  onSelectPlaylist: (id: string) => void;
  onLoadPlaylist: (playlist: Playlist) => void | Promise<void>;
  onAddTrack: (playlist: Playlist) => void;
  onRenamePlaylist: (playlist: Playlist) => void;
  onDeletePlaylist: (playlist: Playlist) => void;
}

function closeParentMenu(event: MouseEvent<HTMLElement>) {
  const details = event.currentTarget.closest?.('details') as HTMLDetailsElement | null;
  if (details) details.removeAttribute('open');
}

export function PlaylistCard({
  entry,
  displayIndex,
  busy,
  playbackReady,
  onSelectPlaylist,
  onLoadPlaylist,
  onAddTrack,
  onRenamePlaylist,
  onDeletePlaylist,
}: PlaylistCardProps) {
  const { playlist, originalIndex, matchingTracks, matchedByName } = entry;
  const sources = summarizePlaylistSources(playlist.tracks);
  const durationInfo = summarizePlaylistDuration(playlist.tracks);
  const trackCountLabel = `${playlist.tracks.length} ${playlist.tracks.length === 1 ? 'canción' : 'canciones'}`;
  const originLabel = sources.length > 0 ? sources.slice(0, 2).join(' · ') : 'Tu colección';

  return (
    <div
      key={playlist.id}
      className={`playlist-card ${displayIndex >= 16 ? 'playlist-item-deferred' : ''}`}
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
      <div className={`playlist-cover playlist-color-${originalIndex % 4}`}>
        {PlaylistArtwork({
          playlist,
          colorIndex: originalIndex,
          className: 'playlist-cover-mosaic',
        })}
        <span className="playlist-cover-number">{String(originalIndex + 1).padStart(2, '0')}</span>
        <button
          type="button"
          className="playlist-cover-play"
          aria-label={`Escuchar ${playlist.name}`}
          disabled={!!busy || !playlist.tracks.length || !playbackReady}
          onClick={(event) => {
            event.stopPropagation();
            void onLoadPlaylist(playlist);
          }}
        >
          <Play size={19} fill="currentColor" />
        </button>
      </div>

      <div className="playlist-card-footer">
        <div className="playlist-card-copy">
          <h3>{playlist.name}</h3>
          <p>
            {trackCountLabel} <span>•</span> {originLabel}
            {durationInfo.knownSeconds > 0 ? ` · ${durationInfo.label}` : ''}
          </p>
          {matchingTracks.length > 0 && !matchedByName && (
            <small className="playlist-card-match">
              <Music2 size={10} aria-hidden="true" /> Incluye «{matchingTracks[0]!.title}»
              {matchingTracks.length > 1 ? ` y ${matchingTracks.length - 1} más` : ''}
            </small>
          )}
        </div>

        <details
          className="playlist-card-menu-wrap"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              (event.currentTarget as HTMLDetailsElement).removeAttribute('open');
            }
          }}
        >
          <summary
            className="playlist-card-options-btn"
            aria-label={`Opciones de ${playlist.name}`}
            title={`Opciones de ${playlist.name}`}
          >
            <MoreHorizontal size={16} />
          </summary>

          <div className="playlist-card-menu" role="menu" aria-label={`Acciones para ${playlist.name}`}>
            <button
              type="button"
              role="menuitem"
              disabled={!!busy}
              onClick={(event) => {
                closeParentMenu(event);
                onAddTrack(playlist);
              }}
            >
              <Plus size={14} /> Agregar canción
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!!busy}
              onClick={(event) => {
                closeParentMenu(event);
                onRenamePlaylist(playlist);
              }}
            >
              <Pencil size={14} /> Renombrar
            </button>
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              disabled={!!busy}
              onClick={(event) => {
                closeParentMenu(event);
                onDeletePlaylist(playlist);
              }}
            >
              <Trash2 size={14} /> Eliminar
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}
