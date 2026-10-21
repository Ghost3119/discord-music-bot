import * as React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Disc3,
  Heart,
  ListEnd,
  LoaderCircle,
  Play,
  Plus,
  Radio,
  Search,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import type { FormEvent } from 'react';
import { Artwork } from '../../components/artwork';
import { IconButton } from '../../components/common/IconButton';
import { Button } from '../../components/ui/button';
import { NowPlaying, playbackLabels } from '../../components/player/NowPlaying';
import { MobilePlaybackTools } from '../../components/player/MobilePlaybackTools';
import type { PlaybackBindings } from '../../components/player/PlayerBar';
import { QueueSection, type TrackActions } from '../../components/queue/TrackList';
import {
  api,
  type MusicSearchPlatform,
  type MusicSearchProviderStatus,
  type MusicSearchResponse,
  type MusicSearchSuggestionsResponse,
  type MusicSearchTrack,
  type Track,
} from '../../lib/api';
import { cn, duration } from '../../lib/utils';
import {
  PLATFORM_LABELS,
  SEARCH_PLATFORMS,
  formatArtistAndChannel,
  toDashboardTrack,
} from '../search/SearchView';

export interface PlayerViewProps {
  playback: PlaybackBindings;
  connection: string;
  query: string;
  onQueryChange: (value: string) => void;
  onAddToQueue: (event: FormEvent) => void | Promise<void>;
  onDiagnostics: () => void;
  onEnqueueTrack?: (track: Track) => void | Promise<void>;
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

function isDirectUrl(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^(?:https?:\/\/|www\.|(?:music\.)?youtube\.com\/|youtu\.be\/|soundcloud\.com\/|open\.spotify\.com\/|music\.apple\.com\/)/i.test(
      trimmed,
    )
  );
}

type LiveSearchStatus = 'idle' | 'loading' | 'results' | 'empty' | 'error';

