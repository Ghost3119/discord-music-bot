import {
  ArrowDown,
  ArrowUp,
  CircleHelp,
  Heart,
  ListMusic,
  LoaderCircle,
  Play,
  Plus,
  Shuffle,
  X,
} from 'lucide-react';
import { Artwork } from '../artwork';
import { IconButton } from '../common/IconButton';
import { Button } from '../ui/button';
import { duration } from '../../lib/utils';
import type { PlaybackSnapshot, Playlist, Track } from '../../lib/api';

export type TrackContext = 'queue' | 'favorites' | 'playlist';

export interface TrackActions {
  busy: boolean;
  playbackReady: boolean;
  isFavorite: (track: Track) => boolean;
  onPlay: (track: Track) => void | Promise<void>;
  onToggleFavorite: (track: Track) => void | Promise<void>;
  onSave: (track: Track) => void;
  onMove: (from: number, to: number, owner?: Playlist) => void | Promise<void>;
  onRemove: (track: Track, index: number, owner?: Playlist) => void | Promise<void>;
}

type TrackOwnership =
  | { context: 'playlist'; owner: Playlist }
  | { context: Exclude<TrackContext, 'playlist'>; owner?: never };

export type TrackListProps = TrackOwnership & {
  tracks: Track[];
  actions: TrackActions;
};
export type TrackItemProps = TrackOwnership & {
  track: Track;
  index: number;
  length: number;
  actions: TrackActions;
};

export function TrackItem({ track, index, length, context, owner, actions }: TrackItemProps) {
  const { busy, playbackReady, isFavorite, onPlay, onToggleFavorite, onSave, onMove, onRemove } = actions;
  return (
    <div className="track-row">
      <span className="track-index">{String(index + 1).padStart(2, '0')}</span>
      <Artwork track={track} className="track-art" decorative />
      <div className="track-title">
        <strong>{track.title}</strong>
        <span>{track.artist || 'Artista desconocido'}</span>
      </div>
      <span className="track-source">{track.source}</span>
      <span className="track-duration">{duration(track.duration)}</span>
      <div className="track-actions">
        {context !== 'queue' && (
          <IconButton
            label={`Reproducir ${track.title}`}
            disabled={busy || !playbackReady}
            onClick={() => onPlay(track)}
          >
            <Play size={15} />
          </IconButton>
        )}
        <IconButton
          label={`${isFavorite(track) ? 'Quitar de' : 'Guardar en'} favoritos: ${track.title}`}
          active={isFavorite(track)}
          aria-pressed={isFavorite(track)}
          disabled={busy}
          onClick={() => onToggleFavorite(track)}
        >
          <Heart size={16} fill={isFavorite(track) ? 'currentColor' : 'none'} />
        </IconButton>
        {context === 'queue' && (
          <IconButton
            label={`Guardar ${track.title} en playlist`}
            disabled={busy}
            onClick={() => onSave(track)}
          >
            <Plus size={17} />
          </IconButton>
        )}
        {context !== 'favorites' && (
          <>
            <IconButton
              label={`Subir ${track.title}`}
              disabled={busy || index === 0}
              onClick={() => onMove(index, index - 1, owner)}
            >
              <ArrowUp size={15} />
            </IconButton>
            <IconButton
              label={`Bajar ${track.title}`}
              disabled={busy || index === length - 1}
              onClick={() => onMove(index, index + 1, owner)}
            >
              <ArrowDown size={15} />
            </IconButton>
            <IconButton
              label={`Retirar ${track.title}`}
              disabled={busy}
              onClick={() => onRemove(track, index, owner)}
            >
              <X size={16} />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}

export function TrackList({ tracks, ...itemProps }: TrackListProps) {
  return tracks.map((track, index) => (
    <TrackItem
      key={`${track.id}-${index}`}
      track={track}
      index={index}
      length={tracks.length}
      {...itemProps}
    />
  ));
}

export interface QueueSectionProps {
  state: PlaybackSnapshot | null;
  controlsDisabled: boolean;
  onShuffle: () => void | Promise<void>;
  actions: TrackActions;
}

export function QueueSection({ state, controlsDisabled, onShuffle, actions }: QueueSectionProps) {
  const queueDuration = state?.queue.reduce((sum, track) => sum + track.duration, 0) || 0;
  return (
    <section className="queue-section">
      <div className="section-heading">
        <div>
          <h2>
            A continuación <span className="count-badge">{state?.queue.length || 0}</span>
          </h2>
          <p>
            {state?.queue.length
              ? `${state.queue.length} canciones · ${duration(queueDuration)} de buena música`
              : 'El siguiente descubrimiento puede ser tuyo.'}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={controlsDisabled || (state?.queue.length || 0) < 2}
          onClick={onShuffle}
        >
          <Shuffle size={14} /> Mezclar
        </Button>
      </div>
      {!state ? (
        <div className="queue-loading" role="status">
          <LoaderCircle className="spin" size={19} /> Sincronizando la cola…
        </div>
      ) : state.queue.length ? (
        <div className="track-list">
          <div className="track-list-heading">
            <span>#</span>
            <span>CANCIÓN</span>
            <span>FUENTE</span>
            <span>
              <CircleHelp size={12} /> DURACIÓN
            </span>
          </div>
          <TrackList tracks={state.queue} context="queue" actions={actions} />
        </div>
      ) : (
        <div className="queue-empty">
          <ListMusic size={28} strokeWidth={1.4} />
          <h3>Hay espacio para una más.</h3>
          <p>Busca tu próxima canción o carga una playlist de tu biblioteca.</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => document.getElementById('music-search')?.focus()}
          >
            <Plus size={14} /> Agregar música
          </Button>
        </div>
      )}
    </section>
  );
}
