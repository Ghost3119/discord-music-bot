import * as Dialog from '@radix-ui/react-dialog';
import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { LyricsCandidate, LyricsCurrentResponse, LyricsFailureReason, LyricsSearchResponse } from '../../../../src/web/lyrics/contracts';
import { api, ApiError, type PlaybackSnapshot } from '../../lib/api';
import { duration } from '../../lib/utils';
import { clearManualLyrics, selectManualLyrics } from './manual-lyrics';
import { clearLyricsCache } from './use-lyrics';

export const lyricsFailureCopy: Record<LyricsFailureReason, string> = {
  rate_limited: 'El servicio limitó las consultas. Espera para volver a intentarlo.',
  timeout: 'La búsqueda tardó demasiado.',
  connection: 'No fue posible conectar con el servicio de letras.',
  unavailable: 'El servicio de letras no está disponible ahora.',
  invalid_response: 'No pudimos interpretar la respuesta del servicio.',
  busy: 'Hay otras consultas de letras en curso. Espera un momento.',
};

export function ManualLyricsDialog({ snapshot, onClose, trigger }: { snapshot: PlaybackSnapshot; onClose: () => void; trigger: HTMLElement | null }) {
  const [title, setTitle] = useState(snapshot.current?.title ?? '');
  const [artist, setArtist] = useState(snapshot.current?.artist ?? '');
  const [candidates, setCandidates] = useState<LyricsCandidate[] | null>(null);
  const [pending, setPending] = useState<'search' | number | null>(null);
  const [confirmation, setConfirmation] = useState<LyricsCandidate | null>(null);
  const [error, setError] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [, tick] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const chosenButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (confirmation) confirmButton.current?.focus(); }, [confirmation]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!Number.isFinite(retryAt) || retryAt <= Date.now()) return;
    const timer = setTimeout(() => tick((value) => value + 1), retryAt - Date.now() + 5);
    return () => clearTimeout(timer);
  }, [retryAt]);
  const close = () => { controller.current?.abort(); onClose(); };
  const request = async (record?: LyricsCandidate) => {
    if (controller.current || Date.now() < retryAt || !snapshot.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setPending(record?.id ?? 'search'); setError('');
    if (!record) setConfirmation(null);
    if (!record) setCandidates(null);
    const params = new URLSearchParams({ trackId: snapshot.current.id, playbackId: snapshot.playbackId ?? '' });
    if (record) params.set('recordId', String(record.id));
    else { params.set('title', title.trim()); params.set('artist', artist.trim()); }
    try {
      const data = await api<LyricsSearchResponse | LyricsCurrentResponse>(`/api/guilds/${encodeURIComponent(snapshot.guildId)}/lyrics/${record ? 'selection' : 'search'}?${params}`, { signal: abort.signal });
      if (!mounted.current || abort.signal.aborted) return;
      if (!data || data.guildId !== snapshot.guildId || data.trackId !== snapshot.current.id || data.playbackId !== (snapshot.playbackId ?? null) || data.status === 'stale' || data.status === 'idle') {
        setError('La canción cambió. Abre la búsqueda de la reproducción actual.'); setRetryAt(Infinity); return;
      }
      if (data.status === 'temporary_error') {
        setError(lyricsFailureCopy[data.reason ?? 'unavailable']);
        setRetryAt(Date.now() + Math.min(2_147_483_647, Math.max(1000, data.retryAfterMs))); return;
      }
      setRetryAt(0);
      if (data.status === 'results') setCandidates(data.candidates);
      else if (selectManualLyrics(snapshot, data)) close();
      else setError('No pudimos cargar esta versión. Vuelve a buscar para elegir otra.');
    } catch (failure) {
      if (!mounted.current || abort.signal.aborted) return;
      const denied = failure instanceof ApiError && [401, 403].includes(failure.status);
      const limited = failure instanceof ApiError && failure.status === 429;
      if (denied) { clearLyricsCache(); clearManualLyrics(snapshot); }
      setError(denied ? 'La sesión o el acceso al servidor cambió. Vuelve al dashboard para conectar.' : limited ? lyricsFailureCopy.rate_limited : failure instanceof ApiError && failure.status === 409 ? 'Los resultados vencieron. Vuelve a buscar esta canción.' : 'No se pudieron consultar las letras. Vuelve a intentarlo.');
      setRetryAt(denied ? Infinity : Date.now() + (limited ? 60_000 : 2000));
    } finally {
      if (controller.current === abort) controller.current = null;
      if (mounted.current && !abort.signal.aborted) setPending(null);
    }
  };
  const blocked = pending !== null || Date.now() < retryAt;
  const warningFor = (candidate: LyricsCandidate) => candidate.warning || (candidate.duration !== null && !!snapshot.current?.duration && Math.abs(candidate.duration - snapshot.current.duration) > 2 ? 'La duración de esta versión es diferente. Las letras podrían estar desincronizadas.' : '');
  const submit = (event: FormEvent) => { event.preventDefault(); if (title.trim() && artist.trim()) void request(); };
  return <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="lyrics-search-overlay" />
      <Dialog.Content className="lyrics-search-dialog" onCloseAutoFocus={(event) => { if (trigger?.isConnected) { event.preventDefault(); trigger.focus({ preventScroll: true }); } }}>
        <div className="lyrics-search-heading"><Dialog.Title>Buscar letras manualmente</Dialog.Title><Dialog.Close asChild><button aria-label="Cerrar búsqueda de letras"><X size={20} aria-hidden="true" /></button></Dialog.Close></div>
        <Dialog.Description>Busca la canción y elige la versión que estás escuchando. La selección se usa solo en esta reproducción.</Dialog.Description>
        <form onSubmit={submit} className="lyrics-search-form">
          <label>Canción<input value={title} maxLength={200} required onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Artista<input value={artist} maxLength={200} required onChange={(event) => setArtist(event.target.value)} /></label>
          <button className="lyrics-search-primary" type="submit" disabled={blocked || !title.trim() || !artist.trim()}><Search size={16} aria-hidden="true" />{pending === 'search' ? 'Buscando…' : error ? 'Volver a buscar' : 'Buscar'}</button>
        </form>
        {error && <p className="lyrics-search-error" role="alert">{error}{Number.isFinite(retryAt) && retryAt > Date.now() ? ' Espera a que se habilite la búsqueda.' : ''}</p>}
        {pending === 'search' && <p role="status" className="lyrics-search-status">Consultando versiones disponibles…</p>}
        {candidates && <div className="lyrics-search-results" aria-label="Resultados de letras">
          {candidates.length === 0 ? <p>No encontramos resultados. Prueba con otro título o artista.</p> : <ul>{candidates.map((candidate) => <li key={candidate.id}>
            <div><h3>{candidate.title}</h3><p>{candidate.artist}</p><p className="lyrics-search-metadata">{candidate.album || 'Álbum no indicado'} · {candidate.duration === null ? 'Duración no indicada' : duration(candidate.duration)}</p><p className="lyrics-search-format">{candidate.instrumental ? 'Instrumental' : candidate.synced ? 'Letras sincronizadas' : candidate.plain ? 'Sin sincronización' : 'Sin letras disponibles'}</p>{warningFor(candidate) && <p className="lyrics-search-warning">{warningFor(candidate)}</p>}</div>
            <button disabled={blocked || !(candidate.synced || candidate.plain || candidate.instrumental)} onClick={(event) => { chosenButton.current = event.currentTarget; if (warningFor(candidate)) setConfirmation(candidate); else void request(candidate); }}>{pending === candidate.id ? 'Cargando…' : 'Elegir'}</button>
          </li>)}</ul>}
        </div>}
        {confirmation && <div className="lyrics-search-confirmation" role="alert"><h3>Revisar esta versión</h3><p>{warningFor(confirmation)}</p><div><button ref={confirmButton} className="lyrics-search-primary" onClick={() => void request(confirmation)} disabled={blocked}>Usar esta versión</button><button disabled={pending !== null} onClick={() => { setConfirmation(null); chosenButton.current?.focus(); }}>Cancelar</button></div></div>}
        <p className="lyrics-search-attribution">Resultados de <a href="https://lrclib.net" target="_blank" rel="noreferrer">LRCLIB</a></p>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
