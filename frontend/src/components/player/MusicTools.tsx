import { LoaderCircle, Radio, Sparkles } from 'lucide-react';
import type { PlaybackBindings } from './PlayerBar';
import './music-tools.css';

/** Status belongs to the server snapshot. No optimistic radio flag. */
export function MusicTools({ playback, connected = true }: { playback: PlaybackBindings; connected?: boolean }) {
  const { state, busy, controlsDisabled, action } = playback;
  const disabled = controlsDisabled || !!busy || !connected || !state?.current || state.permissions?.canControl === false;
  const knownRadio = typeof state?.autoplay === 'boolean';
  return <div className="music-tools" aria-label="Herramientas musicales" aria-busy={busy === 'autoplay' || busy === 'recommend'}>
    <button className="music-tool-radio" aria-pressed={state?.autoplay === true} disabled={disabled || !knownRadio} onClick={() => void action({ action: 'autoplay', enabled: !state?.autoplay })}>
      {busy === 'autoplay' ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Radio size={16} aria-hidden="true" />}<span>Radio</span><span className="music-tool-state">{busy === 'autoplay' ? 'Actualizando…' : !knownRadio ? 'Sin estado' : state?.autoplay ? 'Activada' : 'Desactivada'}</span>
    </button>
    <button disabled={disabled} onClick={() => void action({ action: 'recommend' })}>
      {busy === 'recommend' ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}<span>{busy === 'recommend' ? 'Buscando canciones…' : 'Recomendar canciones'}</span>
    </button>
    {state?.permissions?.canControl === false && <p>Únete al canal de voz del bot para usar Radio y recomendaciones.</p>}
  </div>;
}
