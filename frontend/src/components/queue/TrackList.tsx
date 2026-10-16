import { useMemo, useState, type CSSProperties } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import {
  CircleHelp,
  GripVertical,
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
import { cn, duration } from '../../lib/utils';
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

/** Wiring provided by the sortable wrapper; absent for non-reorderable lists. */
export interface TrackDragBindings {
  rowRef: (element: HTMLElement | null) => void;
  handleRef: (element: HTMLElement | null) => void;
  style: CSSProperties;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  dragging: boolean;
  disabled: boolean;
}

export type TrackItemProps = TrackOwnership & {
  track: Track;
  index: number;
  actions: TrackActions;
  drag?: TrackDragBindings;
};

export function TrackItem({ track, index, context, owner, actions, drag }: TrackItemProps) {
  const { busy, playbackReady, isFavorite, onPlay, onToggleFavorite, onSave, onRemove } = actions;
  const position = String(index + 1).padStart(2, '0');
  return (
    <div ref={drag?.rowRef} style={drag?.style} className={cn('track-row', drag?.dragging && 'is-dragging')}>
      {drag ? (
        <button
          type="button"
          ref={drag.handleRef}
          className="track-index track-drag-handle"
          title="Arrastra para reordenar"
          disabled={drag.disabled}
          {...drag.attributes}
          {...drag.listeners}
          aria-label={`Reordenar ${track.title}`}
        >
          <span className="track-index-number">{position}</span>
          <GripVertical className="track-grip" size={15} aria-hidden />
        </button>
      ) : (
        <span className="track-index">{position}</span>
      )}
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
          <IconButton
            label={`Retirar ${track.title}`}
            disabled={busy}
            onClick={() => onRemove(track, index, owner)}
          >
            <X size={16} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

/** Stable, unique sortable ids even when the same song is queued more than once. */
export function trackSortIds(tracks: Track[]) {
  const seen = new Map<string, number>();
  return tracks.map((track) => {
    const occurrence = seen.get(track.id) ?? 0;
    seen.set(track.id, occurrence + 1);
    return occurrence ? `${track.id}#${occurrence}` : track.id;
  });
}

function SortableTrackItem({ id, disabled, item }: { id: string; disabled: boolean; item: TrackItemProps }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  return (
    <TrackItem
      {...item}
      drag={{
        rowRef: setNodeRef,
        handleRef: setActivatorNodeRef,
        style: { transform: CSS.Translate.toString(transform), transition },
        attributes,
        listeners,
        dragging: isDragging,
        disabled,
      }}
    />
  );
}

const screenReaderInstructions = {
  draggable:
    'Para reordenar, pulsa espacio o Enter. Usa las flechas arriba y abajo para mover la canción y vuelve a pulsar espacio o Enter para soltarla. Pulsa Escape para cancelar.',
};

function SortableTrackList({ tracks, ...itemProps }: TrackListProps) {
  // Optimistic order shown between the drop and the server-confirmed refresh.
  const [pending, setPending] = useState<Track[] | null>(null);
  const items = pending ?? tracks;
  const ids = useMemo(() => trackSortIds(items), [items]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const locked = itemProps.actions.busy || pending !== null || items.length < 2;
  const position = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1;

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setPending(arrayMove(items, from, to));
    void Promise.resolve()
      .then(() => itemProps.actions.onMove(from, to, itemProps.owner))
      .finally(() => setPending(null));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
      accessibility={{
        screenReaderInstructions,
        announcements: {
          onDragStart: ({ active }) => `Canción tomada en la posición ${position(active.id)}.`,
          onDragOver: ({ over }) => (over ? `Canción sobre la posición ${position(over.id)}.` : undefined),
          onDragEnd: ({ over }) => (over ? `Canción soltada en la posición ${position(over.id)}.` : 'Canción soltada.'),
          onDragCancel: () => 'Reordenamiento cancelado.',
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {items.map((track, index) => (
          <SortableTrackItem key={ids[index]} id={ids[index]} disabled={locked} item={{ ...itemProps, track, index }} />
        ))}
      </SortableContext>
    </DndContext>
  );
}

export function TrackList({ tracks, ...itemProps }: TrackListProps) {
  if (itemProps.context !== 'favorites') return <SortableTrackList tracks={tracks} {...itemProps} />;
  return tracks.map((track, index) => (
    <TrackItem key={`${track.id}-${index}`} track={track} index={index} {...itemProps} />
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
