import * as Dialog from '@radix-ui/react-dialog';
import { AudioLines, ChevronDown, Heart } from 'lucide-react';
import { memo, useId, useRef, useState, type RefObject } from 'react';
import type { PlaybackBindings } from '../../components/player/PlayerBar';
import { playbackLabels } from '../../components/player/NowPlaying';
import { duration } from '../../lib/utils';
import { LyricsPanel } from '../lyrics/LyricsPanel';
import { useLyrics } from '../lyrics/use-lyrics';
import { useLyricsClock } from '../lyrics/use-lyrics-clock';
import { AmbientBackground } from './AmbientBackground';
import { ImmersiveArtwork } from './ImmersiveArtwork';
import { ImmersiveControls } from './ImmersiveControls';
import './immersive.css';

type Connection = 'connecting' | 'live' | 'reconnecting';
export interface ImmersivePlayerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playback: PlaybackBindings;
  connection: Connection;
  error: string;
  guildName?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}
export function ImmersivePlayer({ open, onOpenChange, playback, connection, error, guildName, returnFocusRef }: ImmersivePlayerProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const lyrics = useLyrics(playback.state, open);
  const hasLyrics = lyrics.status === 'ready' && (lyrics.data?.status === 'synced' || lyrics.data?.status === 'plain');

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="immersive-overlay" />
      <Dialog.Content className="immersive-player" data-has-lyrics={hasLyrics ? 'true' : 'false'} aria-modal="true" aria-describedby={undefined} onOpenAutoFocus={() => {
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }} onCloseAutoFocus={(event) => {
        const target = returnFocusRef?.current || previousFocus.current;
        if (target?.isConnected) { event.preventDefault(); target.focus({ preventScroll: true }); }
      }}>
        <Dialog.Title className="sr-only">Reproductor inmersivo de SONORA</Dialog.Title>
        <AmbientBackground thumbnail={playback.state?.current?.thumbnail} />
        <header className="immersive-header">
          <div className="immersive-wordmark"><AudioLines size={22} aria-hidden="true" /><span>SONORA</span></div>
          <p>{guildName || playback.state?.voice?.name || 'Tu espacio musical'}</p>
          <Dialog.Close asChild><button className="immersive-close" aria-label="Cerrar reproductor inmersivo"><ChevronDown size={22} aria-hidden="true" /><span>Volver</span></button></Dialog.Close>
        </header>
        <ImmersiveStage playback={playback} connection={connection} error={error} lyrics={lyrics} hasLyrics={hasLyrics} />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** This local subtree alone receives the 10 Hz visual clock. */
function ImmersiveStage({ playback, connection, error, lyrics: lyricsProp, hasLyrics: hasLyricsProp }: { playback: PlaybackBindings; connection: Connection; error: string; lyrics?: ReturnType<typeof useLyrics>; hasLyrics?: boolean }) {
  const { state } = playback;
  const current = state?.current;
  const internalLyrics = useLyrics(state, !lyricsProp);
  const lyrics = lyricsProp ?? internalLyrics;
  const hasLyrics = hasLyricsProp ?? (lyrics.status === 'ready' && (lyrics.data?.status === 'synced' || lyrics.data?.status === 'plain'));
  const { positionSeconds, discontinuity } = useLyricsClock(state, connection);
  const [mobileView, setMobileView] = useState<'artwork' | 'lyrics'>('artwork');
  const coverId = useId(), lyricsId = useId();
  const progress = current?.duration ? Math.min(100, Math.max(0, positionSeconds / current.duration * 100)) : 0;
  const message = connection !== 'live' ? connection === 'reconnecting' ? 'Reconectando con el servidor…' : 'Conectando con el servidor…' : state?.permissions?.canControl === false ? 'Puedes escuchar. Únete al canal de voz para controlar la música.' : state?.status === 'recovering' ? 'Recuperando el audio. La posición se actualizará al continuar.' : state?.status === 'blocked' ? 'La reproducción está bloqueada. Revisa los diagnósticos del dashboard.' : '';
  return <div className="immersive-stage" data-mobile-view={mobileView} data-has-lyrics={hasLyrics ? 'true' : 'false'}>
    <nav className="immersive-mobile-switch" aria-label="Vista del reproductor">
      <button aria-pressed={mobileView === 'artwork'} aria-controls={coverId} onClick={() => setMobileView('artwork')}>Portada</button>
      <button aria-pressed={mobileView === 'lyrics'} aria-controls={lyricsId} onClick={() => setMobileView('lyrics')}>Letras</button>
    </nav>
    <div className="immersive-main">
      <section className="immersive-track-panel" aria-label="Canción actual" id={coverId}>
        <div className="immersive-artwork-region"><ImmersiveArtwork track={current} /></div>
        <ImmersiveMetadata playback={playback} compact={mobileView === 'lyrics'} />
        <div className="immersive-timeline">
          <div className="immersive-progress" role="progressbar" aria-label="Progreso de la canción" aria-valuemin={0} aria-valuemax={current?.duration || 0} aria-valuenow={Math.floor(positionSeconds)} aria-valuetext={`${duration(positionSeconds)} de ${duration(current?.duration || 0)}`}><span style={{ width: `${progress}%` }} /></div>
          <div className="immersive-time"><span>{duration(positionSeconds)}</span><span>{duration(current?.duration || 0)}</span></div>
        </div>
        <ImmersiveControls playback={playback} connection={connection} />
        <div className="immersive-playback-feedback">
          {error ? <p role="alert">{error}</p> : message ? <p>{message}</p> : <p>{state ? playbackLabels[state.status] : 'Sincronizando reproductor'}{state?.voice ? ` en ${state.voice.name}` : ''}</p>}
        </div>
      </section>
      <div className="immersive-lyrics-region" id={lyricsId}><LyricsPanel snapshot={state} positionSeconds={positionSeconds} discontinuity={discontinuity} lyricsQuery={lyrics} /></div>
    </div>
  </div>;
}
const ImmersiveMetadata = memo(function ImmersiveMetadata({ playback, compact }: { playback: PlaybackBindings; compact: boolean }) {
  const current = playback.state?.current;
  const favorite = !!current && playback.isFavorite(current);
  return <div className={`immersive-track-meta${compact ? ' is-compact' : ''}`}>
    <div key={current?.id || 'idle'} className="immersive-track-copy"><h1 title={current?.title}>{current?.title || 'Elige qué escuchar'}</h1><p>{current?.artist || 'Tu música empieza en el dashboard'}</p></div>
    <button className={`immersive-icon-button immersive-favorite${favorite ? ' is-active' : ''}`} aria-label={favorite ? 'Quitar canción actual de favoritos' : 'Guardar canción actual en favoritos'} aria-pressed={favorite} disabled={!current || !!playback.busy} onClick={() => current && void playback.toggleFavorite(current)}><Heart size={23} fill={favorite ? 'currentColor' : 'none'} /></button>
  </div>;
});
