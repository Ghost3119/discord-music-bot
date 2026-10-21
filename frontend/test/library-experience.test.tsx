// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackActions } from '../src/components/queue/TrackList';
import { FavoritesView } from '../src/features/favorites/FavoritesView';
import { LibraryView, type LibraryViewBindings } from '../src/features/library/LibraryView';
import {
  PlaylistArtwork,
  selectPlaylistCoverTracks,
} from '../src/features/library/PlaylistArtwork';
import {
  filterAndSortPlaylists,
  normalizeLibraryText,
  summarizePlaylistDuration,
  summarizePlaylistSources,
} from '../src/features/library/library-Catalog';
import { useLibrary } from '../src/features/library/use-library';
import { api, type Playlist, type Session, type Track } from '../src/lib/api';
import { playlist as makePlaylist, session as makeSession, track as makeTrack } from './regression-fixtures';

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  api: vi.fn(),
}));

function buildTrack(index: number, overrides: Partial<Track> = {}): Track {
  return makeTrack(`track-${index}`, {
    title: `Canción ${index}`,
    artist: `Artista ${index}`,
    url: `https://www.youtube.com/watch?v=vid0000000${index}`,
    thumbnail: `https://i.ytimg.com/vi/vid0000000${index}/hqdefault.jpg`,
    duration: 180,
    source: 'youtube',
    ...overrides,
  });
}

