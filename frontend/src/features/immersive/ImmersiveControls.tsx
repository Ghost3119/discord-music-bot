import { memo, useId } from 'react';
import { LoaderCircle, Pause, Play, Repeat, Shuffle, SkipForward, Square, Volume2 } from 'lucide-react';
import type { PlaybackBindings } from '../../components/player/PlayerBar';

export const ImmersiveControls = memo(function ImmersiveControls({ playback, connection }: { playback: PlaybackBindings; connection: 'connecting' | 'live' | 'reconnecting' }) {
  const { state, busy, controlsDisabled, volumeDraft, setVolumeDraft, action } = playback;
  const volumeId = useId();
  const current = state?.current;
  const playing = state?.status === 'playing';
  const disabled = controlsDisabled || !!busy || connection !== 'live' || state?.permissions?.canControl === false;
  const volume = volumeDraft ?? state?.volume ?? 50;
  const commitVolume = (value: number) => {
    if (disabled || !current) { setVolumeDraft(null); return; }
    if (value === state?.volume) { setVolumeDraft(null); return; }
    void action({ action: 'volume', volume: value }).finally(() => setVolumeDraft(null));
  };
  return <div className="immersive-controls" aria-label="Controles de reproducción inmersiva" aria-busy={!!busy}>
    <div className="immersive-control-buttons">
      <button className="immersive-icon-button" aria-label="Mezclar cola" disabled={disabled || (state?.queue.length || 0) < 2} onClick={() => void action({ action: 'shuffle' })}><Shuffle size={20} /></button>
      <button className="immersive-icon-button" aria-label="Detener reproducción" disabled={disabled || !current} onClick={() => void action({ action: 'stop' })}><Square size={19} /></button>
      <button className="immersive-play-button" aria-label={playing ? 'Pausar reproducción' : 'Continuar reproducción'} disabled={disabled || !current || state?.status === 'recovering' || state?.status === 'blocked'} onClick={() => void action({ action: playing ? 'pause' : 'resume' })}>
        {busy === 'pause' || busy === 'resume' ? <LoaderCircle size={27} className="spin" /> : playing ? <Pause size={27} fill="currentColor" /> : <Play size={27} fill="currentColor" />}
      </button>
      <button className="immersive-icon-button" aria-label="Siguiente canción" disabled={disabled || !current || state?.status === 'blocked'} onClick={() => void action({ action: 'skip' })}>{busy === 'skip' ? <LoaderCircle size={23} className="spin" /> : <SkipForward size={23} fill="currentColor" />}</button>
      <button className={`immersive-icon-button${state?.repeat ? ' is-active' : ''}`} aria-label={`Repetición: ${state?.repeat === 1 ? 'canción' : state?.repeat === 2 ? 'cola' : 'desactivada'}. Cambiar modo`} aria-pressed={!!state?.repeat} disabled={disabled || !current} onClick={() => void action({ action: 'repeat', mode: ((state?.repeat || 0) + 1) % 3 })}><Repeat size={20} />{state?.repeat === 1 && <span className="immersive-repeat-one">1</span>}</button>
    </div>
    <div className="immersive-volume">
      <Volume2 size={18} aria-hidden="true" />
      <label htmlFor={volumeId} className="sr-only">Volumen del servidor</label>
      <input id={volumeId} type="range" min={0} max={100} step={1} value={volume} disabled={disabled || !current} onChange={(event) => setVolumeDraft(Number(event.target.value))} onPointerUp={(event) => commitVolume(Number(event.currentTarget.value))} onPointerCancel={() => setVolumeDraft(null)} onKeyUp={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commitVolume(Number(event.currentTarget.value));
      }} />
      <output htmlFor={volumeId}>{volume}%</output>
    </div>
  </div>;
});
