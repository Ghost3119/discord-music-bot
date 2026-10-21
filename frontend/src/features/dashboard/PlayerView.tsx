import * as React from 'react';
import { ArrowRight, Disc3, LoaderCircle, Plus, Radio, Search } from 'lucide-react';
import type { FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { NowPlaying, playbackLabels } from '../../components/player/NowPlaying';
import { MobilePlaybackTools } from '../../components/player/MobilePlaybackTools';
import type { PlaybackBindings } from '../../components/player/PlayerBar';
import { QueueSection, type TrackActions } from '../../components/queue/TrackList';
import { api, type MusicSearchSuggestionsResponse } from '../../lib/api';
import { cn } from '../../lib/utils';

export interface PlayerViewProps {
  playback: PlaybackBindings;
  connection: string;
  query: string;
  onQueryChange: (value: string) => void;
  onAddToQueue: (event: FormEvent) => void | Promise<void>;
  onDiagnostics: () => void;
  onOpenSearch?: (initialQuery?: string) => void;
  trackActions: TrackActions;
}

function hasReactDispatcher(): boolean {
  const internals = (
    React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H: unknown };
    }
  ).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  return Boolean(internals && internals.H);
}

export function PlayerView({
  playback,
  connection,
  query,
  onQueryChange,
  onAddToQueue,
  onDiagnostics,
  onOpenSearch,
  trackActions,
}: PlayerViewProps) {
  const { state, busy, controlsDisabled, action } = playback;
  const labels = playbackLabels;
  const mounted = hasReactDispatcher();
  const [suggestions, setSuggestions] = mounted ? React.useState<string[]>([]) : [[], () => {}];
  const [openDropdown, setOpenDropdown] = mounted ? React.useState(false) : [false, () => {}];
  const guildId = state?.guildId ?? '';
  const isLink = /^https?:\/\//i.test(query.trim());

  if (mounted) {
    React.useEffect(() => {
      const trimmed = query.trim();
      if (trimmed.length < 2 || isLink || !guildId) {
        setSuggestions([]);
        return;
      }
      const controller = new AbortController();
      const timer = window.setTimeout(async () => {
        try {
          const res = await api<MusicSearchSuggestionsResponse>(
            `/api/guilds/${guildId}/search/suggestions?q=${encodeURIComponent(trimmed)}`,
            { method: 'GET', signal: controller.signal },
          );
          if (!controller.signal.aborted && Array.isArray(res?.suggestions)) {
            setSuggestions(res.suggestions);
          }
        } catch {
          // Ignore optional suggestion errors
        }
      }, 180);
      return () => {
        window.clearTimeout(timer);
        controller.abort();
      };
    }, [query, guildId, isLink]);
  }

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
          onFocus={() => setOpenDropdown(true)}
          onBlur={() => window.setTimeout(() => setOpenDropdown(false), 160)}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setOpenDropdown(true);
          }}
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
        {mounted && openDropdown && !isLink && query.trim().length >= 2 && (
          <div className="quick-search-dropdown" role="listbox" aria-label="Sugerencias de búsqueda">
            {onOpenSearch && (
              <button
                type="button"
                className="quick-search-explore"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setOpenDropdown(false);
                  onOpenSearch(query.trim());
                }}
              >
                <Search size={14} />
                <span>
                  Ver resultados y portadas de <strong>«{query.trim()}»</strong> en Buscar música
                </span>
                <ArrowRight size={14} />
              </button>
            )}
            {suggestions.map((item) => (
              <button
                key={item}
                type="button"
                className="music-autocomplete-item"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setOpenDropdown(false);
                  if (onOpenSearch) {
                    onOpenSearch(item);
                  } else {
                    onQueryChange(item);
                  }
                }}
              >
                <Search size={14} />
                <span>{item}</span>
              </button>
            ))}
          </div>
        )}
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
