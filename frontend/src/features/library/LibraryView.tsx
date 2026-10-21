import {
  ArrowLeft,
  Download,
  Library,
  ListMusic,
  LoaderCircle,
  Music2,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import { Artwork } from '../../components/artwork';
import { IconButton } from '../../components/common/IconButton';
import { EmptyState, Loading } from '../../components/common/StateFeedback';
import { Button } from '../../components/ui/button';
import { TrackList, type TrackActions } from '../../components/queue/TrackList';
import { duration } from '../../lib/utils';
import type { Playlist } from '../../lib/api';

export interface LibraryViewBindings {
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
}

export interface LibraryViewProps {
  library: LibraryViewBindings;
  trackActions: TrackActions;
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
        <div className="heading-actions">
          {playlist ? (
            <>
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
              <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => onAddTrack(playlist)}>
                <Plus size={16} /> Agregar canción
              </Button>
              <Button
                size="sm"
                disabled={!!busy || !playlist.tracks.length || !playbackReady}
                onClick={() => onLoadPlaylist(playlist)}
              >
                {busy === 'load' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Play size={15} fill="currentColor" />
                )}{' '}
                {busy === 'load' ? 'Cargando cola…' : 'Escuchar'}
              </Button>
            </>
          ) : (
            <>
              {onImportPlaylist && (
                <Button variant="secondary" size="sm" onClick={onImportPlaylist} disabled={!!busy}>
                  <Download size={15} /> Importar playlist
                </Button>
              )}
              <Button size="sm" onClick={onCreatePlaylist} disabled={!!busy}>
                <Plus size={16} /> Nueva playlist
              </Button>
            </>
          )}
        </div>
      </div>
      {libraryLoading ? (
        <Loading text="Abriendo tu biblioteca…" />
      ) : playlist ? (
        <>
          <div className="playlist-detail">
            <div className="playlist-detail-art">
              {playlist.tracks[0]?.thumbnail ? (
                <Artwork track={playlist.tracks[0]} className="playlist-detail-cover" decorative />
              ) : (
                <ListMusic size={52} strokeWidth={1.2} />
              )}
            </div>
            <div>
              <span className="eyebrow">TU COLECCIÓN</span>
              <h2>{playlist.name}</h2>
              <p>
                {playlist.tracks.length} canciones ·{' '}
                {duration(playlist.tracks.reduce((sum, track) => sum + track.duration, 0))}
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
            />
          )}
        </>
      ) : playlists.length ? (
        <div className="playlist-grid">
          {playlists.map((item, index) => (
            <div
              key={item.id}
              className="playlist-card"
              role="button"
              tabIndex={0}
              onClick={() => onSelectPlaylist(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectPlaylist(item.id);
                }
              }}
            >
              <div className={`playlist-cover playlist-color-${index % 4}`}>
                {item.tracks[0]?.thumbnail ? (
                  <Artwork track={item.tracks[0]} className="playlist-cover-img" decorative />
                ) : (
                  <ListMusic size={62} strokeWidth={1.1} />
                )}
                <span>{String(index + 1).padStart(2, '0')}</span>
                <button
                  type="button"
                  className="playlist-cover-play"
                  aria-label={`Escuchar ${item.name}`}
                  disabled={!!busy || !item.tracks.length || !playbackReady}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onLoadPlaylist(item);
                  }}
                >
                  <Play size={19} fill="currentColor" />
                </button>
              </div>
              <h3>{item.name}</h3>
              <p>
                {item.tracks.length} canciones <span>•</span> Tu colección
              </p>
            </div>
          ))}
          <button className="playlist-new" onClick={onCreatePlaylist}>
            <span>
              <Plus size={27} />
            </span>
            <strong>Crea tu próxima playlist</strong>
            <p>Para cada versión de ti.</p>
          </button>
        </div>
      ) : (
        <EmptyState
          icon={<Library size={30} />}
          title="Tu próximo soundtrack empieza aquí"
          text="Crea una playlist y guarda las canciones que quieras volver a escuchar."
          action={
            <Button onClick={onCreatePlaylist}>
              <Plus size={16} /> Crear mi primera playlist
            </Button>
          }
        />
      )}
    </section>
  );
}
