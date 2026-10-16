import { Plus, Repeat, Square, Volume2 } from 'lucide-react';
import { IconButton } from '../common/IconButton';
import type { PlaybackBindings } from './PlayerBar';

export interface MobilePlaybackToolsProps {
  playback: PlaybackBindings;
}

export function MobilePlaybackTools({ playback }: MobilePlaybackToolsProps) {
  const { state, busy, controlsDisabled, volumeDraft, setVolumeDraft, action, onSaveTrack } = playback;
  const current = state?.current;
  return (
    <div className="mobile-playback-tools">
      <IconButton
        label="Detener reproducción"
        disabled={controlsDisabled || !current}
        onClick={() => action({ action: 'stop' })}
      >
        <Square size={16} />
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
      {current && (
        <IconButton
          label="Guardar canción actual en playlist"
          disabled={!!busy}
          onClick={() => onSaveTrack(current)}
        >
          <Plus size={18} />
        </IconButton>
      )}
      <label htmlFor="mobile-volume">
        <Volume2 size={15} />
        <span className="sr-only">Volumen</span>
      </label>
      <input
        id="mobile-volume"
        type="range"
        min="0"
        max="100"
        value={volumeDraft ?? state?.volume ?? 50}
        disabled={controlsDisabled}
        onChange={(event) => setVolumeDraft(Number(event.target.value))}
        onPointerUp={(event) =>
          void action({ action: 'volume', volume: Number(event.currentTarget.value) }).finally(() =>
            setVolumeDraft(null),
          )
        }
        onKeyUp={(event) => {
          if (
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(
              event.key,
            )
          )
            void action({ action: 'volume', volume: Number(event.currentTarget.value) }).finally(() =>
              setVolumeDraft(null),
            );
        }}
      />
      <span>{volumeDraft ?? state?.volume ?? 50}%</span>
    </div>
  );
}