export function PlayerView({
  playback,
  connection,
  query,
  onQueryChange,
  onAddToQueue,
  onDiagnostics,
  onEnqueueTrack,
  trackActions,
}: PlayerViewProps) {
  const { state, busy, controlsDisabled, action } = playback;
  const labels = playbackLabels;

  if (!hasReactDispatcher()) {
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

  const guildId = state?.guildId ?? '';
  const [platform, setPlatform] = React.useState<MusicSearchPlatform>('all');
  const [searchStatus, setSearchStatus] = React.useState<LiveSearchStatus>('idle');
  const [submittedQuery, setSubmittedQuery] = React.useState('');
  const [results, setResults] = React.useState<MusicSearchTrack[]>([]);
  const [providers, setProviders] = React.useState<MusicSearchProviderStatus[]>([]);
  const [partial, setPartial] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [panelDismissed, setPanelDismissed] = React.useState(false);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const radioRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const activeControllerRef = React.useRef<AbortController | null>(null);
  const suggestControllerRef = React.useRef<AbortController | null>(null);
  const requestIdRef = React.useRef(0);
  const searchTimerRef = React.useRef<number | null>(null);
  const suggestTimerRef = React.useRef<number | null>(null);
  const prevGuildIdRef = React.useRef(guildId);

  const cancelAllInFlight = React.useCallback(() => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    if (suggestTimerRef.current !== null) {
      window.clearTimeout(suggestTimerRef.current);
      suggestTimerRef.current = null;
    }
    requestIdRef.current += 1;
    if (activeControllerRef.current) {
      activeControllerRef.current.abort();
      activeControllerRef.current = null;
    }
    if (suggestControllerRef.current) {
      suggestControllerRef.current.abort();
      suggestControllerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (prevGuildIdRef.current !== guildId) {
      prevGuildIdRef.current = guildId;
      cancelAllInFlight();
      setSearchStatus('idle');
      setResults([]);
      setProviders([]);
      setPartial(false);
      setSuggestions([]);
      setErrorMessage('');
      setSubmittedQuery('');
    }
  }, [guildId, cancelAllInFlight]);

  React.useEffect(() => {
    return () => {
      cancelAllInFlight();
    };
  }, [cancelAllInFlight]);

  const executeLiveSearch = React.useCallback(
    async (rawText: string, targetPlatform: MusicSearchPlatform) => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
      const trimmed = rawText.trim();
      if (!trimmed || isDirectUrl(trimmed) || !guildId) {
        return;
      }

      activeControllerRef.current?.abort();
      const controller = new AbortController();
      activeControllerRef.current = controller;
      const currentRequestId = ++requestIdRef.current;
      const originGuild = guildId;

      setPanelDismissed(false);
      setSubmittedQuery(trimmed);
      setSearchStatus('loading');
      setErrorMessage('');

      try {
        const params = new URLSearchParams({
          q: trimmed,
          platform: targetPlatform,
        });
        const response = await api<MusicSearchResponse>(
          `/api/guilds/${originGuild}/search?${params.toString()}`,
          { method: 'GET', signal: controller.signal },
        );

        if (
          controller.signal.aborted ||
          currentRequestId !== requestIdRef.current ||
          originGuild !== prevGuildIdRef.current
        ) {
          return;
        }

        const nextResults = Array.isArray(response.results) ? response.results : [];
        setResults(nextResults);
        setProviders(Array.isArray(response.providers) ? response.providers : []);
        setPartial(Boolean(response.partial));
        setSearchStatus(nextResults.length > 0 ? 'results' : 'empty');
      } catch (err) {
        if (
          controller.signal.aborted ||
          currentRequestId !== requestIdRef.current ||
          originGuild !== prevGuildIdRef.current
        ) {
          return;
        }
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'No se pudo completar la búsqueda. Inténtalo de nuevo.';
        setErrorMessage(msg);
        setResults([]);
        setProviders([]);
        setPartial(false);
        setSearchStatus('error');
      } finally {
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
      }
    },
    [guildId],
  );

  // Live debounced search & autocomplete suggestions as user types
  React.useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2 || isDirectUrl(trimmed) || !guildId) {
      cancelAllInFlight();
      setSuggestions([]);
      if (!trimmed || isDirectUrl(trimmed)) {
        setSearchStatus('idle');
        setResults([]);
        setProviders([]);
        setPartial(false);
        setErrorMessage('');
        setSubmittedQuery('');
      }
      return;
    }

    setPanelDismissed(false);

    if (suggestTimerRef.current !== null) window.clearTimeout(suggestTimerRef.current);
    suggestTimerRef.current = window.setTimeout(async () => {
      suggestTimerRef.current = null;
      suggestControllerRef.current?.abort();
      const controller = new AbortController();
      suggestControllerRef.current = controller;
      try {
        const res = await api<MusicSearchSuggestionsResponse>(
          `/api/guilds/${guildId}/search/suggestions?q=${encodeURIComponent(trimmed)}`,
          { method: 'GET', signal: controller.signal },
        );
        if (!controller.signal.aborted && Array.isArray(res?.suggestions)) {
          setSuggestions(
            res.suggestions
              .filter((item) => item.toLowerCase() !== trimmed.toLowerCase())
              .slice(0, 5),
          );
        }
      } catch {
        // Ignore optional suggestion errors
      }
    }, 150);

    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      void executeLiveSearch(trimmed, platform);
    }, 320);

    return () => {
      if (suggestTimerRef.current !== null) {
        window.clearTimeout(suggestTimerRef.current);
        suggestTimerRef.current = null;
      }
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
    };
  }, [query, platform, guildId, cancelAllInFlight, executeLiveSearch]);

  function handleClear() {
    cancelAllInFlight();
    onQueryChange('');
    setSubmittedQuery('');
    setResults([]);
    setProviders([]);
    setPartial(false);
    setSuggestions([]);
    setErrorMessage('');
    setSearchStatus('idle');
    setPanelDismissed(false);
    inputRef.current?.focus();
  }

  function handlePlatformSelect(nextPlatform: MusicSearchPlatform) {
    setPlatform(nextPlatform);
    const trimmed = query.trim();
    if (trimmed && !isDirectUrl(trimmed)) {
      void executeLiveSearch(trimmed, nextPlatform);
    }
  }

  function handlePlatformKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = SEARCH_PLATFORMS.length;
    let nextIndex = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % count;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + count) % count;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = count - 1;
    }
    if (nextIndex >= 0) {
      event.preventDefault();
      const target = SEARCH_PLATFORMS[nextIndex]!;
      radioRefs.current[nextIndex]?.focus();
      handlePlatformSelect(target.id);
    }
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      if (
        event.nativeEvent.isComposing ||
        (event.nativeEvent as unknown as { keyCode?: number }).keyCode === 229
      ) {
        event.preventDefault();
        return;
      }
      const trimmed = query.trim();
      if (trimmed && !isDirectUrl(trimmed)) {
        event.preventDefault();
        void executeLiveSearch(trimmed, platform);
      }
    } else if (event.key === 'Escape') {
      if (!panelDismissed && searchStatus !== 'idle') {
        event.preventDefault();
        setPanelDismissed(true);
      } else if (query) {
        event.preventDefault();
        handleClear();
      }
    }
  }

  function handleFormSubmit(event: FormEvent) {
    const trimmed = query.trim();
    if (trimmed && !isDirectUrl(trimmed)) {
      event.preventDefault();
      void executeLiveSearch(trimmed, platform);
      return;
    }
    void onAddToQueue(event);
  }

  const trimmedQuery = query.trim();
  const linkMode = isDirectUrl(trimmedQuery);
  const showPanel =
    !panelDismissed && !linkMode && (searchStatus !== 'idle' || trimmedQuery.length >= 2);
  const canControlVoice = state ? (state.permissions?.canControl ?? true) : false;
  const playbackReady = Boolean(state) && canControlVoice;
  const failedProviders = providers.filter((p) => !p.ok);
  const enqueue = onEnqueueTrack ?? ((track: Track) => trackActions.onPlay(track));

  return (
    <>
      <form className="search-bar" onSubmit={handleFormSubmit}>
        <Search size={20} />
        <label className="sr-only" htmlFor="music-search">
          Buscar canción o pegar enlace
        </label>
        <input
          ref={inputRef}
          id="music-search"
          value={query}
          onFocus={() => setPanelDismissed(false)}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="¿Qué escuchamos? Escribe una canción o artista para ver resultados con portada, o pega un enlace…"
          maxLength={500}
          autoComplete="off"
        />
        {query.length > 0 && (
          <IconButton
            label="Limpiar búsqueda"
            className="music-search-clear"
            onClick={handleClear}
          >
            <X size={16} />
          </IconButton>
        )}
        <span className="search-hint">YouTube Music · YouTube · SoundCloud</span>
        <Button
          type="submit"
          aria-label="Agregar a la cola"
          disabled={!trimmedQuery || (linkMode ? controlsDisabled : searchStatus === 'loading')}
          size="sm"
        >
          {busy === 'play' || searchStatus === 'loading' ? (
            <LoaderCircle size={16} className="spin" />
          ) : linkMode ? (
            <Plus size={17} />
          ) : (
            <Search size={16} />
          )}
          <span>{linkMode ? 'Agregar' : 'Buscar'}</span>
        </Button>

        {showPanel && (
          <div
            className="unified-search-panel"
            role="region"
            aria-label="Resultados de búsqueda musical"
          >
            <div className="unified-search-toolbar">
              <div
                className="music-search-platforms"
                role="radiogroup"
                aria-label="Plataforma de búsqueda"
              >
                {SEARCH_PLATFORMS.map((item, idx) => {
                  const selected = platform === item.id;
                  return (
                    <button
                      key={item.id}
                      ref={(el) => {
                        radioRefs.current[idx] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      className={cn(
                        'music-platform-pill',
                        `platform-${item.id}`,
                        selected && 'is-active',
                      )}
                      onClick={() => handlePlatformSelect(item.id)}
                      onKeyDown={(event) => handlePlatformKeyDown(event, idx)}
                    >
                      <span className="music-platform-dot" aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="unified-search-toolbar-right">
                {searchStatus === 'results' && (
                  <span className="unified-search-count">
                    {results.length} {results.length === 1 ? 'resultado' : 'resultados'}
                  </span>
                )}
                <IconButton
                  label="Cerrar resultados"
                  onClick={() => setPanelDismissed(true)}
                >
                  <X size={15} />
                </IconButton>
              </div>
            </div>

            {suggestions.length > 0 && (
              <div className="unified-search-suggestions" aria-label="Sugerencias rápidas">
                <span className="music-search-suggestions-label">
                  <Sparkles size={12} /> Sugerencias:
                </span>
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="music-suggestion-chip"
                    onClick={() => {
                      onQueryChange(suggestion);
                      void executeLiveSearch(suggestion, platform);
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {state && !canControlVoice && (
              <div className="music-search-banner is-info" role="status">
                <Volume2 size={15} />
                <span>
                  Únete al canal de voz en Discord para reproducir o encolar. Puedes guardar en
                  favoritos o playlists ahora mismo.
                </span>
              </div>
            )}

            {partial && failedProviders.length > 0 && searchStatus === 'results' && (
              <div className="music-search-banner is-partial" role="status">
                <AlertTriangle size={15} />
                <span>
                  Resultados parciales: no respondió{' '}
                  <strong>
                    {failedProviders.map((p) => PLATFORM_LABELS[p.platform]).join(', ')}
                  </strong>
                  .
                </span>
              </div>
            )}

            {searchStatus === 'loading' && (
              <div className="music-search-loading is-compact" role="status" aria-live="polite">
                <div className="music-search-loading-head">
                  <LoaderCircle size={18} className="spin" />
                  <div>
                    <strong>
                      Buscando «{submittedQuery || trimmedQuery}» en{' '}
                      {SEARCH_PLATFORMS.find((p) => p.id === platform)?.label ?? 'Todas'}…
                    </strong>
                    <span>Obteniendo canciones y portadas en tiempo real.</span>
                  </div>
                </div>
                <div className="music-search-skeleton-list" aria-hidden="true">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="music-search-skeleton-row">
                      <div className="skeleton-box skeleton-art" />
                      <div className="skeleton-lines">
                        <div className="skeleton-box skeleton-title" />
                        <div className="skeleton-box skeleton-sub" />
                      </div>
                      <div className="skeleton-box skeleton-pill" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {searchStatus === 'error' && (
              <div className="music-search-error" role="alert">
                <AlertTriangle size={18} />
                <div className="music-search-error-copy">
                  <strong>No pudimos completar la búsqueda</strong>
                  <p>{errorMessage}</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void executeLiveSearch(trimmedQuery, platform)}
                >
                  Reintentar
                </Button>
              </div>
            )}

            {searchStatus === 'empty' && (
              <div className="music-search-empty is-compact" role="status">
                <Disc3 size={26} strokeWidth={1.3} />
                <h3>Sin resultados para «{submittedQuery}»</h3>
                <p>Prueba con otro término o busca en todas las plataformas.</p>
                {platform !== 'all' && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handlePlatformSelect('all')}
                  >
                    Buscar en todas las plataformas
                  </Button>
                )}
              </div>
            )}

            {searchStatus === 'results' && (
              <div
                className="music-search-results-list unified-results-scroll"
                role="list"
                aria-label="Canciones encontradas"
              >
                {results.map((item, index) => {
                  const track = toDashboardTrack(item);
                  const fav = trackActions.isFavorite(track);
                  const playDisabled = Boolean(busy) || !playbackReady;
                  return (
                    <div
                      key={item.id}
                      role="listitem"
                      className={cn('search-result-row', index >= 25 && 'track-row-deferred')}
                    >
                      <Artwork track={track} className="search-result-art" decorative />

                      <div className="search-result-meta">
                        <strong className="search-result-title" title={item.title}>
                          {item.title}
                        </strong>
                        <span className="search-result-artist">
                          {formatArtistAndChannel(item.artist, item.channel)}
                        </span>
                      </div>

                      <span
                        className={cn('search-platform-badge', `is-${item.platform}`)}
                        aria-label={`Plataforma: ${PLATFORM_LABELS[item.platform]}`}
                      >
                        {PLATFORM_LABELS[item.platform]}
                      </span>

                      <span
                        className="search-result-duration"
                        aria-label={
                          item.duration > 0
                            ? `Duración: ${duration(item.duration)}`
                            : 'Duración no disponible'
                        }
                      >
                        {item.duration > 0 ? duration(item.duration) : '—'}
                      </span>

                      <div className="search-result-actions">
                        <Button
                          type="button"
                          size="sm"
                          className="search-action-play"
                          aria-label={`Reproducir ${item.title}`}
                          disabled={playDisabled}
                          onClick={() => void trackActions.onPlay(track)}
                        >
                          <Play size={14} fill="currentColor" />
                          <span>Reproducir</span>
                        </Button>

                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="search-action-queue"
                          aria-label={`Añadir a la cola: ${item.title}`}
                          disabled={playDisabled}
                          onClick={() => void enqueue(track)}
                        >
                          <ListEnd size={15} />
                          <span>A la cola</span>
                        </Button>

                        <IconButton
                          label={`${fav ? 'Quitar de' : 'Guardar en'} favoritos: ${item.title}`}
                          active={fav}
                          aria-pressed={fav}
                          disabled={Boolean(busy)}
                          onClick={() => void trackActions.onToggleFavorite(track)}
                        >
                          <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
                        </IconButton>

                        <IconButton
                          label={`Guardar ${item.title} en playlist`}
                          disabled={Boolean(busy)}
                          onClick={() => trackActions.onSave(track)}
                        >
                          <Plus size={17} />
                        </IconButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
