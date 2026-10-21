// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerView } from '../src/features/dashboard/PlayerView';
import { SearchView } from '../src/features/search/SearchView';
import type { TrackActions } from '../src/components/queue/TrackList';
import type {
  MusicSearchResponse,
  MusicSearchTrack,
  PlaybackSnapshot,
  Session,
} from '../src/lib/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSession: Session = {
  user: { id: '111111111111111111', username: 'Cami', avatar: null },
  csrfToken: 'a'.repeat(64),
};

function makeState(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    guildId: 'guild-a',
    status: 'playing',
    current: null,
    queue: [],
    currentTime: 0,
    volume: 80,
    repeat: 0,
    voice: { id: 'voice-1', name: 'Sala Musical', members: 3 },
    health: {},
    incidents: [],
    permissions: {
      role: 'voice',
      isMember: true,
      inVoiceChannel: true,
      canControl: true,
      isAdmin: false,
      canRead: true,
      canManageLibrary: true,
      canViewDiagnostics: false,
      canManageConfig: false,
    },
    ...overrides,
  };
}

function makeActions(overrides: Partial<TrackActions> = {}): TrackActions {
  return {
    busy: false,
    playbackReady: true,
    isFavorite: () => false,
    onPlay: vi.fn(),
    onToggleFavorite: vi.fn(),
    onSave: vi.fn(),
    onMove: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
}

const sampleResults: MusicSearchTrack[] = [
  {
    id: 'youtube_music:aqs0aXBBC8g',
    url: 'https://www.youtube.com/watch?v=aqs0aXBBC8g',
    title: 'LUNA',
    artist: 'Feid',
    channel: 'Feid - Topic',
    duration: 0,
    thumbnail: 'https://i.ytimg.com/vi/aqs0aXBBC8g/hqdefault.jpg',
    source: 'youtube',
    sourceId: 'aqs0aXBBC8g',
    platform: 'youtube_music',
  },
  {
    id: 'youtube:x2oUajHp8pg',
    url: 'https://www.youtube.com/watch?v=x2oUajHp8pg',
    title: 'Feid, ATL Jacob - LUNA (Official Acoustic Live Remix)',
    artist: 'Feid',
    channel: 'FeidVEVO',
    duration: 200,
    thumbnail: 'https://i.ytimg.com/vi/x2oUajHp8pg/hqdefault.jpg',
    source: 'youtube',
    sourceId: 'x2oUajHp8pg',
    platform: 'youtube',
  },
  {
    id: 'soundcloud:1683090669',
    url: 'https://soundcloud.com/feid_oficial/luna',
    title: 'LUNA (Club Edit)',
    artist: 'Feid, ATL Jacob',
    channel: 'FEID',
    duration: 197,
    thumbnail: null,
    source: 'soundcloud',
    sourceId: '1683090669',
    platform: 'soundcloud',
  },
];

describe('SONORA Music Search 1.0 (SearchView)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('renders initial heading, subtitle, platform selector, and discovery suggestions', async () => {
    await act(async () => {
      root.render(
        createElement(SearchView, {
          guildId: 'guild-a',
          session: mockSession,
          state: makeState(),
          busy: '',
          trackActions: makeActions(),
          onEnqueueTrack: vi.fn(),
        }),
      );
    });

    expect(container.querySelector('#music-search-heading')?.textContent).toBe('Buscar música');
    expect(container.querySelector('.music-search-subtitle')?.textContent).toBe(
      'Encuentra tu próxima canción.',
    );

    const radios = [...container.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.textContent?.trim())).toEqual([
      'Todas',
      'YouTube Music',
      'YouTube',
      'SoundCloud',
    ]);
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('.music-search-discovery')).not.toBeNull();
  });

  it('submits search on Enter (ignoring IME composition), renders multi-platform results, artwork fallbacks, and wires all 4 actions', async () => {
    const fetchMock = vi.fn(async () => {
      const payload: MusicSearchResponse = {
        query: 'Feid Luna',
        platform: 'all',
        results: sampleResults,
        providers: [
          { platform: 'youtube_music', ok: true, count: 1 },
          { platform: 'youtube', ok: true, count: 1 },
          { platform: 'soundcloud', ok: true, count: 1 },
        ],
        partial: false,
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const actions = makeActions({
      isFavorite: (t) => t.url === sampleResults[0]!.url,
    });
    const onEnqueueTrack = vi.fn();

    await act(async () => {
      root.render(
        createElement(SearchView, {
          guildId: 'guild-a',
          session: mockSession,
          state: makeState(),
          busy: '',
          trackActions: actions,
          onEnqueueTrack,
        }),
      );
    });

    const input = container.querySelector('#integrated-music-search') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'Feid Luna');
    });

    // IME composing Enter must NOT trigger search
    await act(async () => {
      const imeEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(imeEvent, 'isComposing', { value: true });
      input.dispatchEvent(imeEvent);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Normal Enter submits search
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/guilds/guild-a/search?q=Feid+Luna&platform=all',
    );

    const rows = [...container.querySelectorAll('.search-result-row')];
    expect(rows.length).toBe(3);

    // Row 0: YouTube Music (duration 0 -> '—', channel 'Feid - Topic' collapsed to 'Feid')
    expect(rows[0]?.querySelector('.search-result-title')?.textContent).toBe('LUNA');
    expect(rows[0]?.querySelector('.search-result-artist')?.textContent).toBe('Feid');
    expect(rows[0]?.querySelector('.search-platform-badge')?.textContent).toBe('YouTube Music');
    expect(rows[0]?.querySelector('.search-result-duration')?.textContent).toBe('—');

    // Row 1: YouTube (distinct channel 'FeidVEVO' shown as 'Feid · FeidVEVO', duration 3:20)
    expect(rows[1]?.querySelector('.search-result-artist')?.textContent).toBe('Feid · FeidVEVO');
    expect(rows[1]?.querySelector('.search-platform-badge')?.textContent).toBe('YouTube');
    expect(rows[1]?.querySelector('.search-result-duration')?.textContent).toBe('3:20');

    // Row 2: SoundCloud (null thumbnail renders Artwork fallback, badge 'SoundCloud')
    expect(rows[2]?.querySelector('.search-platform-badge')?.textContent).toBe('SoundCloud');
    expect(rows[2]?.querySelector('.artwork-fallback')).not.toBeNull();

    // Test all 4 actions on Row 1
    const playBtn = container.querySelector(
      '[aria-label="Reproducir Feid, ATL Jacob - LUNA (Official Acoustic Live Remix)"]',
    ) as HTMLButtonElement;
    const queueBtn = container.querySelector(
      '[aria-label="Añadir a la cola: Feid, ATL Jacob - LUNA (Official Acoustic Live Remix)"]',
    ) as HTMLButtonElement;
    const favBtn = container.querySelector(
      '[aria-label="Guardar en favoritos: Feid, ATL Jacob - LUNA (Official Acoustic Live Remix)"]',
    ) as HTMLButtonElement;
    const saveBtn = container.querySelector(
      '[aria-label="Guardar Feid, ATL Jacob - LUNA (Official Acoustic Live Remix) en playlist"]',
    ) as HTMLButtonElement;

    await act(async () => {
      playBtn.click();
      queueBtn.click();
      favBtn.click();
      saveBtn.click();
    });

    expect(actions.onPlay).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://www.youtube.com/watch?v=x2oUajHp8pg',
        source: 'youtube',
      }),
    );
    expect(onEnqueueTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://www.youtube.com/watch?v=x2oUajHp8pg',
        source: 'youtube',
      }),
    );
    expect(actions.onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(actions.onSave).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard navigation across platform pills, cancels stale searches, and handles empty/error/partial states', async () => {
    let resolveFirst: ((res: Response) => void) | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('platform=all')) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      if (url.includes('platform=youtube_music')) {
        const partialPayload: MusicSearchResponse = {
          query: 'Feid',
          platform: 'youtube_music',
          results: [sampleResults[0]!],
          providers: [
            { platform: 'youtube_music', ok: true, count: 1 },
            { platform: 'soundcloud', ok: false, count: 0, error: 'Timeout' },
          ],
          partial: true,
        };
        return Promise.resolve(
          new Response(JSON.stringify(partialPayload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (url.includes('platform=youtube')) {
        const emptyPayload: MusicSearchResponse = {
          query: 'Feid',
          platform: 'youtube',
          results: [],
          providers: [{ platform: 'youtube', ok: true, count: 0 }],
          partial: false,
        };
        return Promise.resolve(
          new Response(JSON.stringify(emptyPayload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'Proveedor no disponible' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(
        createElement(SearchView, {
          guildId: 'guild-a',
          session: mockSession,
          state: makeState(),
          busy: '',
          trackActions: makeActions(),
          onEnqueueTrack: vi.fn(),
        }),
      );
    });

    // Start first search on 'all' (stays loading)
    const suggestionChip = container.querySelector('.music-suggestion-chip') as HTMLButtonElement;
    await act(async () => {
      suggestionChip.click();
    });
    expect(container.querySelector('.music-search-loading')).not.toBeNull();

    // Use keyboard ArrowRight on 'Todas' pill to switch to 'YouTube Music'
    const firstRadio = container.querySelector('[role="radio"]') as HTMLButtonElement;
    await act(async () => {
      firstRadio.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });

    // Resolve stale 'all' response AFTER 'youtube_music' finished -> must be ignored!
    await act(async () => {
      resolveFirst?.(
        new Response(
          JSON.stringify({
            query: 'Stale',
            platform: 'all',
            results: [sampleResults[2]!],
            providers: [],
            partial: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });

    expect(container.querySelector('.music-search-banner.is-partial')?.textContent).toContain(
      'SoundCloud',
    );
    expect(container.querySelectorAll('.search-result-row').length).toBe(1);
    expect(container.querySelector('.search-result-title')?.textContent).toBe('LUNA');

    // Switch to 'YouTube' -> Empty state (non-error)
    const radios = [...container.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    await act(async () => {
      radios[2]!.click();
    });
    expect(container.querySelector('.music-search-empty')).not.toBeNull();
    expect(container.querySelector('.music-search-error')).toBeNull();

    // Switch to 'SoundCloud' -> Error state
    await act(async () => {
      radios[3]!.click();
    });
    expect(container.querySelector('.music-search-error')?.textContent).toContain(
      'Proveedor no disponible',
    );
  });

  it('clears results on server switch, disables playback when user lacks voice permissions, and defers rows >= 25', async () => {
    const manyResults: MusicSearchTrack[] = Array.from({ length: 30 }, (_, i) => ({
      ...sampleResults[1]!,
      id: `youtube:vid_${i}`,
      sourceId: `vid_${String(i).padStart(7, '0')}`,
      title: `Track ${i + 1}`,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            query: 'Many',
            platform: 'all',
            results: manyResults,
            providers: [{ platform: 'youtube', ok: true, count: 30 }],
            partial: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const noVoiceState = makeState({
      voice: null,
      permissions: {
        role: 'member',
        isMember: true,
        inVoiceChannel: false,
        canControl: false,
        isAdmin: false,
        canRead: true,
        canManageLibrary: true,
        canViewDiagnostics: false,
        canManageConfig: false,
      },
    });

    await act(async () => {
      root.render(
        createElement(SearchView, {
          guildId: 'guild-a',
          session: mockSession,
          state: noVoiceState,
          busy: '',
          trackActions: makeActions(),
          onEnqueueTrack: vi.fn(),
        }),
      );
    });

    // Shows voice permission guidance banner
    expect(container.querySelector('.music-search-banner.is-info')?.textContent).toContain(
      'Únete al canal de voz',
    );

    const chip = container.querySelector('.music-suggestion-chip') as HTMLButtonElement;
    await act(async () => {
      chip.click();
    });

    const rows = [...container.querySelectorAll('.search-result-row')];
    expect(rows.length).toBe(30);
    expect(rows[24]?.classList.contains('track-row-deferred')).toBe(false);
    expect(rows[25]?.classList.contains('track-row-deferred')).toBe(true);

    // Play & Queue buttons are disabled without voice permissions, but Favorites & Save to Playlist are enabled!
    const playBtn = rows[0]?.querySelector('.search-action-play') as HTMLButtonElement;
    const queueBtn = rows[0]?.querySelector('.search-action-queue') as HTMLButtonElement;
    const favBtn = rows[0]?.querySelector('[aria-label*="favoritos"]') as HTMLButtonElement;
    const saveBtn = rows[0]?.querySelector('[aria-label*="playlist"]') as HTMLButtonElement;
    expect(playBtn.disabled).toBe(true);
    expect(queueBtn.disabled).toBe(true);
    expect(favBtn.disabled).toBe(false);
    expect(saveBtn.disabled).toBe(false);

    // Switch guildId -> resets search view to idle discovery state
    await act(async () => {
      root.render(
        createElement(SearchView, {
          guildId: 'guild-b',
          session: mockSession,
          state: noVoiceState,
          busy: '',
          trackActions: makeActions(),
          onEnqueueTrack: vi.fn(),
        }),
      );
    });
    expect(container.querySelectorAll('.search-result-row').length).toBe(0);
    expect(container.querySelector('.music-search-discovery')).not.toBeNull();
  });

  it('unifies live search with covers, platform selector, and actions directly inside PlayerView ("Ahora suena") as the user types', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/search/suggestions')) {
        return new Response(
          JSON.stringify({
            query: 'Jose jose',
            suggestions: ['jose jose el triste', 'jose jose gavilan o paloma'],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      const payload: MusicSearchResponse = {
        query: 'Jose jose',
        platform: 'all',
        results: sampleResults,
        providers: [
          { platform: 'youtube_music', ok: true, count: 1 },
          { platform: 'youtube', ok: true, count: 1 },
          { platform: 'soundcloud', ok: true, count: 1 },
        ],
        partial: false,
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const actions = makeActions();
    const onEnqueueTrack = vi.fn();
    let currentQuery = '';

    function ControlledPlayer() {
      const [q, setQ] = (globalThis as unknown as { React?: typeof import('react') }).React
        ? [currentQuery, (next: string) => { currentQuery = next; }]
        : [currentQuery, (next: string) => { currentQuery = next; }];
      return createElement(PlayerView, {
        playback: {
          state: makeState(),
          busy: '',
          controlsDisabled: false,
          volumeDraft: null,
          setVolumeDraft: vi.fn(),
          action: vi.fn().mockResolvedValue(undefined),
          isFavorite: () => false,
          toggleFavorite: vi.fn(),
          onSaveTrack: vi.fn(),
        },
        connection: 'live',
        query: q,
        onQueryChange: setQ,
        onAddToQueue: vi.fn(),
        onDiagnostics: vi.fn(),
        onEnqueueTrack,
        trackActions: actions,
      });
    }

    await act(async () => {
      currentQuery = 'Jose jose';
      root.render(createElement(ControlledPlayer));
    });

    // Advance debounce timers (150ms for suggestions, 320ms for live search with covers)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    const panel = container.querySelector('.unified-search-panel');
    expect(panel).not.toBeNull();
    expect(panel?.querySelectorAll('.search-result-row').length).toBe(3);
    expect(panel?.querySelector('.unified-search-suggestions')?.textContent).toContain(
      'jose jose el triste',
    );

    const playBtn = panel?.querySelector(
      '[aria-label="Reproducir LUNA"]',
    ) as HTMLButtonElement;
    await act(async () => {
      playBtn.click();
    });
    expect(actions.onPlay).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://www.youtube.com/watch?v=aqs0aXBBC8g',
        title: 'LUNA',
      }),
    );
    vi.useRealTimers();
  });
});
