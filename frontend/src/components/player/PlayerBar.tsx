import { Heart, ListMusic, Pause, Play, Repeat, Shuffle, SkipForward, Square, Volume2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Artwork } from '../artwork';
import { IconButton } from '../common/IconButton';
import { Button } from '../ui/button';
import { duration } from '../../lib/utils';
import type { MusicAction, PlaybackSnapshot, Track } from '../../lib/api';

export interface PlaybackBindings {
  state: PlaybackSnapshot | null;
  busy: string;
  controlsDisabled: boolean;
  volumeDraft: number | null;
  setVolumeDraft: (value: number | null) => void;
  action: (command: MusicAction) => Promise<void>;
  isFavorite: (track: Track) => boolean;
  toggleFavorite: (track: Track) => void | Promise<void>;
  onSaveTrack: (track: Track) => void;
}

export interface PlayerBarProps {
  playback: PlaybackBindings;
  onShowQueue: () => void;
}

export function PlayerBar({ playback, onShowQueue }: PlayerBarProps) {
  const { state, busy, controlsDisabled, volumeDraft, setVolumeDraft, action, isFavorite, toggleFavorite } =
    playback;
  const current = state?.current;
  const playing = state?.status === 'playing';
  const progress = current?.duration
    ? Math.min(100, Math.max(0, (state!.currentTime / current.duration) * 100))
    : 0;
  return (
    <footer className="persistent-player" aria-label="Controles de reproducción">
      <div className="player-track">
        <Artwork track={current} className="player-art" decorative />
        <div>
          <strong>{current?.title || 'Tu próxima canción te espera'}</strong>
          <span>{current?.artist || 'Dale play a tu servidor'}</span>
        </div>
        <IconButton
          label="Guardar en favoritos"
          active={!!current && isFavorite(current)}
          aria-pressed={!!current && isFavorite(current)}
          disabled={!current || !!busy}
          onClick={() => current && toggleFavorite(current)}
        >
          <Heart size={17} fill={current && isFavorite(current) ? 'currentColor' : 'none'} />
        </IconButton>
      </div>
      <div className="player-center">
        <div className="player-buttons">
          <IconButton
            label="Mezclar cola"
            disabled={controlsDisabled || (state?.queue.length || 0) < 2}
            onClick={() => action({ action: 'shuffle' })}
          >
            <Shuffle size={17} />
          </IconButton>
          <IconButton
            label="Detener reproducción"
            disabled={controlsDisabled || !current}
            onClick={() => action({ action: 'stop' })}
          >
            <Square size={16} />
          </IconButton>
          <Button
            className="player-main-button"
            size="icon"
            aria-label={playing ? 'Pausar reproducción' : 'Continuar reproducción'}
            disabled={controlsDisabled || !current}
            onClick={() => action({ action: playing ? 'pause' : 'resume' })}
          >
            {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
          </Button>
          <IconButton
            label="Siguiente canción"
            disabled={controlsDisabled || !current || state?.status === 'blocked'}
            onClick={() => action({ action: 'skip' })}
          >
            <SkipForward size={19} fill="currentColor" />
          </IconButton>
          <IconButton
            label={`Repetición: ${state?.repeat === 1 ? 'canción' : state?.repeat === 2 ? 'cola' : 'desactivada'}. Cambiar modo`}
            active={!!state?.repeat}
            disabled={controlsDisabled}
            onClick={() => action({ action: 'repeat', mode: ((state?.repeat || 0) + 1) % 3 })}
          >
            <Repeat size={17} />
            {state?.repeat === 1 && <span className="repeat-one">1</span>}
          </IconButton>
        </div>
        <div className="player-progress">
          <span>{duration(state?.currentTime || 0)}</span>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Progreso de la canción"
            aria-valuemin={0}
            aria-valuemax={current?.duration || 0}
            aria-valuenow={Math.floor(state?.currentTime || 0)}
          >
            <div style={{ width: `${progress}%` }} />
          </div>
          <span>{duration(current?.duration || 0)}</span>
        </div>
      </div>
      <div className="player-volume">
        <IconButton label="Ver cola musical" onClick={onShowQueue}>
          <ListMusic size={18} />
        </IconButton>
        <span className="volume-divider" />
        <Volume2 size={18} />
        <label className="sr-only" htmlFor="volume">
          Volumen
        </label>
        <input
          id="volume"
          type="range"
          min="0"
          max="100"
          step="1"
          value={volumeDraft ?? state?.volume ?? 50}
          disabled={controlsDisabled}
          onChange={(event) => setVolumeDraft(Number(event.target.value))}
          onPointerUp={(event) => {
            const value = Number(event.currentTarget.value);
            void action({ action: 'volume', volume: value }).finally(() => setVolumeDraft(null));
          }}
          onKeyUp={(event) => {
            if (
              [
                'ArrowLeft',
                'ArrowRight',
                'ArrowUp',
                'ArrowDown',
                'Home',
                'End',
                'PageUp',
                'PageDown',
              ].includes(event.key)
            )
              void action({ action: 'volume', volume: Number(event.currentTarget.value) }).finally(() =>
                setVolumeDraft(null),
              );
          }}
          style={{ '--volume': `${volumeDraft ?? state?.volume ?? 50}%` } as CSSProperties}
        />
        <span className="volume-value">{volumeDraft ?? state?.volume ?? 50}%</span>
      </div>
    </footer>
  );
}
