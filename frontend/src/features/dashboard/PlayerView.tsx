import { ArrowRight, Disc3, LoaderCircle, Plus, Radio, Search } from 'lucide-react';
import type { FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { NowPlaying, playbackLabels } from '../../components/player/NowPlaying';
import { MobilePlaybackTools } from '../../components/player/MobilePlaybackTools';
import type { PlaybackBindings } from '../../components/player/PlayerBar';
import { QueueSection, type TrackActions } from '../../components/queue/TrackList';
import { cn } from '../../lib/utils';

export interface PlayerViewProps {
  playback: PlaybackBindings;
  connection: string;
  query: string;
  onQueryChange: (value: string) => void;
  onAddToQueue: (event: FormEvent) => void | Promise<void>;
  onDiagnostics: () => void;
  trackActions: TrackActions;
}

export function PlayerView({
  playback,
  connection,
  query,
  onQueryChange,
  onAddToQueue,
  onDiagnostics,
  trackActions,
}: PlayerViewProps) {
  const { state, busy, controlsDisabled, action } = playback;
  const labels = playbackLabels;
  return (
    <>
      <form className="search-bar" onSubmit={onAddToQueue}>
        <Search size={20} />
        <label className="sr-only" htmlFor="music-search">
          Buscar canción o pegar enlace
        </label>
        <input
          id="music-search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="¿Qué escuchamos? Busca una canción o pega un enlace…"
          maxLength={500}
          autoComplete="off"
        />
        <span className="search-hint">YouTube · Spotify · SoundCloud</span>
        <Button
          type="submit"
          aria-label="Agregar a la cola"
          disabled={!query.trim() || controlsDisabled}
          size="sm"
        >
          {busy === 'play' ? <LoaderCircle size={16} className="spin" /> : <Plus size={17} />}
          <span>Agregar</span>
        </Button>
      </form>
      <div className="listening-layout">
        <NowPlaying playback={playback} />
        <aside className="session-card">
          <span className="eyebrow">MEJOR EN COMPAÑÍA</span>
          <div className="session-disc">
            <Disc3 size={52} strokeWidth={1.1} />
            <span className="session-spark">✦</span>
          </div>
          <h3>
            La música nos
            <br />
            encuentra aquí.
          </h3>
          <p>
            Una cola compartida.
            <br />
            Mil formas de sentirla.
          </p>
          <div className="session-status">
            <span className="tiny-dot" />
            <span>{state?.voice ? 'Sesión de escucha activa' : 'Listo para tu próxima sesión'}</span>
          </div>
        </aside>
      </div>
      <MobilePlaybackTools playback={playback} />
      <div className="queue-layout">
        <QueueSection
          state={state}
          controlsDisabled={controlsDisabled}
          onShuffle={() => action({ action: 'shuffle' })}
          actions={trackActions}
        />
        <aside className="connection-card">
          <div className="connection-card-title">
            <Radio size={17} />
            <h3>Tu sesión</h3>
            <span className={cn('status-indicator', connection === 'live' && 'status-playing')} />
          </div>
          <dl>
            <div>
              <dt>Canal de voz</dt>
              <dd>{state?.voice?.name || 'Desconectado'}</dd>
            </div>
            <div>
              <dt>Reproductor</dt>
              <dd>{state ? labels[state.status] : 'Sincronizando'}</dd>
            </div>
            <div>
              <dt>Actualizaciones</dt>
              <dd>{connection === 'live' ? 'En tiempo real' : 'Reconectando…'}</dd>
            </div>
          </dl>
          <button className="text-link" onClick={onDiagnostics}>
            Ver diagnóstico <ArrowRight size={14} />
          </button>
        </aside>
      </div>
    </>
  );
}
