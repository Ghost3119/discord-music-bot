import { Music2, Plus } from 'lucide-react';
import { EmptyState } from '../../components/common/StateFeedback';
import { TrackList, type TrackActions } from '../../components/queue/TrackList';
import { Button } from '../../components/ui/button';
import type { Playlist } from '../../lib/api';
import { PlaylistArtwork } from './PlaylistArtwork';
import { summarizePlaylistDuration, summarizePlaylistSources } from './library-Catalog';

export interface PlaylistDetailsProps {
  playlist: Playlist;
  colorIndex?: number;
  busy: string;
  onAddTrack: (playlist: Playlist) => void;
  trackActions: TrackActions;
}

export function PlaylistDetails({
  playlist,
  colorIndex = 0,
  busy,
  onAddTrack,
  trackActions,
}: PlaylistDetailsProps) {
  const durationInfo = summarizePlaylistDuration(playlist.tracks);
  const sources = summarizePlaylistSources(playlist.tracks);
  const countLabel = `${playlist.tracks.length} ${playlist.tracks.length === 1 ? 'canción' : 'canciones'}`;

  return (
    <>
      <div className="playlist-detail">
        <div className={`playlist-detail-art playlist-color-${Math.abs(colorIndex) % 4}`}>
          {PlaylistArtwork({
            playlist,
            colorIndex,
            className: 'playlist-detail-cover',
          })}
        </div>
        <div className="playlist-detail-meta">
          <span className="eyebrow">TU COLECCIÓN</span>
          <h2>{playlist.name}</h2>
          <p>
            {countLabel} · {durationInfo.label}
            {sources.length > 0 ? ` · ${sources.join(' · ')}` : ''}
          </p>
        </div>
      </div>

      {playlist.tracks.length ? (
        <div className="track-list">
          <TrackList
            tracks={playlist.tracks}
            context="playlist"
            owner={playlist}
            actions={trackActions}
          />
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
