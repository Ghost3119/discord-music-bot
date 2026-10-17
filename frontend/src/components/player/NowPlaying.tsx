import { AudioLines, Headphones, Heart, LoaderCircle, Pause, Play, Plus, SkipForward } from 'lucide-react';
import { Artwork } from '../artwork';
import { IconButton } from '../common/IconButton';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import type { PlaybackBindings } from './PlayerBar';
import { MusicTools } from './MusicTools';

export const playbackLabels = {
  idle: 'En espera',
  playing: 'Reproduciendo',
  paused: 'En pausa',
  recovering: 'Recuperando audio',
  blocked: 'Reproducción bloqueada',
};

export interface NowPlayingProps {
  playback: PlaybackBindings;
}

export function NowPlaying({ playback }: NowPlayingProps) {
  const { state, busy, controlsDisabled, action, isFavorite, toggleFavorite, onSaveTrack } = playback;
  const current = state?.current;
  const playing = state?.status === 'playing';
  const labels = playbackLabels;
  return (
    <section className={cn('now-card', !current && 'now-card-idle')} aria-label="Canción actual">
      <div className="now-card-top">
        <span className="now-label">
          <span className={cn('tiny-dot', playing && 'pulse')} /> AHORA SUENA
        </span>
        <span className="now-number">
          01 / {String((state?.queue.length || 0) + (current ? 1 : 0)).padStart(2, '0')}
        </span>
      </div>
      <div className="now-card-body">
        <div className="hero-art-wrap">
          <Artwork track={current} className="hero-art" />
          <span className="hero-art-tag">
            <AudioLines size={12} /> SONORA SESSION
          </span>
        </div>
        <div className="now-copy">
          <span className="track-origin">{current?.source || 'TU ESPACIO MUSICAL'}</span>
          <h2>
            {current?.title || (state ? 'Un buen momento empieza con una canción.' : 'Afinando tu espacio…')}
          </h2>
          <p>{current?.artist || 'Agrega algo que te guste y deja que suene.'}</p>
          <div className="hero-status">
            <span className={cn('status-indicator', playing && 'status-playing')} />
            {state ? labels[state.status] : 'Sincronizando reproductor'}
          </div>
          <div className="hero-controls">
            <Button
              className="hero-play"
              onClick={() => action({ action: playing ? 'pause' : 'resume' })}
              disabled={controlsDisabled || !current}
            >
              {busy === 'pause' || busy === 'resume' ? (
                <LoaderCircle size={18} className="spin" />
              ) : playing ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} fill="currentColor" />
              )}
              {state?.status === 'paused' ? 'Continuar' : playing ? 'Pausar' : 'Reproducir'}
            </Button>
            <IconButton
              label="Siguiente canción"
              disabled={controlsDisabled || !current || state?.status === 'blocked'}
              onClick={() => action({ action: 'skip' })}
            >
              <SkipForward size={22} />
            </IconButton>
            <IconButton
              label="Guardar canción actual en favoritos"
              active={!!current && isFavorite(current)}
              aria-pressed={!!current && isFavorite(current)}
              disabled={!current || !!busy}
              onClick={() => current && toggleFavorite(current)}
            >
              <Heart size={21} fill={current && isFavorite(current) ? 'currentColor' : 'none'} />
            </IconButton>
            {current && (
              <IconButton
                label="Guardar canción actual en playlist"
                disabled={!!busy}
                onClick={() => onSaveTrack(current)}
              >
                <Plus size={21} />
              </IconButton>
            )}
          </div>
        </div>
      </div>
      <MusicTools playback={playback} />
      <div className="now-card-footer">
        <div>
          <Headphones size={14} />
          <span>{state?.voice?.name || 'Sin conexión de voz'}</span>
        </div>
        <span>{state?.voice ? `${state.voice.members} en el canal` : 'Conéctate desde Discord'}</span>
      </div>
    </section>
  );
}
