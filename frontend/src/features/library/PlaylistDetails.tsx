import { LoaderCircle, Music2, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/common/IconButton';
import { EmptyState } from '../../components/common/StateFeedback';
import { TrackList, type TrackActions } from '../../components/queue/TrackList';
import { Button } from '../../components/ui/button';
import type { Playlist } from '../../lib/api';
import { PlaylistArtwork } from './PlaylistArtwork';
import {
  summarizePlaylistArtists,
  summarizePlaylistDuration,
  summarizePlaylistSources,
} from './library-Catalog';

export interface PlaylistDetailsProps {
  playlist: Playlist;
  colorIndex?: number;
  busy: string;
  playbackReady: boolean;
  onLoadPlaylist: (playlist: Playlist) => void | Promise<void>;
  onAddTrack: (playlist: Playlist) => void;
  onRenamePlaylist: (playlist: Playlist) => void;
  onDeletePlaylist: (playlist: Playlist) => void;
  trackActions: TrackActions;
}

export function PlaylistDetails({
  playlist,
  colorIndex = 0,
  busy,
  playbackReady,
  onLoadPlaylist,
  onAddTrack,
  onRenamePlaylist,
  onDeletePlaylist,
  trackActions,
}: PlaylistDetailsProps) {
  const durationInfo = summarizePlaylistDuration(playlist.tracks);
  const sources = summarizePlaylistSources(playlist.tracks);
  const artistSummary = summarizePlaylistArtists(playlist.tracks);
  const countLabel = `${playlist.tracks.length} ${playlist.tracks.length === 1 ? 'canción' : 'canciones'}`;
  const isLoadingPlaylist = busy === 'load';

  return (
    <>
      <div className="playlist-detail">
        <div className="playlist-detail-art-stage">
          <div className={`playlist-detail-ambient playlist-color-${Math.abs(colorIndex) % 4}`} aria-hidden="true" />
          <div className={`playlist-detail-art playlist-color-${Math.abs(colorIndex) % 4}`}>
            {PlaylistArtwork({
              playlist,
              colorIndex,
              className: 'playlist-detail-cover',
            })}
          </div>
        </div>

        <div className="playlist-detail-meta">
          <span className="eyebrow">
            TU COLECCIÓN{sources.length > 0 ? ` · ${sources.join(' / ').toUpperCase()}` : ''}
          </span>
          <h2>{playlist.name}</h2>
          {artistSummary && <div className="playlist-detail-artists">{artistSummary}</div>}
          <p className="playlist-detail-stats">
            {countLabel} · {durationInfo.label}
            {sources.length > 0 ? ` · ${sources.join(' · ')}` : ''}
          </p>

          <div className="playlist-detail-actions">
            <Button
              size="sm"
              className="playlist-hero-play"
              disabled={!!busy || !playlist.tracks.length || !playbackReady}
              onClick={() => onLoadPlaylist(playlist)}
            >
              {isLoadingPlaylist ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}{' '}
              {isLoadingPlaylist ? `Cargando ${playlist.tracks.length} canciones…` : 'Escuchar'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="playlist-hero-add"
              disabled={!!busy}
              onClick={() => onAddTrack(playlist)}
            >
              <Plus size={16} /> Agregar canción
            </Button>
            <span className="playlist-actions-divider" aria-hidden="true" />
            <div className="playlist-hero-tools">
              <IconButton
                label="Renombrar playlist"
                disabled={!!busy}
                onClick={() => onRenamePlaylist(playlist)}
              >
                <Pencil size={17} />
              </IconButton>
              <IconButton
                label="Eliminar playlist"
                disabled={!!busy}
                onClick={() => onDeletePlaylist(playlist)}
              >
                <Trash2 size={17} />
              </IconButton>
            </div>
          </div>

          {isLoadingPlaylist && (
            <div className="playlist-load-progress" role="status" aria-live="polite">
              <LoaderCircle size={14} className="spin" />
              <span>
                Enviando {countLabel} a la cola de reproducción…
              </span>
            </div>
          )}
        </div>
      </div>

      {playlist.tracks.length ? (
        <div className="playlist-tracks-section">
          <div className="playlist-tracks-header">
            <div className="playlist-tracks-title">
              <h3>Canciones</h3>
              <span className="playlist-tracks-badge">{playlist.tracks.length}</span>
            </div>
            <span className="playlist-tracks-hint">Arrastra cualquier fila para reordenar</span>
          </div>
          <div className="track-list">
            <div className="track-list-heading" aria-hidden="true">
              <span>#</span>
              <span>CANCIÓN</span>
              <span>ORIGEN</span>
              <span>DURACIÓN</span>
            </div>
            <TrackList
              tracks={playlist.tracks}
              context="playlist"
              owner={playlist}
              actions={trackActions}
            />
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Music2 size={30} />}
          title="Una playlist llena de posibilidades"
          text="Agrega un enlace o guarda canciones desde el reproductor y la cola."
          action={
            <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => onAddTrack(playlist)}>
              <Plus size={15} /> Agregar canción
            </Button>
          }
        />
      )}
    </>
  );
}
