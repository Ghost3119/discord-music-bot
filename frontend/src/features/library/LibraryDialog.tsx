import { Check, ListMusic, LoaderCircle, Plus } from 'lucide-react';
import type { FormEvent } from 'react';
import { Artwork } from '../../components/artwork';
import { CustomSelect } from '../../components/common/CustomSelect';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { duration } from '../../lib/utils';
import type { Playlist, Track } from '../../lib/api';
import type { Modal } from '../../types/app';

export interface LibraryDialogBindings {
  modal: Modal;
  busy: string;
  error: string;
  playlists: Playlist[];
  name: string;
  targetPlaylist: string;
  trackUrl: string;
  trackArtist: string;
  resolvedTrack: Omit<Track, 'id'> | null;
  resolvingTrack: boolean;
  onClose: () => void;
  onCreatePlaylist: () => void;
  onNameChange: (value: string) => void;
  onTargetPlaylistChange: (value: string) => void;
  onTrackUrlChange: (value: string) => void;
  onTrackTitleChange: (value: string) => void;
  onTrackArtistChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void | Promise<void>;
}

export interface LibraryDialogProps {
  dialog: LibraryDialogBindings;
}

export function LibraryDialog({ dialog }: LibraryDialogProps) {
  const {
    modal,
    busy,
    error,
    playlists,
    name,
    targetPlaylist,
    trackUrl,
    trackArtist,
    resolvedTrack,
    resolvingTrack,
    onClose,
    onCreatePlaylist,
    onNameChange,
    onTargetPlaylistChange,
    onTrackUrlChange,
    onTrackTitleChange,
    onTrackArtistChange,
    onSubmit,
  } = dialog;
  return (
    <Dialog
      open={!!modal}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={
        modal?.type === 'delete'
          ? 'Eliminar playlist'
          : modal?.type === 'save'
            ? 'Guardar en una playlist'
            : modal?.type === 'add'
              ? 'Agregar a tu colección'
              : modal?.playlist
                ? 'Dale un nuevo nombre'
                : 'Una playlist, un mood.'
      }
      description={
        modal?.type === 'delete'
          ? `Se eliminará «${modal.playlist.name}» y su colección de canciones.`
          : modal?.type === 'save'
            ? `Guarda «${modal.track.title}» para volver a escucharla.`
            : modal?.type === 'add'
              ? 'Pega el enlace de YouTube, Spotify, SoundCloud o Apple Music y completaremos los datos automáticamente.'
              : 'Ponle un nombre que te haga querer darle play.'
      }
    >
      <form className="modal-form" onSubmit={onSubmit}>
        {modal?.type === 'playlist' && (
          <label>
            Nombre de la playlist
            <input
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={100}
              placeholder="Por ejemplo, Después de medianoche"
              required
              autoFocus
            />
          </label>
        )}
        {modal?.type === 'save' &&
          (playlists.length ? (
            <div className="modal-field">
              <span className="modal-field-label">Playlist</span>
              <CustomSelect
                id="save-playlist-select"
                variant="field"
                value={targetPlaylist}
                placeholder="Selecciona una playlist"
                options={playlists.map((item, idx) => ({
                  value: item.id,
                  label: item.name,
                  sublabel: `${item.tracks.length} ${item.tracks.length === 1 ? 'canción' : 'canciones'}`,
                  icon: (
                    <span className={`playlist-mini playlist-color-${idx % 4}`}>
                      <ListMusic size={14} />
                    </span>
                  ),
                }))}
                onChange={onTargetPlaylistChange}
              />
            </div>
          ) : (
            <div className="no-playlist">
              <p>Primero necesitas crear una playlist.</p>
              <Button variant="secondary" type="button" onClick={onCreatePlaylist}>
                <Plus size={16} /> Crear playlist
              </Button>
            </div>
          ))}
        {modal?.type === 'add' && (
          <>
            <label>
              <span className="field-label-row">
                <span>Enlace de la canción</span>
                {resolvingTrack && (
                  <span className="resolve-status">
                    <LoaderCircle size={12} className="spin" /> Obteniendo datos…
                  </span>
                )}
                {!resolvingTrack && resolvedTrack && (
                  <span className="resolve-status is-ready">
                    <Check size={12} /> Datos detectados
                  </span>
                )}
              </span>
              <input
                type="url"
                value={trackUrl}
                onChange={(event) => onTrackUrlChange(event.target.value)}
                required
                maxLength={2000}
                placeholder="https://www.youtube.com/watch?v=…"
                autoFocus
              />
            </label>
            {resolvedTrack && (
              <div className="track-preview-card" aria-live="polite">
                <Artwork
                  track={{
                    id: 'preview',
                    ...resolvedTrack,
                    title: name.trim() || resolvedTrack.title,
                    artist: trackArtist.trim() || resolvedTrack.artist,
                  }}
                  className="track-preview-art"
                  decorative
                />
                <div className="track-preview-copy">
                  <span className="track-preview-badge">{resolvedTrack.source}</span>
                  <strong>{name.trim() || resolvedTrack.title}</strong>
                  <span>
                    {trackArtist.trim() || resolvedTrack.artist}
                    {resolvedTrack.duration > 0 ? ` · ${duration(resolvedTrack.duration)}` : ''}
                  </span>
                </div>
              </div>
            )}
            <label>
              Título <span className="muted">(se rellena con el enlace)</span>
              <input
                value={name}
                onChange={(event) => onTrackTitleChange(event.target.value)}
                maxLength={300}
                placeholder={
                  resolvingTrack
                    ? 'Obteniendo título del enlace…'
                    : 'Se completará automáticamente o escríbelo'
                }
              />
            </label>
            <label>
              Artista <span className="muted">(opcional)</span>
              <input
                value={trackArtist}
                onChange={(event) => onTrackArtistChange(event.target.value)}
                maxLength={300}
                placeholder={resolvingTrack ? 'Obteniendo artista…' : 'Nombre del artista o canal'}
              />
            </label>
            <p className="form-help">
              Al pegar el enlace completamos título, artista y portada automáticamente. Puedes ajustarlos si
              quieres.
            </p>
          </>
        )}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button variant="secondary" type="button" disabled={!!busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant={modal?.type === 'delete' ? 'destructive' : 'default'}
            type="submit"
            disabled={
              !!busy ||
              (modal?.type === 'save' && !targetPlaylist) ||
              (modal?.type === 'playlist' && !name.trim()) ||
              (modal?.type === 'add' && !trackUrl.trim())
            }
          >
            {busy === 'save' && <LoaderCircle className="spin" size={16} />}
            {modal?.type === 'delete' ? 'Eliminar playlist' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
