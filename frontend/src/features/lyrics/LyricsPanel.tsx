import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AudioLines, RefreshCw } from 'lucide-react';
import type { LyricsCurrentResponse } from '../../../../src/web/lyrics/contracts';
import type { PlaybackSnapshot } from '../../lib/api';
import { findActiveLine } from './playback-clock';
import { LyricsLine } from './LyricsLine';
import { useLyrics } from './use-lyrics';

export interface LyricsPanelProps { snapshot: PlaybackSnapshot | null; positionSeconds: number; discontinuity: number; enabled?: boolean }
export function LyricsPanel({ snapshot, positionSeconds, discontinuity, enabled = true }: LyricsPanelProps) {
  const lyrics = useLyrics(snapshot, enabled);
  const regionId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const playbackKey = JSON.stringify([snapshot?.guildId, snapshot?.current?.id, snapshot?.playbackId]);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const following = manualKey !== playbackKey;
  const data = lyrics.data;
  const lines = data?.status === 'synced' ? data.lines : null;
  const active = lines ? findActiveLine(lines, positionSeconds * 1000) : -1;
  const previousJump = useRef(discontinuity);
  const [layoutRevision, setLayoutRevision] = useState(0);
  useEffect(() => {
    if (!scroller.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setLayoutRevision((value) => value + 1));
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const region = scroller.current;
    if (!following || !lines || active < 0 || !region) return;
    const line = region.querySelector<HTMLElement>(`[data-line-index="${active}"]`);
    if (!line) return;
    const area = region.getBoundingClientRect();
    const current = line.getBoundingClientRect();
    if (!area.height) return;
    const top = current.top - area.top;
    const bottom = current.bottom - area.top;
    const jumped = previousJump.current !== discontinuity;
    previousJump.current = discontinuity;
    if (!jumped && top >= area.height * .3 && bottom <= area.height * .6) return;
    const nextTop = Math.max(0, region.scrollTop + top - area.height * .36);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof region.scrollTo === 'function') region.scrollTo({ top: nextTop, behavior: reduced || jumped ? 'instant' : 'smooth' });
    else region.scrollTop = nextTop;
  }, [active, following, discontinuity, lines, playbackKey, layoutRevision]);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [playbackKey]);
  const renderedLines = useMemo(() => lines?.map((line, index) => <LyricsLine key={`${line.timeMs}:${index}`} line={line} index={index} active={index === active} past={index < active} />), [lines, active]);
  const stopFollowing = () => { if (lines) setManualKey(playbackKey); };
  const source = data && 'source' in data ? data.source : null;
  return <section className="immersive-lyrics" aria-label="Letras" data-lyrics-status={lyrics.status === 'ready' ? data?.status : lyrics.status}>
    <div className="immersive-lyrics-heading">
      <h2>Letras</h2>
      {lines && !following && <button className="immersive-follow" onClick={() => setManualKey(null)} aria-controls={regionId}>Seguir reproducción</button>}
      {data?.status === 'plain' && <span>Sin sincronización</span>}
    </div>
    <div ref={scroller} id={regionId} className="immersive-lyrics-scroll" tabIndex={lines || data?.status === 'plain' ? 0 : undefined} aria-label="Texto de la canción" onWheel={stopFollowing} onTouchStart={stopFollowing} onPointerDown={(event) => { if (event.target === event.currentTarget) stopFollowing(); }} onKeyDown={(event) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stopFollowing();
    }}>
      {lines ? <div className="immersive-lyric-lines">{renderedLines}</div> : data?.status === 'plain' ? <div className="immersive-plain-lyrics">{data.plainLyrics}</div> : <LyricsFeedback status={lyrics.status} data={data} error={lyrics.error} canRetry={lyrics.canRetry} retry={lyrics.retry} />}
    </div>
    {source && <p className="immersive-lyrics-source">Letras de <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a></p>}
  </section>;
}

function LyricsFeedback({ status, data, error, canRetry, retry }: { status: string; data: LyricsCurrentResponse | null; error: string; canRetry: boolean; retry: () => void }) {
  const kind = status === 'ready' ? data?.status : status;
  const copy: Record<string, [string, string]> = {
    loading: ['Buscando letras', 'La música continúa mientras las consultamos.'],
    idle: ['Tu música, de cerca', 'Agrega una canción desde el dashboard para empezar.'],
    instrumental: ['Solo la música', 'Esta pista es instrumental.'],
    not_found: ['No hay letras disponibles', 'Puedes seguir escuchando esta canción.'],
    ambiguous: ['Sin una coincidencia confiable', 'No encontramos letras que correspondan a esta versión.'],
    temporary_error: ['Las letras no están disponibles ahora', 'El proveedor no respondió. Puedes volver a intentarlo.'],
    stale: ['La canción cambió', 'Vuelve a consultar las letras de la reproducción actual.'],
    error: ['No se pudieron cargar las letras', error],
  };
  const reasons = {
    rate_limited: 'LRCLIB limitó las consultas. Espera a que se habilite el botón para volver a consultar.',
    timeout: 'La consulta tardó demasiado. Puedes volver a intentarlo cuando se habilite el botón.',
    unavailable: 'No se pudo conectar con LRCLIB. La música puede continuar mientras vuelves a consultar.',
    invalid_response: 'LRCLIB devolvió una respuesta que no pudimos utilizar. Puedes volver a consultar más tarde.',
    busy: 'Hay otras consultas de letras en curso. Espera un momento para volver a consultar.',
  };
  const [title, fallbackDetail] = copy[kind || 'error'] || copy.error;
  const detail = data?.status === 'temporary_error' && data.reason ? reasons[data.reason] : fallbackDetail;
  const retryable = ['temporary_error', 'stale', 'error'].includes(kind || '');
  return <div className="immersive-lyrics-feedback" role={kind === 'loading' ? 'status' : undefined}>
    <AudioLines size={32} strokeWidth={1.3} aria-hidden="true" />
    <h3>{title}</h3><p>{detail}</p>
    {retryable && <button className="immersive-retry" disabled={!canRetry} onClick={retry}><RefreshCw size={16} aria-hidden="true" />Volver a consultar</button>}
  </div>;
}
