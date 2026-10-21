import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  AlertCircle,
  Check,
  CheckSquare,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Link2,
  ListMusic,
  LoaderCircle,
  Music2,
  Search,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Artwork } from '../../components/artwork';
import { Button } from '../../components/ui/button';
import {
  api,
  ApiError,
  type ImportPlatform,
  type ImportedPlaylistPreview,
  type Playlist,
  type Session,
} from '../../lib/api';
import { duration } from '../../lib/utils';
import { inspectPlaylistUrl } from './playlist-import-url';

export interface PlaylistImportDialogProps {
  open: boolean;
  guildId: string;
  session: Session | null;
  onClose: () => void;
  onImported: (playlist: Playlist) => void;
  onOpenPlaylist: (playlistId: string) => void;
}

type ImportPhase = 'idle' | 'previewing' | 'ready' | 'saving' | 'saved';
type ImportSourceMode = 'url' | 'csv';

const SAMPLE_CSV = `Title,Artist,Album,Duration,Spotify URI
Tití Me Preguntó,Bad Bunny,Un Verano Sin Ti,243,spotify:track:1IHWl5LamUGEuP4ozKQSXZ
As It Was,Harry Styles,Harry's House,167,spotify:track:4LRPiXqCikLlN15c3yImP7`;

function formatPlatformLabel(platform: ImportPlatform): string {
  switch (platform) {
    case 'youtube_music':
      return 'YouTube Music';
    case 'youtube':
      return 'YouTube';
    case 'spotify':
      return 'Spotify';
    case 'csv':
      return 'CSV · Spotify / Manual';
  }
}

function makeRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function PlaylistImportDialog({
  open,
  guildId,
  session,
  onClose,
  onImported,
  onOpenPlaylist,
}: PlaylistImportDialogProps) {
  const urlInputId = useId();
  const csvInputId = useId();
  const csvFileInputId = useId();
  const nameInputId = useId();
  const [sourceMode, setSourceMode] = useState<ImportSourceMode>('url');
  const [url, setUrl] = useState('');
  const [csvText, setCsvText] = useState('');
  const [csvSourceName, setCsvSourceName] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [preview, setPreview] = useState<ImportedPlaylistPreview | null>(null);
  const [excludedPositions, setExcludedPositions] = useState<Set<number>>(() => new Set());
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [error, setError] = useState('');
  const [savedPlaylist, setSavedPlaylist] = useState<Playlist | null>(null);
  const [requestId, setRequestId] = useState(() => makeRequestId());

  const previewControllerRef = useRef<AbortController | null>(null);
  const saveControllerRef = useRef<AbortController | null>(null);
  const savingLockRef = useRef(false);
  const sessionCycleRef = useRef(0);

  const resetDialogState = () => {
    sessionCycleRef.current += 1;
    previewControllerRef.current?.abort();
    previewControllerRef.current = null;
    saveControllerRef.current?.abort();
    saveControllerRef.current = null;
    savingLockRef.current = false;
    setSourceMode('url');
    setUrl('');
    setCsvText('');
    setCsvSourceName('');
    setPlaylistName('');
    setNameTouched(false);
    setPreview(null);
    setExcludedPositions(new Set());
    setPhase('idle');
    setError('');
    setSavedPlaylist(null);
    setRequestId(makeRequestId());
  };

  useEffect(() => {
    resetDialogState();
    return () => {
      sessionCycleRef.current += 1;
      previewControllerRef.current?.abort();
      saveControllerRef.current?.abort();
    };
  }, [open, guildId, session?.csrfToken]);

  const inspection = useMemo(() => inspectPlaylistUrl(url), [url]);

  const selectedTracks = useMemo(() => {
    if (!preview) return [];
    return preview.tracks.filter((track) => !excludedPositions.has(track.position));
  }, [preview, excludedPositions]);

  const totalSelectedDuration = useMemo(
    () => selectedTracks.reduce((sum, track) => sum + (track.duration || 0), 0),
    [selectedTracks],
  );

  const handleClose = () => {
    resetDialogState();
    onClose();
  };

  const cancelActiveOperation = () => {
    if (phase === 'previewing') {
      sessionCycleRef.current += 1;
      previewControllerRef.current?.abort();
      previewControllerRef.current = null;
      setPhase(preview ? 'ready' : 'idle');
      setError('Consulta cancelada.');
      return;
    }
    if (phase === 'saving') {
      sessionCycleRef.current += 1;
      saveControllerRef.current?.abort();
      saveControllerRef.current = null;
      savingLockRef.current = false;
      setPhase('ready');
      setError('Importación cancelada.');
    }
  };

  const handleUrlChange = (nextUrl: string) => {
    setUrl(nextUrl);
    setError('');
    if (preview && nextUrl.trim() !== preview.sourceUrl) {
      previewControllerRef.current?.abort();
      previewControllerRef.current = null;
      setPreview(null);
      setExcludedPositions(new Set());
      setSavedPlaylist(null);
      setPhase('idle');
      setRequestId(makeRequestId());
      if (!nameTouched) {
        setPlaylistName('');
      }
    }
  };

  const handleFetchPreview = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!guildId || !session) return;
    if (inspection.status !== 'valid') {
      setError(inspection.hint || 'Introduce un enlace válido de playlist de YouTube o YouTube Music.');
      return;
    }
    const cycle = ++sessionCycleRef.current;
    previewControllerRef.current?.abort();
    const controller = new AbortController();
    previewControllerRef.current = controller;
    setPhase('previewing');
    setError('');
    setSavedPlaylist(null);

    try {
      const response = await api<{ preview: ImportedPlaylistPreview }>(
        `/api/guilds/${encodeURIComponent(guildId)}/playlists/import/preview`,
        {
          method: 'POST',
          body: JSON.stringify({ url: url.trim() }),
          signal: controller.signal,
        },
        session.csrfToken,
      );
      if (controller.signal.aborted || cycle !== sessionCycleRef.current) return;
      setPreview(response.preview);
      setExcludedPositions(new Set());
      setRequestId(makeRequestId());
      if (!nameTouched || !playlistName.trim()) {
        setPlaylistName(response.preview.title);
        setNameTouched(false);
      }
      setPhase('ready');
    } catch (problem) {
      if (controller.signal.aborted || cycle !== sessionCycleRef.current) return;
      setPhase(preview ? 'ready' : 'idle');
      setError(
        problem instanceof ApiError
          ? problem.message
          : 'No pudimos consultar la playlist. Comprueba el enlace e inténtalo de nuevo.',
      );
    } finally {
      if (previewControllerRef.current === controller) {
        previewControllerRef.current = null;
      }
    }
  };

  const handleSwitchSourceMode = (nextMode: ImportSourceMode) => {
    if (phase === 'saving' || nextMode === sourceMode) return;
    if (phase === 'previewing') {
      sessionCycleRef.current += 1;
      previewControllerRef.current?.abort();
      previewControllerRef.current = null;
    }
    setSourceMode(nextMode);
    setError('');
    setPreview(null);
    setExcludedPositions(new Set());
    setSavedPlaylist(null);
    setPhase('idle');
    setRequestId(makeRequestId());
    if (!nameTouched) {
      setPlaylistName('');
    }
  };

  const handleCsvFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    if (file.size > 262_144) {
      setError('El archivo CSV supera el tamaño máximo permitido (256 KB).');
      event.target.value = '';
      return;
    }
    try {
      const content = await file.text();
      setCsvSourceName(file.name);
      setCsvText(content);
      if (preview) {
        setPreview(null);
        setExcludedPositions(new Set());
        setSavedPlaylist(null);
        setPhase('idle');
        setRequestId(makeRequestId());
      }
      if (!nameTouched) {
        const baseName = file.name.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').trim();
        if (baseName) setPlaylistName(baseName.slice(0, 100));
      }
    } catch {
      setError('No se pudo leer el archivo CSV seleccionado.');
    } finally {
      event.target.value = '';
    }
  };

  const handlePreviewCsv = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!guildId || !session) return;
    if (!csvText.trim()) {
      setError('Selecciona un archivo .csv o pega las filas del CSV para analizar.');
      return;
    }
    const cycle = ++sessionCycleRef.current;
    previewControllerRef.current?.abort();
    const controller = new AbortController();
    previewControllerRef.current = controller;
    setPhase('previewing');
    setError('');
    setSavedPlaylist(null);

    try {
      const response = await api<{ preview: ImportedPlaylistPreview }>(
        `/api/guilds/${encodeURIComponent(guildId)}/playlists/import/csv`,
        {
          method: 'POST',
          body: JSON.stringify({
            csv: csvText,
            ...(csvSourceName ? { sourceName: csvSourceName } : {}),
            ...(nameTouched && playlistName.trim() ? { name: playlistName.trim() } : {}),
          }),
          signal: controller.signal,
        },
        session.csrfToken,
      );
      if (controller.signal.aborted || cycle !== sessionCycleRef.current) return;
      setPreview(response.preview);
      setExcludedPositions(new Set());
      setRequestId(makeRequestId());
      if (!nameTouched || !playlistName.trim()) {
        setPlaylistName(response.preview.title);
        setNameTouched(false);
      }
      setPhase('ready');
    } catch (problem) {
      if (controller.signal.aborted || cycle !== sessionCycleRef.current) return;
      setPhase(preview ? 'ready' : 'idle');
      setError(
        problem instanceof ApiError
          ? problem.message
          : 'No pudimos procesar el archivo CSV. Revisa los encabezados e inténtalo de nuevo.',
      );
    } finally {
      if (previewControllerRef.current === controller) {
        previewControllerRef.current = null;
      }
    }
  };

  const toggleTrackSelection = (position: number) => {
    if (phase === 'saving' || phase === 'saved') return;
    setExcludedPositions((prev) => {
      const next = new Set(prev);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  };

  const selectAllTracks = () => {
    if (phase === 'saving' || phase === 'saved') return;
    setExcludedPositions(new Set());
  };

  const deselectAllTracks = () => {
    if (!preview || phase === 'saving' || phase === 'saved') return;
    setExcludedPositions(new Set(preview.tracks.map((track) => track.position)));
  };

  const handleSavePlaylist = async (event: FormEvent) => {
    event.preventDefault();
    if (!guildId || !session || !preview || savingLockRef.current || phase === 'saving' || phase === 'saved') {
      return;
    }
    const finalName = playlistName.trim();
    if (!finalName) {
      setError('Escribe un nombre para guardar la playlist.');
      return;
    }
    if (!selectedTracks.length) {
      setError('Selecciona al menos una canción para importar.');
      return;
    }

    savingLockRef.current = true;
    const cycle = ++sessionCycleRef.current;
    saveControllerRef.current?.abort();
    const controller = new AbortController();
    saveControllerRef.current = controller;
    setPhase('saving');
    setError('');

    try {
      const response = await api<{ playlist: Playlist }>(
        `/api/guilds/${encodeURIComponent(guildId)}/playlists/import`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: finalName,
            requestId,
            tracks: selectedTracks.map((track) => ({
              url: track.url,
              title: track.title,
              artist: track.artist,
              duration: track.duration,
              thumbnail: track.thumbnail,
              source: track.source,
            })),
          }),
          signal: controller.signal,
        },
        session.csrfToken,
      );
      if (controller.signal.aborted || cycle !== sessionCycleRef.current) return;
      setSavedPlaylist(response.playlist);
      setPhase('saved');
      onImported(response.playlist);
    } catch (problem) {
      if (controller.signal.aborted || cycle !== sessionCycleRef.current) return;
      setPhase('ready');
      setError(
        problem instanceof ApiError
          ? problem.message
          : 'No se pudo guardar la playlist. Inténtalo de nuevo.',
      );
    } finally {
      savingLockRef.current = false;
      if (saveControllerRef.current === controller) {
        saveControllerRef.current = null;
      }
    }
  };

  const allSelected = preview ? selectedTracks.length === preview.tracks.length : false;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          if (phase === 'previewing' || phase === 'saving') {
            cancelActiveOperation();
          }
          handleClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog-content dialog-content-import">
          <DialogPrimitive.Title className="dialog-title">Importar playlist</DialogPrimitive.Title>
          <DialogPrimitive.Description className="muted dialog-description">
            Importa playlists desde enlaces de YouTube Music, YouTube o Spotify autorizado, o mediante un archivo CSV
            exportado de Spotify.
          </DialogPrimitive.Description>

          <div className="import-modal-body">
            <div className="import-mode-tabs" role="tablist" aria-label="Método de importación">
              <button
                type="button"
                role="tab"
                aria-selected={sourceMode === 'url'}
                className={`import-mode-tab ${sourceMode === 'url' ? 'is-active' : ''}`}
                disabled={phase === 'saving'}
                onClick={() => handleSwitchSourceMode('url')}
              >
                <Link2 size={14} />
                <span>Enlace (YouTube / Spotify)</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sourceMode === 'csv'}
                className={`import-mode-tab ${sourceMode === 'csv' ? 'is-active' : ''}`}
                disabled={phase === 'saving'}
                onClick={() => handleSwitchSourceMode('csv')}
              >
                <FileSpreadsheet size={14} />
                <span>Archivo CSV (Spotify / Manual)</span>
              </button>
            </div>

            {sourceMode === 'url' ? (
              <form className="import-url-bar" onSubmit={(event) => void handleFetchPreview(event)}>
                <div className="field-label-row">
                  <label htmlFor={urlInputId} className="import-field-label">
                    Enlace de la playlist
                  </label>
                  {inspection.status !== 'empty' && (
                    <span
                      className={`import-platform-pill is-${inspection.status} ${
                        inspection.platform ? `platform-${inspection.platform}` : ''
                      }`}
                    >
                      {inspection.label}
                    </span>
                  )}
                </div>
                <div className="import-url-input-group">
                  <input
                    id={urlInputId}
                    type="url"
                    value={url}
                    onChange={(event) => handleUrlChange(event.target.value)}
                    disabled={phase === 'saving'}
                    maxLength={2048}
                    placeholder="https://music.youtube.com/playlist?list=… o https://open.spotify.com/playlist/…"
                    autoFocus
                  />
                  {phase === 'previewing' ? (
                    <Button variant="secondary" type="button" onClick={cancelActiveOperation}>
                      Cancelar
                    </Button>
                  ) : (
                    <Button
                      variant={preview ? 'secondary' : 'default'}
                      type="submit"
                      disabled={!url.trim() || inspection.status !== 'valid' || phase === 'saving'}
                    >
                      <Search size={15} />
                      {preview ? 'Actualizar' : 'Analizar'}
                    </Button>
                  )}
                </div>
                {inspection.hint && (
                  <div className="import-url-hint-row">
                    <p className="import-url-hint" role="status">
                      {inspection.hint}
                    </p>
                    {inspection.platform === 'spotify' && (
                      <button
                        type="button"
                        className="import-csv-switch-link"
                        onClick={() => handleSwitchSourceMode('csv')}
                      >
                        Importar desde CSV →
                      </button>
                    )}
                  </div>
                )}
              </form>
            ) : (
              <form className="import-csv-form" onSubmit={(event) => void handlePreviewCsv(event)}>
                <div className="import-csv-header-row">
                  <div>
                    <label htmlFor={csvInputId} className="import-field-label">
                      Contenido CSV (Exportify, TuneMyMusic o formato SONORA)
                    </label>
                    <span className="import-csv-columns-hint">
                      Columnas: <code>Title</code> (o <code>Track Name</code>), <code>Artist</code> (o{' '}
                      <code>Artist Name(s)</code>), y opcionales <code>Album</code>, <code>Duration</code>,{' '}
                      <code>Spotify URI</code> / <code>URL</code>.
                    </span>
                  </div>
                  <div className="import-csv-file-actions">
                    <input
                      id={csvFileInputId}
                      type="file"
                      accept=".csv,text/csv"
                      className="sr-only"
                      disabled={phase === 'saving'}
                      onChange={(event) => void handleCsvFileSelect(event)}
                    />
                    <label htmlFor={csvFileInputId} className="import-file-btn">
                      <Upload size={14} />
                      <span>{csvSourceName ? csvSourceName : 'Subir .csv'}</span>
                    </label>
                    <button
                      type="button"
                      className="import-toggle-btn"
                      disabled={phase === 'saving'}
                      onClick={() => {
                        setCsvSourceName('spotify-favoritas.csv');
                        setCsvText(SAMPLE_CSV);
                        setError('');
                      }}
                    >
                      Cargar ejemplo
                    </button>
                  </div>
                </div>
                <textarea
                  id={csvInputId}
                  className="import-csv-textarea"
                  rows={4}
                  value={csvText}
                  onChange={(event) => {
                    setCsvText(event.target.value);
                    setError('');
                    if (preview) {
                      setPreview(null);
                      setExcludedPositions(new Set());
                      setSavedPlaylist(null);
                      setPhase('idle');
                    }
                  }}
                  disabled={phase === 'saving'}
                  placeholder={'Title,Artist,Album,Duration,Spotify URI\nTití Me Preguntó,Bad Bunny,Un Verano Sin Ti,243,spotify:track:1IHWl5LamUGEuP4ozKQSXZ'}
                />
                <div className="import-csv-submit-row">
                  <span className="muted">Máximo 256 KB · UTF-8 · hasta 500 canciones</span>
                  <Button
                    variant={preview ? 'secondary' : 'default'}
                    type="submit"
                    disabled={!csvText.trim() || phase === 'saving' || phase === 'previewing'}
                  >
                    <FileSpreadsheet size={15} />
                    {preview ? 'Reanalizar CSV' : 'Analizar CSV'}
                  </Button>
                </div>
              </form>
            )}

            {phase === 'previewing' && (
              <div className="import-progress-banner" role="status" aria-live="polite">
                <LoaderCircle size={18} className="spin" />
                <div>
                  <strong>Consultando metadatos de la playlist…</strong>
                  <span>Extrayendo canciones sin descargar audio.</span>
                </div>
              </div>
            )}

            {phase === 'saving' && (
              <div className="import-progress-banner is-saving" role="status" aria-live="polite">
                <LoaderCircle size={18} className="spin" />
                <div>
                  <strong>Guardando {selectedTracks.length} canciones en tu biblioteca…</strong>
                  <span>Escribiendo lote en SQLite de forma segura.</span>
                </div>
              </div>
            )}

            {error && (
              <div className="import-error-banner" role="alert">
                <AlertCircle size={16} />
                <span>{error}</span>
                {sourceMode === 'url' && (inspection.platform === 'spotify' || /CSV/i.test(error)) && (
                  <button
                    type="button"
                    className="import-csv-switch-link"
                    onClick={() => handleSwitchSourceMode('csv')}
                  >
                    Cambiar a Archivo CSV
                  </button>
                )}
              </div>
            )}

            {phase === 'saved' && savedPlaylist && (
              <div className="import-success-card" role="status" aria-live="polite">
                <div className="import-success-head">
                  <span className="import-success-icon">
                    <Check size={18} />
                  </span>
                  <div>
                    <strong>«{savedPlaylist.name}» ya está en tu biblioteca</strong>
                    <span>
                      Se guardaron {savedPlaylist.tracks.length}{' '}
                      {savedPlaylist.tracks.length === 1 ? 'canción' : 'canciones'} listas para reproducirse.
                    </span>
                  </div>
                </div>
                <div className="import-success-actions">
                  <Button variant="secondary" type="button" onClick={handleClose}>
                    Cerrar
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      const targetId = savedPlaylist.id;
                      handleClose();
                      onOpenPlaylist(targetId);
                    }}
                  >
                    <ExternalLink size={15} /> Abrir playlist importada
                  </Button>
                </div>
              </div>
            )}

            {preview && phase !== 'saved' && (
              <form className="import-preview-form" onSubmit={(event) => void handleSavePlaylist(event)}>
                <div className="import-dossier">
                  <div className="import-dossier-art">
                    {preview.thumbnail ? (
                      <Artwork
                        track={{
                          id: 'import-cover',
                          url: preview.sourceUrl,
                          title: preview.title,
                          artist: preview.author || 'YouTube',
                          duration: totalSelectedDuration,
                          thumbnail: preview.thumbnail,
                          source: 'youtube',
                        }}
                        className="import-dossier-cover"
                        decorative
                      />
                    ) : (
                      <ListMusic size={34} strokeWidth={1.3} />
                    )}
                  </div>
                  <div className="import-dossier-meta">
                    <div className="import-dossier-badges">
                      <span className="track-preview-badge">
                        {formatPlatformLabel(preview.platform)}
                      </span>
                      {preview.author && <span className="import-dossier-author">por {preview.author}</span>}
                    </div>
                    <label htmlFor={nameInputId} className="import-name-field">
                      <span>Nombre en tu biblioteca</span>
                      <input
                        id={nameInputId}
                        value={playlistName}
                        onChange={(event) => {
                          setNameTouched(true);
                          setPlaylistName(event.target.value);
                        }}
                        disabled={phase === 'saving'}
                        maxLength={100}
                        placeholder="Nombre de la playlist"
                        required
                      />
                    </label>
                    <div className="import-dossier-stats">
                      <span>
                        <strong>{selectedTracks.length}</strong> de {preview.tracks.length} seleccionadas
                      </span>
                      {totalSelectedDuration > 0 && (
                        <>
                          <span>·</span>
                          <span>{duration(totalSelectedDuration)}</span>
                        </>
                      )}
                      {preview.omittedCount > 0 && (
                        <>
                          <span>·</span>
                          <span className="import-stat-note">
                            {preview.omittedCount} no disponibles omitidas
                          </span>
                        </>
                      )}
                      {preview.truncated && (
                        <>
                          <span>·</span>
                          <span className="import-stat-note">Límite de 500 canciones alcanzado</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="import-tracklist-toolbar">
                  <span className="import-tracklist-title">
                    <Music2 size={13} /> Vista previa de canciones
                  </span>
                  <div className="import-tracklist-toggles">
                    <button
                      type="button"
                      className="import-toggle-btn"
                      disabled={phase === 'saving'}
                      onClick={allSelected ? deselectAllTracks : selectAllTracks}
                    >
                      {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                      {allSelected ? 'Deseleccionar todas' : 'Seleccionar todas'}
                    </button>
                  </div>
                </div>

                <div className="import-track-ledger" role="group" aria-label="Canciones de la playlist">
                  {preview.tracks.map((item, idx) => {
                    const checked = !excludedPositions.has(item.position);
                    return (
                      <label
                        key={`${item.position}-${item.sourceId}`}
                        className={`import-ledger-row ${checked ? 'is-selected' : 'is-excluded'} ${
                          idx >= 12 ? 'import-ledger-deferred' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={phase === 'saving'}
                          onChange={() => toggleTrackSelection(item.position)}
                          aria-label={`Incluir ${item.title} de ${item.artist}`}
                        />
                        <span className="import-ledger-index">{String(idx + 1).padStart(2, '0')}</span>
                        <Artwork
                          track={{
                            id: `import-item-${item.position}`,
                            url: item.url,
                            title: item.title,
                            artist: item.artist,
                            duration: item.duration,
                            thumbnail: item.thumbnail,
                            source: item.source,
                          }}
                          className="import-ledger-art"
                          decorative
                        />
                        <span className="import-ledger-copy">
                          <strong>{item.title}</strong>
                          <small>{item.album ? `${item.artist} · ${item.album}` : item.artist}</small>
                        </span>
                        <span className="import-ledger-duration">
                          {item.duration > 0 ? duration(item.duration) : '—'}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="modal-actions import-modal-actions">
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={phase === 'saving' ? cancelActiveOperation : handleClose}
                  >
                    {phase === 'saving' ? 'Cancelar importación' : 'Cancelar'}
                  </Button>
                  <Button
                    type="submit"
                    disabled={phase === 'saving' || !playlistName.trim() || selectedTracks.length === 0}
                  >
                    {phase === 'saving' ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Download size={15} />
                    )}
                    {phase === 'saving'
                      ? 'Importando…'
                      : `Importar (${selectedTracks.length})`}
                  </Button>
                </div>
              </form>
            )}

            {!preview && phase !== 'saved' && (
              <div className="modal-actions import-modal-actions">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={phase === 'previewing' ? cancelActiveOperation : handleClose}
                >
                  {phase === 'previewing' ? 'Detener consulta' : 'Cerrar'}
                </Button>
              </div>
            )}
          </div>

          <DialogPrimitive.Close asChild>
            <Button
              size="icon"
              variant="ghost"
              className="dialog-close"
              aria-label="Cerrar ventana"
              onClick={handleClose}
            >
              <X size={18} />
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
