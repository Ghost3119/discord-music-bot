import * as React from 'react';
import {
  AlertTriangle,
  Compass,
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
import { Artwork } from '../../components/artwork';
import { IconButton } from '../../components/common/IconButton';
import type { TrackActions } from '../../components/queue/TrackList';
import { Button } from '../../components/ui/button';
import {
  api,
  type MusicSearchPlatform,
  type MusicSearchProviderId,
  type MusicSearchProviderStatus,
  type MusicSearchResponse,
  type MusicSearchSuggestionsResponse,
  type MusicSearchTrack,
  type PlaybackSnapshot,
  type Session,
  type Track,
} from '../../lib/api';
import { cn, duration } from '../../lib/utils';

export const SEARCH_PLATFORMS: ReadonlyArray<{
  id: MusicSearchPlatform;
  label: string;
  shortLabel: string;
}> = [
  { id: 'all', label: 'Todas', shortLabel: 'Todas' },
  { id: 'youtube_music', label: 'YouTube Music', shortLabel: 'YT Music' },
  { id: 'youtube', label: 'YouTube', shortLabel: 'YouTube' },
  { id: 'soundcloud', label: 'SoundCloud', shortLabel: 'SoundCloud' },
];

export const PLATFORM_LABELS: Record<MusicSearchProviderId, string> = {
  youtube_music: 'YouTube Music',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
};

const QUICK_SUGGESTIONS = [
  'Feid Luna',
  'Bad Bunny Monaco',
  'Daft Punk Veridis Quo',
  'The Weeknd Blinding Lights',
] as const;

export function toDashboardTrack(item: MusicSearchTrack): Track {
  return {
    id: item.id,
    url: item.url,
    title: item.title,
    artist: item.artist || 'Artista desconocido',
    duration: item.duration,
    thumbnail: item.thumbnail,
    source: item.source,
  };
}

export function formatArtistAndChannel(artist: string, channel: string | null | undefined): string {
  const cleanArtist = (artist || '').trim() || 'Artista desconocido';
  const cleanChannel = (channel || '').replace(/\s*-\s*Topic$/i, '').trim();
  if (!cleanChannel || cleanChannel.toLowerCase() === cleanArtist.toLowerCase()) {
    return cleanArtist;
  }
  return `${cleanArtist} · ${cleanChannel}`;
}

function hasReactDispatcher(): boolean {
  const internals = (
    React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H: unknown };
    }
  ).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  return Boolean(internals && internals.H);
}

export interface SearchViewProps {
  guildId: string;
  session: Session | null;
  state: PlaybackSnapshot | null;
  busy: string;
  trackActions: TrackActions;
  onEnqueueTrack: (track: Track) => void | Promise<void>;
  initialQuery?: string;
  onInitialQueryConsumed?: () => void;
}

type SearchStatus = 'idle' | 'loading' | 'results' | 'empty' | 'error';