function defaultActions(overrides: Partial<TrackActions> = {}): TrackActions {
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

function defaultLibrary(overrides: Partial<LibraryViewBindings> = {}): LibraryViewBindings {
  return {
    guildId: 'guild-a',
    playlists: [],
    libraryLoading: false,
    busy: '',
    playbackReady: true,
    onSelectPlaylist: vi.fn(),
    onCreatePlaylist: vi.fn(),
    onImportPlaylist: vi.fn(),
    onRenamePlaylist: vi.fn(),
    onDeletePlaylist: vi.fn(),
    onAddTrack: vi.fn(),
    onLoadPlaylist: vi.fn(),
    ...overrides,
  };
}

describe('SONORA Library Experience 2.0', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
  });

  async function renderNode(element: React.ReactElement) {
    await act(async () => {
      root.render(element);
    });
  }

  async function setInputValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
    await act(async () => {
      const proto =
        input instanceof HTMLSelectElement
          ? window.HTMLSelectElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  describe('PlaylistArtwork & cover selection rules', () => {
    it('renders distinct empty state for an empty playlist and fallback when tracks lack covers', async () => {
      const empty = makePlaylist({ id: 'pl-empty', name: 'Vacía', tracks: [] });
      const noCovers = makePlaylist({
        id: 'pl-nocover',
        name: 'Sin Portadas',
        tracks: [buildTrack(1, { thumbnail: null }), buildTrack(2, { thumbnail: '' })],
      });

      await renderNode(
        <div>
          <PlaylistArtwork playlist={empty} />
          <PlaylistArtwork playlist={noCovers} />
        </div>,
      );

      expect(container.querySelector('.playlist-artwork-empty')).not.toBeNull();
      expect(container.querySelector('.playlist-artwork-fallback')).not.toBeNull();
      expect(container.querySelectorAll('img')).toHaveLength(0);
    });

    it('renders single, duo, trio, and 4-cover quad mosaics based on distinct valid covers', async () => {
      const one = makePlaylist({ id: 'pl-1', tracks: [buildTrack(1)] });
      const two = makePlaylist({ id: 'pl-2', tracks: [buildTrack(1), buildTrack(2)] });
      const three = makePlaylist({
        id: 'pl-3',
        tracks: [buildTrack(1), buildTrack(2), buildTrack(3)],
      });
      const six = makePlaylist({
        id: 'pl-6',
        tracks: [
          buildTrack(1),
          buildTrack(2),
          buildTrack(3),
          buildTrack(4),
          buildTrack(5),
          buildTrack(6),
        ],
      });

      await renderNode(
        <div>
          <PlaylistArtwork playlist={one} />
          <PlaylistArtwork playlist={two} />
          <PlaylistArtwork playlist={three} />
          <PlaylistArtwork playlist={six} />
        </div>,
      );

      expect(container.querySelector('.playlist-artwork-single')?.querySelectorAll('img')).toHaveLength(1);
      expect(container.querySelector('.playlist-artwork-duo')?.querySelectorAll('img')).toHaveLength(2);
      expect(container.querySelector('.playlist-artwork-trio')?.querySelectorAll('img')).toHaveLength(3);
      expect(container.querySelector('.playlist-artwork-quad')?.querySelectorAll('img')).toHaveLength(4);
    });

    it('deduplicates repeated covers for mosaic composition without mutating playlist tracks', async () => {
      const sharedThumb = 'https://i.ytimg.com/vi/shared11111/hqdefault.jpg';
      const secondThumb = 'https://i.ytimg.com/vi/second22222/hqdefault.jpg';
      const tracks = [
        buildTrack(1, { thumbnail: sharedThumb }),
        buildTrack(2, { thumbnail: sharedThumb }),
        buildTrack(3, { thumbnail: sharedThumb }),
        buildTrack(4, { thumbnail: secondThumb }),
        buildTrack(5, { thumbnail: null }),
      ];
      const pl = makePlaylist({ id: 'pl-dup', name: 'Álbum Repetido', tracks });

      const selectedCovers = selectPlaylistCoverTracks(pl.tracks);
      expect(selectedCovers).toHaveLength(2);
      expect(pl.tracks).toHaveLength(5);

      await renderNode(<PlaylistArtwork playlist={pl} />);
      const duo = container.querySelector('.playlist-artwork-duo');
      expect(duo).not.toBeNull();
      expect(duo?.querySelectorAll('img')).toHaveLength(2);
    });

    it('replaces only the broken cell when one image fails inside a 4-cover mosaic', async () => {
      const quad = makePlaylist({
        id: 'pl-quad-err',
        tracks: [buildTrack(1), buildTrack(2), buildTrack(3), buildTrack(4)],
      });

      await renderNode(<PlaylistArtwork playlist={quad} />);
      const mosaic = container.querySelector('.playlist-artwork-quad')!;
      const imagesBefore = mosaic.querySelectorAll('img');
      expect(imagesBefore).toHaveLength(4);

      await act(async () => {
        imagesBefore[1]!.dispatchEvent(new Event('error', { bubbles: true }));
      });

      expect(mosaic.querySelectorAll('img')).toHaveLength(3);
      expect(mosaic.querySelectorAll('.artwork-fallback')).toHaveLength(1);
    });
  });

  describe('Imported playlists, honest duration & provenance', () => {
    it('renders imported YouTube Music playlists with honest partial/unknown durations and real track sources', async () => {
      const importedPlaylist = makePlaylist({
        id: 'pl-ytm',
        name: 'Importada de YouTube Music',
        tracks: [
          buildTrack(1, {
            url: 'https://music.youtube.com/watch?v=ytm00000001',
            duration: 120,
            source: 'youtube',
          }),
          buildTrack(2, {
            url: 'https://music.youtube.com/watch?v=ytm00000002',
            duration: 120,
            source: 'youtube',
          }),
          buildTrack(3, {
            url: 'https://music.youtube.com/watch?v=ytm00000003',
            duration: 0,
            source: 'youtube',
          }),
        ],
      });

      const summary = summarizePlaylistDuration(importedPlaylist.tracks);
      expect(summary.label).toBe('4:00 + 1 sin duración');
      expect(summarizePlaylistSources(importedPlaylist.tracks)).toEqual(['YouTube']);

      const allUnknown = summarizePlaylistDuration([buildTrack(1, { duration: 0 })]);
      expect(allUnknown.label).toBe('Duración pendiente');

      await renderNode(
        <LibraryView
          library={defaultLibrary({
            playlist: importedPlaylist,
            playlists: [importedPlaylist],
          })}
          trackActions={defaultActions()}
        />,
      );

      expect(container.querySelector('.playlist-detail h2')?.textContent).toBe('Importada de YouTube Music');
      expect(container.querySelector('.playlist-detail p')?.textContent).toContain(
        '3 canciones · 4:00 + 1 sin duración · YouTube',
      );
      expect(container.querySelector('.playlist-detail .playlist-artwork-trio')).not.toBeNull();
    });
  });

  describe('Grid & List view switching, localStorage persistence, search & sorting', () => {
    const samplePlaylists: Playlist[] = [
      makePlaylist({
        id: 'pl-1',
        name: 'Zafiro Nocturno',
        tracks: [
          buildTrack(1, { title: 'Canción del Sur', artist: 'Estación Polar', duration: 200 }),
        ],
      }),
      makePlaylist({
        id: 'pl-2',
        name: 'Ámbar Acústico',
        tracks: [
          buildTrack(2, { title: 'Luz de Otoño', artist: 'Dúo Boreal', duration: 180 }),
          buildTrack(3, { title: 'Brisa Eléctrica', artist: 'Dúo Boreal', duration: 210 }),
          buildTrack(4, { title: 'Horizonte', artist: 'Sintetizador', duration: 195 }),
        ],
      }),
      makePlaylist({
        id: 'pl-3',
        name: 'Crónicas de Medianoche',
        tracks: [
          buildTrack(5, { title: 'Órbita Lenta', artist: 'Nébula', duration: 240 }),
          buildTrack(6, { title: 'Pulso', artist: 'Nébula', duration: 160 }),
        ],
      }),
    ];

    it('switches between grid and list views, preserves search/sort state, and persists preference in localStorage', async () => {
      const bindings = defaultLibrary({ playlists: samplePlaylists });
      await renderNode(<LibraryView library={bindings} trackActions={defaultActions()} />);

      expect(container.querySelector('.playlist-grid')).not.toBeNull();
      expect(container.querySelector('.playlist-list')).toBeNull();

      const listBtn = container.querySelector('button[aria-label="Vista de lista"]') as HTMLButtonElement;
      await act(async () => {
        listBtn.click();
      });

      expect(container.querySelector('.playlist-grid')).toBeNull();
      expect(container.querySelector('.playlist-list')).not.toBeNull();
      expect(container.querySelectorAll('.playlist-list-row')).toHaveLength(3);
      expect(window.localStorage.getItem('sonora:library-layout')).toBe('list');

      // Unmount and remount to confirm preference restoration from localStorage
      await act(async () => {
        root.unmount();
      });
      root = createRoot(container);
      await renderNode(<LibraryView library={bindings} trackActions={defaultActions()} />);
      expect(container.querySelector('.playlist-list')).not.toBeNull();

      const gridBtn = container.querySelector('button[aria-label="Vista de cuadrícula"]') as HTMLButtonElement;
      await act(async () => {
        gridBtn.click();
      });
      expect(container.querySelector('.playlist-grid')).not.toBeNull();
      expect(window.localStorage.getItem('sonora:library-layout')).toBe('grid');
    });

    it('filters by playlist name, song title, or artist with case/accent normalization and clears search', async () => {
      expect(normalizeLibraryText('  Canción Épica  ')).toBe('cancion epica');

      const bindings = defaultLibrary({ playlists: samplePlaylists });
      await renderNode(<LibraryView library={bindings} trackActions={defaultActions()} />);

      const searchInput = container.querySelector('#library-search-input') as HTMLInputElement;
      expect(searchInput).not.toBeNull();

      // 1. Search by playlist name without accents ("cronicas")
      await setInputValue(searchInput, 'cronicas');
      expect(container.querySelectorAll('.playlist-card')).toHaveLength(1);
      expect(container.querySelector('.playlist-card h3')?.textContent).toBe('Crónicas de Medianoche');
      expect(container.querySelector('.library-toolbar-summary')?.textContent).toBe('1 de 3');

      // 2. Search by song title without accents ("cancion del sur")
      await setInputValue(searchInput, 'CANCIÓN DEL SUR');
      expect(container.querySelectorAll('.playlist-card')).toHaveLength(1);
      expect(container.querySelector('.playlist-card h3')?.textContent).toBe('Zafiro Nocturno');
      expect(container.querySelector('.playlist-card-match')?.textContent).toContain(
        'Incluye «Canción del Sur»',
      );

      // 3. Search by artist ("duo boreal")
      await setInputValue(searchInput, 'duo boreal');
      expect(container.querySelectorAll('.playlist-card')).toHaveLength(1);
      expect(container.querySelector('.playlist-card h3')?.textContent).toBe('Ámbar Acústico');
      expect(container.querySelector('.playlist-card-match')?.textContent).toContain('y 1 más');

      // 4. Empty search result state + clear button
      await setInputValue(searchInput, 'inexistente-xyz');
      expect(container.querySelectorAll('.playlist-card')).toHaveLength(0);
      expect(container.textContent).toContain('Sin coincidencias en tu biblioteca');

      const clearBtn = container.querySelector('button[aria-label="Limpiar búsqueda"]') as HTMLButtonElement;
      await act(async () => {
        clearBtn.click();
      });
      expect(container.querySelectorAll('.playlist-card')).toHaveLength(3);
    });

    it('sorts playlists by creation order, name A–Z, name Z–A, most tracks, and fewest tracks', async () => {
      expect(
        filterAndSortPlaylists(samplePlaylists, '', 'name-asc').map((e) => e.playlist.name),
      ).toEqual(['Ámbar Acústico', 'Crónicas de Medianoche', 'Zafiro Nocturno']);

      expect(
        filterAndSortPlaylists(samplePlaylists, '', 'name-desc').map((e) => e.playlist.name),
      ).toEqual(['Zafiro Nocturno', 'Crónicas de Medianoche', 'Ámbar Acústico']);

      expect(
        filterAndSortPlaylists(samplePlaylists, '', 'tracks-desc').map((e) => e.playlist.id),
      ).toEqual(['pl-2', 'pl-3', 'pl-1']);

      expect(
        filterAndSortPlaylists(samplePlaylists, '', 'tracks-asc').map((e) => e.playlist.id),
      ).toEqual(['pl-1', 'pl-3', 'pl-2']);

      const bindings = defaultLibrary({ playlists: samplePlaylists });
      await renderNode(<LibraryView library={bindings} trackActions={defaultActions()} />);

      const sortSelect = container.querySelector('#library-sort-select') as HTMLSelectElement;
      await setInputValue(sortSelect, 'name-asc');

      const titlesAsc = Array.from(container.querySelectorAll('.playlist-card h3')).map(
        (el) => el.textContent,
      );
      expect(titlesAsc).toEqual(['Ámbar Acústico', 'Crónicas de Medianoche', 'Zafiro Nocturno']);
      expect(window.localStorage.getItem('sonora:library-sort')).toBe('name-asc');
    });
  });

  describe('Playlist actions: open, play, rename, delete, add track, and favorites', () => {
    it('supports opening, playing, renaming, deleting, and adding tracks without action leakage', async () => {
      const target = makePlaylist({
        id: 'pl-actions',
        name: 'Sesión Nocturna',
        tracks: [buildTrack(1), buildTrack(2)],
      });
      const bindings = defaultLibrary({ playlists: [target] });
      await renderNode(<LibraryView library={bindings} trackActions={defaultActions()} />);

      // Play from card cover button without selecting card
      const playBtn = container.querySelector(
        'button[aria-label="Escuchar Sesión Nocturna"]',
      ) as HTMLButtonElement;
      await act(async () => {
        playBtn.click();
      });
      expect(bindings.onLoadPlaylist).toHaveBeenCalledWith(target);
      expect(bindings.onSelectPlaylist).not.toHaveBeenCalled();

      // Rename from card contextual menu without selecting card
      const menuItems = container.querySelectorAll('.playlist-card-menu button[role="menuitem"]');
      expect(menuItems).toHaveLength(3);
      await act(async () => {
        (menuItems[0] as HTMLButtonElement).click(); // Agregar canción
        (menuItems[1] as HTMLButtonElement).click(); // Renombrar
        (menuItems[2] as HTMLButtonElement).click(); // Eliminar
      });
      expect(bindings.onAddTrack).toHaveBeenCalledWith(target);
      expect(bindings.onRenamePlaylist).toHaveBeenCalledWith(target);
      expect(bindings.onDeletePlaylist).toHaveBeenCalledWith(target);
      expect(bindings.onSelectPlaylist).not.toHaveBeenCalled();

      // Open playlist by clicking the card
      const card = container.querySelector('.playlist-card') as HTMLElement;
      await act(async () => {
        card.click();
      });
      expect(bindings.onSelectPlaylist).toHaveBeenCalledWith('pl-actions');
    });

    it('integrates favorites inside playlist detail view and preserves FavoritesView', async () => {
      const favTrack = buildTrack(1, { title: 'Siempre Contigo' });
      const pl = makePlaylist({ id: 'pl-fav', name: 'Con Favoritas', tracks: [favTrack] });
      const onToggleFavorite = vi.fn();
      const actions = defaultActions({
        isFavorite: (t) => t.id === favTrack.id,
        onToggleFavorite,
      });

      await renderNode(
        <div>
          <LibraryView
            library={defaultLibrary({ playlist: pl, playlists: [pl] })}
            trackActions={actions}
          />
          <FavoritesView favorites={[favTrack]} libraryLoading={false} trackActions={actions} />
        </div>,
      );

      const unfavButtons = container.querySelectorAll(
        'button[aria-label="Quitar de favoritos: Siempre Contigo"]',
      );
      expect(unfavButtons.length).toBeGreaterThanOrEqual(2);
      await act(async () => {
        (unfavButtons[0] as HTMLButtonElement).click();
      });
      expect(onToggleFavorite).toHaveBeenCalledWith(favTrack);
    });
  });

  describe('Concurrency, server switch, late responses, and unauthorized/disabled states', () => {
    it('resets active search on guild change and disables playback actions when playbackReady is false', async () => {
      const pl = makePlaylist({ id: 'pl-g1', name: 'Colección Uno', tracks: [buildTrack(1)] });
      const bindingsA = defaultLibrary({
        guildId: 'guild-a',
        playlists: [pl],
        playbackReady: false,
      });

      await renderNode(<LibraryView library={bindingsA} trackActions={defaultActions({ playbackReady: false })} />);

      const playBtn = container.querySelector(
        'button[aria-label="Escuchar Colección Uno"]',
      ) as HTMLButtonElement;
      expect(playBtn.disabled).toBe(true);

      const searchInput = container.querySelector('#library-search-input') as HTMLInputElement;
      await setInputValue(searchInput, 'Colección');
      expect(searchInput.value).toBe('Colección');

      // Switch guildId -> search resets automatically
      const bindingsB = defaultLibrary({
        guildId: 'guild-b',
        playlists: [pl],
        playbackReady: true,
      });
      await renderNode(<LibraryView library={bindingsB} trackActions={defaultActions()} />);
      const searchInputAfter = container.querySelector('#library-search-input') as HTMLInputElement;
      expect(searchInputAfter.value).toBe('');
    });

    it('discards late responses after switching guild and does not fetch when session is null', async () => {
      const apiMock = vi.mocked(api);
      const pendingResolvers: Array<{ path: string; resolve: (val: unknown) => void }> = [];

      apiMock.mockImplementation((path: string) => {
        return new Promise((resolve) => {
          pendingResolvers.push({ path, resolve });
        });
      });

      const reportError = vi.fn();
      const mutate = vi.fn();
      const setNotice = vi.fn();
      const setView = vi.fn();
      const refresh = vi.fn();

      function Harness({ guildId, userSession }: { guildId: string; userSession: Session | null }) {
        const lib = useLibrary({
          guildId,
          session: userSession,
          reportError,
          run: async (_k, task) => task(),
          mutate,
          setNotice,
          setView,
          refresh,
        });
        const [ dummy ] = useState(0);
        void dummy;
        return (
          <div data-testid="playlist-names">
            {lib.playlists.map((item) => item.name).join(',')}
          </div>
        );
      }

      // 1. Unauthorized (session = null) -> makes 0 API calls
      await renderNode(<Harness guildId="guild-a" userSession={null} />);
      expect(apiMock).not.toHaveBeenCalled();

      // 2. Authorized in guild-a -> starts fetch for guild-a
      const activeSession = makeSession;
      await renderNode(<Harness guildId="guild-a" userSession={activeSession} />);
      expect(pendingResolvers).toHaveLength(2); // playlists + favorites for guild-a

      // 3. Switch to guild-b before guild-a resolves
      await renderNode(<Harness guildId="guild-b" userSession={activeSession} />);
      expect(pendingResolvers).toHaveLength(4);

      // Resolve guild-b first
      await act(async () => {
        pendingResolvers[2]!.resolve({
          playlists: [makePlaylist({ id: 'b1', name: 'Playlist Servidor B' })],
        });
        pendingResolvers[3]!.resolve({ favorites: [] });
      });
      expect(container.querySelector('[data-testid="playlist-names"]')?.textContent).toBe(
        'Playlist Servidor B',
      );

      // Now resolve late guild-a response -> must be ignored!
      await act(async () => {
        pendingResolvers[0]!.resolve({
          playlists: [makePlaylist({ id: 'a1', name: 'Playlist Obsoleta A' })],
        });
        pendingResolvers[1]!.resolve({ favorites: [] });
      });
      expect(container.querySelector('[data-testid="playlist-names"]')?.textContent).toBe(
        'Playlist Servidor B',
      );
    });

    it('applies deferred rendering for large libraries (60+ playlists) and includes mobile + reduced-motion CSS', async () => {
      const manyPlaylists = Array.from({ length: 60 }, (_, idx) =>
        makePlaylist({
          id: `pl-many-${idx}`,
          name: `Colección ${idx + 1}`,
          tracks: [buildTrack((idx % 5) + 1)],
        }),
      );

      await renderNode(
        <LibraryView
          library={defaultLibrary({ playlists: manyPlaylists })}
          trackActions={defaultActions()}
        />,
      );

      expect(container.querySelectorAll('.playlist-card')).toHaveLength(60);
      expect(container.querySelectorAll('.playlist-card.playlist-item-deferred').length).toBeGreaterThan(40);

      const css = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');
      expect(css).toContain('.playlist-artwork-quad');
      expect(css).toContain('content-visibility: auto');
      expect(css).toContain('@media (max-width: 600px)');
      expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    });

    it('renders the redesigned PlaylistDetails stage and loads 50, 51, 139 ("Reggaeton") and 500-track playlists with honest partial/complete notices', async () => {
      for (const size of [50, 51, 139, 500]) {
        const reggaeton = makePlaylist({
          id: `pl-reggaeton-${size}`,
          name: 'Reggaeton',
          tracks: Array.from({ length: size }, (_, idx) =>
            buildTrack(idx + 1, {
              title: `Tema Reggaeton ${idx + 1}`,
              artist: ['Blessd', 'Feid', 'Bad Bunny', 'Roa', 'Ovy On The Drums'][idx % 5]!,
              duration: 180,
            }),
          ),
        });

        await renderNode(
          <LibraryView
            library={defaultLibrary({
              playlist: reggaeton,
              playlists: [reggaeton],
              busy: size === 139 ? 'load' : '',
            })}
            trackActions={defaultActions()}
          />,
        );

        expect(container.querySelector('.playlist-detail-art-stage')).not.toBeNull();
        expect(container.querySelector('.playlist-detail h2')?.textContent).toBe('Reggaeton');
        expect(container.querySelector('.playlist-detail-artists')?.textContent).toBe(
          'Con Blessd, Feid, Bad Bunny y 2 más',
        );
        expect(container.querySelector('.playlist-tracks-badge')?.textContent).toBe(String(size));
        expect(container.querySelectorAll('.track-row')).toHaveLength(size);
        expect(container.querySelectorAll('.track-row.track-row-deferred')).toHaveLength(size - 25);

        if (size === 139) {
          expect(container.querySelector('.playlist-load-progress')?.textContent).toContain(
            'Enviando 139 canciones a la cola de reproducción…',
          );
          expect(container.querySelector('.playlist-hero-play')?.textContent).toContain(
            'Cargando 139 canciones…',
          );
        }
      }

      // Verify useLibrary.loadPlaylist complete vs partial notices for a 139-track playlist
      const notices: string[] = [];
      let mutateResult: unknown = { ok: true, loaded: 139, total: 139, failed: 0 };
      const mutate = vi.fn(async () => mutateResult);
      const setNotice = vi.fn((msg: string) => notices.push(msg));
      const setView = vi.fn();
      const refresh = vi.fn();
      const reportError = vi.fn();
      const playlist139 = makePlaylist({
        id: 'reggaeton-139',
        name: 'Reggaeton',
        tracks: Array.from({ length: 139 }, (_, i) => buildTrack(i + 1)),
      });

      let triggerLoad!: (pl: Playlist) => Promise<void>;
      function LoadHarness() {
        const lib = useLibrary({
          guildId: 'guild-a',
          session: null,
          reportError,
          run: async (_k, task) => task(),
          mutate,
          setNotice,
          setView,
          refresh,
        });
        triggerLoad = lib.loadPlaylist;
        return null;
      }

      await renderNode(<LoadHarness />);
      await act(async () => {
        await triggerLoad(playlist139);
      });
      expect(notices.at(-1)).toBe('«Reggaeton» (139 canciones) enviada a la cola.');

      // Now simulate partial load where 137 of 139 tracks succeeded
      mutateResult = { ok: true, loaded: 137, total: 139, failed: 2 };
      await act(async () => {
        await triggerLoad(playlist139);
      });
      expect(notices.at(-1)).toBe(
        '«Reggaeton»: se cargaron 137 de 139 canciones en la cola (2 omitidas).',
      );
    });
  });
});