export function SearchView({
  guildId,
  session,
  state,
  busy,
  trackActions,
  onEnqueueTrack,
  initialQuery,
  onInitialQueryConsumed,
}: SearchViewProps) {
  if (!hasReactDispatcher()) {
    return (
      <section className="search-view" aria-labelledby="music-search-heading">
        <div className="music-search-stage">
          <div className="music-search-header">
            <h2 id="music-search-heading">Buscar música</h2>
            <p className="music-search-subtitle">Encuentra tu próxima canción.</p>
          </div>
        </div>
      </section>
    );
  }

  const [query, setQuery] = React.useState(initialQuery ?? '');
  const [submittedQuery, setSubmittedQuery] = React.useState('');
  const [platform, setPlatform] = React.useState<MusicSearchPlatform>('all');
  const [status, setStatus] = React.useState<SearchStatus>('idle');
  const [results, setResults] = React.useState<MusicSearchTrack[]>([]);
  const [providers, setProviders] = React.useState<MusicSearchProviderStatus[]>([]);
  const [partial, setPartial] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = React.useState(-1);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const radioRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const activeControllerRef = React.useRef<AbortController | null>(null);
  const suggestControllerRef = React.useRef<AbortController | null>(null);
  const requestIdRef = React.useRef(0);
  const debounceTimerRef = React.useRef<number | null>(null);
  const suggestTimerRef = React.useRef<number | null>(null);
  const prevGuildIdRef = React.useRef(guildId);

  const cancelSuggestions = React.useCallback(() => {
    if (suggestTimerRef.current !== null) {
      window.clearTimeout(suggestTimerRef.current);
      suggestTimerRef.current = null;
    }
    if (suggestControllerRef.current) {
      suggestControllerRef.current.abort();
      suggestControllerRef.current = null;
    }
  }, []);

  const cancelInFlight = React.useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    cancelSuggestions();
    requestIdRef.current += 1;
    if (activeControllerRef.current) {
      activeControllerRef.current.abort();
      activeControllerRef.current = null;
    }
  }, [cancelSuggestions]);

  React.useEffect(() => {
    if (prevGuildIdRef.current !== guildId) {
      prevGuildIdRef.current = guildId;
      cancelInFlight();
      setStatus('idle');
      setResults([]);
      setProviders([]);
      setPartial(false);
      setErrorMessage('');
      setSubmittedQuery('');
    }
  }, [guildId, cancelInFlight]);

  React.useEffect(() => {
    return () => {
      cancelInFlight();
    };
  }, [cancelInFlight]);

  const executeSearch = React.useCallback(
    async (rawText: string, targetPlatform: MusicSearchPlatform) => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      cancelSuggestions();
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);

      const trimmed = rawText.trim();
      if (!trimmed) {
        cancelInFlight();
        setErrorMessage('Introduce una canción o artista para buscar.');
        setStatus('error');
        setResults([]);
        return;
      }
      if (!session || !guildId) {
        cancelInFlight();
        setErrorMessage('Inicia sesión y selecciona un servidor para buscar música.');
        setStatus('error');
        return;
      }

      activeControllerRef.current?.abort();
      const controller = new AbortController();
      activeControllerRef.current = controller;
      const currentRequestId = ++requestIdRef.current;
      const originGuild = guildId;

      setSubmittedQuery(trimmed);
      setStatus('loading');
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
        setStatus(nextResults.length > 0 ? 'results' : 'empty');
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
        setStatus('error');
      } finally {
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
      }
    },
    [guildId, session, cancelInFlight],
  );

  React.useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      const next = initialQuery.trim();
      setQuery(next);
      onInitialQueryConsumed?.();
      void executeSearch(next, platform);
    }
  }, [initialQuery, platform, executeSearch, onInitialQueryConsumed]);

  function handleQueryChange(nextValue: string) {
    setQuery(nextValue);
    setActiveSuggestionIndex(-1);
    if (errorMessage) setErrorMessage('');
    const trimmed = nextValue.trim();
    if (!trimmed) {
      cancelInFlight();
      setSuggestions([]);
      setShowSuggestions(false);
      setStatus('idle');
      setResults([]);
      setProviders([]);
      setPartial(false);
      setSubmittedQuery('');
      return;
    }

    cancelSuggestions();
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (trimmed.length >= 2 && session && guildId) {
      const originGuild = guildId;
      suggestTimerRef.current = window.setTimeout(async () => {
        suggestTimerRef.current = null;
        const controller = new AbortController();
        suggestControllerRef.current = controller;
        try {
          const data = await api<MusicSearchSuggestionsResponse>(
            `/api/guilds/${originGuild}/search/suggestions?q=${encodeURIComponent(trimmed)}`,
            { method: 'GET', signal: controller.signal },
          );
          if (!controller.signal.aborted && Array.isArray(data?.suggestions)) {
            setSuggestions(data.suggestions);
            setShowSuggestions(data.suggestions.length > 0);
          }
        } catch {
          // Suggestions are optional progressive enhancement
        }
      }, 180);

      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        void executeSearch(trimmed, platform);
      }, 550);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }

  function handleClear() {
    cancelInFlight();
    setQuery('');
    setSubmittedQuery('');
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestionIndex(-1);
    setResults([]);
    setProviders([]);
    setPartial(false);
    setErrorMessage('');
    setStatus('idle');
    inputRef.current?.focus();
  }

  function handlePlatformSelect(nextPlatform: MusicSearchPlatform) {
    setPlatform(nextPlatform);
    if (query.trim()) {
      void executeSearch(query, nextPlatform);
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
    if (showSuggestions && suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveSuggestionIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveSuggestionIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        return;
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (
        event.nativeEvent.isComposing ||
        (event.nativeEvent as unknown as { keyCode?: number }).keyCode === 229
      ) {
        return;
      }
      const chosen =
        showSuggestions && activeSuggestionIndex >= 0 && suggestions[activeSuggestionIndex]
          ? suggestions[activeSuggestionIndex]!
          : query;
      if (chosen !== query) setQuery(chosen);
      void executeSearch(chosen, platform);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (showSuggestions) {
        setShowSuggestions(false);
        setActiveSuggestionIndex(-1);
      } else if (query) {
        handleClear();
      }
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void executeSearch(query, platform);
  }

  const canControlVoice = state ? (state.permissions?.canControl ?? true) : false;
  const playbackReady = Boolean(state) && canControlVoice;
  const failedProviders = providers.filter((p) => !p.ok);

  return (
    <section className="search-view" aria-labelledby="music-search-heading">
      <div className="music-search-stage">
        <div className="music-search-header">
          <div>
            <span className="eyebrow">CATÁLOGO MULTIPROVEEDOR</span>
            <h2 id="music-search-heading">Buscar música</h2>
            <p className="music-search-subtitle">Encuentra tu próxima canción.</p>
          </div>
          <div className="music-search-providers-tag" aria-hidden="true">
            <span>YouTube Music</span>
            <span className="tiny-dot" />
            <span>YouTube</span>
            <span className="tiny-dot" />
            <span>SoundCloud</span>
          </div>
        </div>

        <form
          className="music-search-form"
          role="search"
          aria-label="Buscar música en SONORA"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="music-search-box-wrap">
            <div className={cn('music-search-input-shell', status === 'loading' && 'is-loading')}>
              <Search size={20} className="music-search-icon" aria-hidden="true" />
              <label className="sr-only" htmlFor="integrated-music-search">
                Buscar canción, artista o versión
              </label>
              <input
                ref={inputRef}
                id="integrated-music-search"
                type="search"
                value={query}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                onBlur={() => {
                  window.setTimeout(() => setShowSuggestions(false), 150);
                }}
                onChange={(event) => handleQueryChange(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Canción, artista o versión (ej. José José, Feid Luna, Remix)…"
                maxLength={200}
                autoComplete="off"
                spellCheck={false}
                aria-autocomplete="list"
                aria-controls={showSuggestions ? 'music-search-suggestions-list' : undefined}
                aria-describedby="music-search-platform-hint"
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
              {status === 'loading' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Cancelar búsqueda"
                  onClick={() => {
                    cancelInFlight();
                    setStatus(results.length ? 'results' : 'idle');
                  }}
                >
                  Cancelar
                </Button>
              )}
              <Button
                type="submit"
                size="sm"
                className="music-search-submit"
                disabled={!session || !guildId || status === 'loading'}
              >
                {status === 'loading' ? (
                  <>
                    <LoaderCircle size={16} className="spin" />
                    <span>Buscando…</span>
                  </>
                ) : (
                  <>
                    <Search size={16} />
                    <span>Buscar</span>
                  </>
                )}
              </Button>
            </div>

            {showSuggestions && suggestions.length > 0 && (
              <ul
                id="music-search-suggestions-list"
                className="music-search-autocomplete"
                role="listbox"
                aria-label="Sugerencias de búsqueda"
              >
                {suggestions.map((item, idx) => (
                  <li key={item} role="option" aria-selected={idx === activeSuggestionIndex}>
                    <button
                      type="button"
                      className={cn(
                        'music-autocomplete-item',
                        idx === activeSuggestionIndex && 'is-active',
                      )}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setQuery(item);
                        setShowSuggestions(false);
                        void executeSearch(item, platform);
                      }}
                    >
                      <Search size={14} />
                      <span>{item}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="music-search-Controls">
            <div
              className="music-search-platforms"
              role="radiogroup"
              aria-label="Plataforma de búsqueda"
              id="music-search-platform-hint"
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
          </div>
        </form>
      </div>

      {!session && (
        <div className="music-search-banner is-warning" role="status">
          <AlertTriangle size={16} />
          <span>Inicia sesión con tu cuenta de Discord para buscar y reproducir música.</span>
        </div>
      )}

      {session && state && !canControlVoice && (
        <div className="music-search-banner is-info" role="status">
          <Volume2 size={16} />
          <span>
            Únete al canal de voz de SONORA en Discord para reproducir o añadir a la cola. Puedes
            guardar canciones en favoritos o en tus playlists ahora mismo.
          </span>
        </div>
      )}

      {busy && (
        <div className="music-search-banner is-busy" role="status" aria-live="polite">
          <LoaderCircle size={16} className="spin" />
          <span>
            {busy === 'play'
              ? 'Enviando canción al reproductor de Discord…'
              : busy === 'favorite'
                ? 'Actualizando tus favoritos…'
                : 'Procesando operación en tu biblioteca…'}
          </span>
        </div>
      )}

      {status === 'loading' && (
        <div className="music-search-loading" role="status" aria-live="polite">
          <div className="music-search-loading-head">
            <LoaderCircle size={20} className="spin" />
            <div>
              <strong>
                Buscando «{submittedQuery}» en{' '}
                {SEARCH_PLATFORMS.find((p) => p.id === platform)?.label ?? 'Todas'}…
              </strong>
              <span>Consultando metadatos y carátulas sin descargar flujos de audio.</span>
            </div>
          </div>
          <div className="music-search-skeleton-list" aria-hidden="true">
            {[0, 1, 2, 3].map((item) => (
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

      {status === 'error' && (
        <div className="music-search-error" role="alert">
          <AlertTriangle size={22} />
          <div className="music-search-error-copy">
            <strong>No pudimos completar la búsqueda</strong>
            <p>{errorMessage}</p>
          </div>
          {query.trim() && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void executeSearch(query, platform)}
            >
              Reintentar búsqueda
            </Button>
          )}
        </div>
      )}

      {status === 'empty' && (
        <div className="music-search-empty" role="status">
          <Disc3 size={34} strokeWidth={1.3} />
          <h3>Sin resultados para «{submittedQuery}»</h3>
          <p>
            Prueba con el nombre del artista y la canción, revisa la ortografía o cambia la
            plataforma a <strong>Todas</strong>.
          </p>
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

      {status === 'idle' && (
        <div className="music-search-discovery">
          <div className="music-search-discovery-card">
            <div className="music-search-discovery-icon">
              <Compass size={26} strokeWidth={1.5} />
            </div>
            <div className="music-search-discovery-copy">
              <h3>Explora sin copiar enlaces</h3>
              <p>
                Busca temas oficiales en YouTube Music, sesiones o videoclips en YouTube y lanzamientos
                independientes en SoundCloud. Reproduce al instante o guarda en tu biblioteca.
              </p>
              <div className="music-search-suggestions" aria-label="Búsquedas sugeridas">
                <span className="music-search-suggestions-label">
                  <Sparkles size={13} /> Prueba buscar:
                </span>
                {QUICK_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="music-suggestion-chip"
                    onClick={() => {
                      setQuery(suggestion);
                      void executeSearch(suggestion, platform);
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {status === 'results' && (
        <div className="music-search-results-section">
          {partial && failedProviders.length > 0 && (
            <div className="music-search-banner is-partial" role="status">
              <AlertTriangle size={16} />
              <span>
                Resultados parciales: no se pudo consultar{' '}
                <strong>
                  {failedProviders.map((p) => PLATFORM_LABELS[p.platform]).join(', ')}
                </strong>
                . Mostrando coincidencias de las demás plataformas.
              </span>
            </div>
          )}

          <div className="music-search-results-header">
            <div>
              <h3>
                Resultados para «{submittedQuery}»{' '}
                <span className="count-badge">{results.length}</span>
              </h3>
              <p>
                Selecciona una canción para escucharla en Discord, añadirla a la cola o guardarla en
                tu colección.
              </p>
            </div>
            <span className="music-search-active-filter">
              <Radio size={13} />
              {SEARCH_PLATFORMS.find((p) => p.id === platform)?.label ?? 'Todas'}
            </span>
          </div>

          <div className="music-search-results-list" role="list" aria-label="Resultados de búsqueda">
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
                      onClick={() => void onEnqueueTrack(track)}
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
        </div>
      )}
    </section>
  );
}
