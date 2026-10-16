// @vitest-environment jsdom
import { StrictMode, act, type FormEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryDialog } from '../src/features/library/LibraryDialog';
import { useLibrary } from '../src/features/library/use-library';
import { api, type Playlist, type Track } from '../src/lib/api';
import { playlist, session, track } from './regression-fixtures';

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  api: vi.fn(),
}));

type Metadata = Omit<Track, 'id'>;
type Library = ReturnType<typeof useLibrary>;
type LibraryOptions = Parameters<typeof useLibrary>[0];
interface PendingRequest {
  path: string;
  signal: AbortSignal | null | undefined;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const urlA = 'https://open.spotify.com/track/song-a';
const urlB = 'https://www.youtube.com/watch?v=song-b';
const playlistA = playlist();
const playlistB = playlist({ id: 'playlist-b', name: 'Otra colección' });
const metadataA: Metadata = {
  url: urlA,
  title: 'Título A',
  artist: 'Artista A',
  duration: 111,
  thumbnail: 'https://images.example/a.jpg',
  source: 'spotify',
};
const metadataB: Metadata = {
  url: urlB,
  title: 'Título B',
  artist: 'Artista B',
  duration: 222,
  thumbnail: 'https://images.example/b.jpg',
  source: 'youtube',
};

let requests: PendingRequest[];
let roots: Root[];

async function mountLibrary(strict = false, renderDialog = false) {
  let current!: Library;
  const mutate = vi.fn<LibraryOptions['mutate']>().mockResolvedValue(undefined);
  const reportError = vi.fn();
  const options: LibraryOptions = {
    guildId: 'guild-a',
    session,
    mutate,
    reportError,
    run: async (_key, task) => {
      await task();
    },
    setNotice: vi.fn(),
    setView: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  function Harness() {
    current = useLibrary(options);
    return (
      <>
        <output>{current.name}</output>
        {renderDialog && (
          <LibraryDialog
            dialog={{
              modal: current.modal,
              busy: '',
              error: '',
              playlists: current.playlists,
              name: current.name,
              targetPlaylist: current.targetPlaylist,
              trackUrl: current.trackUrl,
              trackArtist: current.trackArtist,
              resolvedTrack: current.resolvedTrack,
              resolvingTrack: current.resolvingTrack,
              onClose: () => {
                current.setModal(null);
              },
              onCreatePlaylist: () => {
                current.setModal({ type: 'playlist' });
              },
              onNameChange: current.setName,
              onTargetPlaylistChange: current.setTargetPlaylist,
              onTrackUrlChange: current.setTrackUrl,
              onTrackTitleChange: current.onTrackTitleChange,
              onTrackArtistChange: current.onTrackArtistChange,
              onSubmit: current.submitModal,
            }}
          />
        )}
      </>
    );
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = () => {
    root.render(
      strict ? (
        <StrictMode>
          <Harness />
        </StrictMode>
      ) : (
        <Harness />
      ),
    );
  };
  await act(async () => {
    render();
  });
  return {
    get state() {
      return current;
    },
    mutate,
    reportError,
    async update(change: (library: Library) => void) {
      await act(async () => {
        change(current);
      });
    },
    async submit() {
      await act(async () => {
        await current.submitModal({ preventDefault: vi.fn() } as unknown as FormEvent);
      });
    },
    async changeContext(context: Pick<LibraryOptions, 'guildId' | 'session'>) {
      Object.assign(options, context);
      await act(async () => {
        render();
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      roots = roots.filter((candidate) => candidate !== root);
    },
  };
}

function libraryRequests() {
  return requests.filter(({ path }) => path.endsWith('/playlists'));
}

function metadataRequests() {
  return requests.filter(({ path }) => path.includes('/tracks/resolve?'));
}

function requestFor(url: string) {
  const request = metadataRequests().findLast(({ path }) => path.endsWith(encodeURIComponent(url)));
  expect(request, `metadata request for ${url}`).toBeDefined();
  return request!;
}

async function answer(request: PendingRequest, value: unknown) {
  await act(async () => {
    request.resolve(value);
  });
}

async function finishLibrary(items: Playlist[], request = libraryRequests().at(-1)!) {
  await answer(request, { playlists: items });
}

async function elapseDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180);
  });
}

async function openAdd(harness: Awaited<ReturnType<typeof mountLibrary>>) {
  await harness.update((library) => {
    library.setModal({ type: 'add', playlist: playlistA });
  });
}

async function resolveA(harness: Awaited<ReturnType<typeof mountLibrary>>) {
  await openAdd(harness);
  await harness.update((library) => {
    library.setTrackUrl(urlA);
  });
  await elapseDebounce();
  await answer(requestFor(urlA), { track: metadataA });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  requests = [];
  roots = [];
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation((path, options) => {
    if (path.endsWith('/favorites')) return Promise.resolve({ favorites: [] }) as ReturnType<typeof api>;
    // Deliberately ignore abort when settling: the hook must reject stale responses itself.
    return new Promise((resolve, reject) => {
      requests.push({ path, signal: options?.signal, resolve, reject });
    }) as ReturnType<typeof api>;
  });
});

afterEach(async () => {
  await act(async () => {
    roots.forEach((root) => {
      root.unmount();
    });
  });
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('mounted library editor drafts', () => {
  it.each(['create', 'rename', 'add'] as const)(
    'keeps the %s draft when the initial library request finishes',
    async (kind) => {
      const harness = await mountLibrary();
      await harness.update((library) => {
        library.setModal(
          kind === 'add'
            ? { type: 'add', playlist: playlistA }
            : kind === 'rename'
              ? { type: 'playlist', playlist: playlistA }
              : { type: 'playlist' },
        );
      });
      await harness.update((library) => {
        if (kind === 'add') {
          library.setTrackUrl(urlA);
          library.onTrackTitleChange('Mi título');
          library.onTrackArtistChange('Mi artista');
        } else library.setName('Mi borrador');
      });

      await finishLibrary([playlistA, playlistB]);

      expect(harness.state.name).toBe(kind === 'add' ? 'Mi título' : 'Mi borrador');
      if (kind === 'add') {
        expect(harness.state.trackUrl).toBe(urlA);
        expect(harness.state.trackArtist).toBe('Mi artista');
      }
    },
  );

  it('keeps a valid save destination across refreshes and falls back only if it disappears', async () => {
    const harness = await mountLibrary();
    await finishLibrary([playlistA, playlistB]);
    await harness.update((library) => {
      library.setModal({ type: 'save', track: track() });
    });
    await harness.update((library) => {
      library.setTargetPlaylist(playlistB.id);
    });
    await harness.update((library) => {
      library.reloadLibrary();
    });
    await finishLibrary([playlistA, playlistB]);
    expect(harness.state.targetPlaylist).toBe(playlistB.id);

    await harness.update((library) => {
      library.reloadLibrary();
    });
    await finishLibrary([playlistA]);
    expect(harness.state.targetPlaylist).toBe(playlistA.id);
  });

  it('selects a destination when playlists arrive after opening save', async () => {
    const harness = await mountLibrary();
    await harness.update((library) => {
      library.setModal({ type: 'save', track: track() });
    });
    expect(harness.state.targetPlaylist).toBe('');
    await finishLibrary([playlistB]);
    expect(harness.state.targetPlaylist).toBe(playlistB.id);
  });

  it('keeps an add draft and its active lookup when the collection refreshes', async () => {
    const harness = await mountLibrary();
    await finishLibrary([playlistA]);
    await openAdd(harness);
    await harness.update((library) => {
      library.setTrackUrl(urlA);
      library.onTrackTitleChange('Título propio');
    });
    await elapseDebounce();
    const pending = requestFor(urlA);
    await harness.update((library) => {
      library.reloadLibrary();
    });
    await finishLibrary([playlistA, playlistB]);
    expect(harness.state.trackUrl).toBe(urlA);
    expect(harness.state.name).toBe('Título propio');
    expect(harness.state.resolvingTrack).toBe(true);
    expect(pending.signal?.aborted).toBe(false);
    await answer(pending, { track: metadataA });
    expect(harness.state.name).toBe('Título propio');
    expect(harness.state.trackArtist).toBe(metadataA.artist);
  });
});

describe('mounted library metadata ownership', () => {
  it.each([false, true])(
    'saves B without autofilled A metadata while B is pending (StrictMode=%s)',
    async (strict) => {
      const harness = await mountLibrary(strict);
      await resolveA(harness);
      await harness.update((library) => {
        library.setTrackUrl(urlB);
      });
      await elapseDebounce();
      expect(harness.state.resolvingTrack).toBe(true);

      await harness.submit();

      expect(harness.mutate).toHaveBeenCalledExactlyOnceWith(
        '/api/guilds/guild-a/playlists/playlist-a/tracks',
        'POST',
        {
          url: urlB,
          title: '',
          artist: 'Artista desconocido',
          duration: 0,
          thumbnail: null,
          source: 'youtube',
        },
      );
      expect(requestFor(urlB).signal?.aborted).toBe(true);
      await answer(requestFor(urlB), { track: metadataB });
      expect(harness.state.modal).toBe(null);
    },
  );

  it('ignores a late A response after B starts and keeps B loading until its own response', async () => {
    const harness = await mountLibrary();
    await openAdd(harness);
    await harness.update((library) => {
      library.setTrackUrl(urlA);
    });
    await elapseDebounce();
    const requestA = requestFor(urlA);
    await harness.update((library) => {
      library.setTrackUrl(urlB);
    });
    await elapseDebounce();
    expect(requestA.signal?.aborted).toBe(true);

    await answer(requestA, { track: metadataA });
    expect(harness.state.resolvedTrack).toBe(null);
    expect(harness.state.name).toBe('');
    expect(harness.state.resolvingTrack).toBe(true);

    await answer(requestFor(urlB), { track: metadataB });
    expect(harness.state.resolvedTrack).toEqual(metadataB);
    expect(harness.state.name).toBe(metadataB.title);
    expect(harness.state.trackArtist).toBe(metadataB.artist);
    expect(harness.state.resolvingTrack).toBe(false);
    await harness.submit();
    expect(harness.mutate.mock.calls[0]?.[2]).toEqual(metadataB);
  });

  it('ignores a late A rejection without clearing B or completing its loading state', async () => {
    const harness = await mountLibrary();
    await openAdd(harness);
    await harness.update((library) => {
      library.setTrackUrl(urlA);
    });
    await elapseDebounce();
    const requestA = requestFor(urlA);
    await harness.update((library) => {
      library.setTrackUrl(urlB);
    });
    await elapseDebounce();
    await act(async () => {
      requestA.reject(new Error('late A failure'));
    });
    expect(harness.state.resolvedTrack).toBe(null);
    expect(harness.state.resolvingTrack).toBe(true);
    expect(harness.reportError).not.toHaveBeenCalled();
    await answer(requestFor(urlB), { track: metadataB });
    expect(harness.state.resolvedTrack).toEqual(metadataB);
    expect(harness.state.resolvingTrack).toBe(false);
  });

  it('associates metadata with the requested URL even when the resolver returns a canonical URL', async () => {
    const harness = await mountLibrary();
    const requestedUrl = `${urlA}?si=share-token`;
    await openAdd(harness);
    await harness.update((library) => {
      library.setTrackUrl(`  ${requestedUrl}  `);
    });
    await elapseDebounce();
    await answer(requestFor(requestedUrl), { track: metadataA });
    expect(harness.state.resolvedTrack).toEqual(metadataA);
    expect(harness.state.name).toBe(metadataA.title);
    await harness.submit();
    expect(harness.mutate.mock.calls[0]?.[2]).toEqual({ ...metadataA, url: requestedUrl });
  });

  it('preserves manual title and artist edits made during an active lookup without restarting it', async () => {
    const harness = await mountLibrary();
    await openAdd(harness);
    await harness.update((library) => {
      library.setTrackUrl(urlA);
    });
    await elapseDebounce();
    const pending = requestFor(urlA);
    await harness.update((library) => {
      library.onTrackTitleChange('Título manual');
      library.onTrackArtistChange('Artista manual');
    });
    await elapseDebounce();
    expect(metadataRequests()).toHaveLength(1);
    expect(pending.signal?.aborted).toBe(false);

    await answer(pending, { track: metadataA });
    expect(harness.state.name).toBe('Título manual');
    expect(harness.state.trackArtist).toBe('Artista manual');
    expect(harness.state.resolvingTrack).toBe(false);
    await harness.submit();
    expect(harness.mutate.mock.calls[0]?.[2]).toEqual({
      ...metadataA,
      title: 'Título manual',
      artist: 'Artista manual',
    });
  });

  it('preserves manual edits across URL changes while replacing URL-specific resolved data', async () => {
    const harness = await mountLibrary();
    await resolveA(harness);
    await harness.update((library) => {
      library.onTrackTitleChange('Mi versión');
      library.onTrackArtistChange('Mi artista');
      library.setTrackUrl(urlB);
    });
    await elapseDebounce();
    await answer(requestFor(urlB), { track: metadataB });
    expect(harness.state.name).toBe('Mi versión');
    expect(harness.state.trackArtist).toBe('Mi artista');
    expect(harness.state.resolvedTrack).toEqual(metadataB);
    await harness.submit();
    expect(harness.mutate.mock.calls[0]?.[2]).toEqual({
      ...metadataB,
      title: 'Mi versión',
      artist: 'Mi artista',
    });
  });

  it('saves only explicit manual edits while a replacement URL is still resolving', async () => {
    const harness = await mountLibrary();
    await resolveA(harness);
    await harness.update((library) => {
      library.onTrackTitleChange('Título propio');
      library.setTrackUrl(urlB);
    });
    await elapseDebounce();
    await harness.submit();
    expect(harness.mutate.mock.calls[0]?.[2]).toEqual({
      url: urlB,
      title: 'Título propio',
      artist: 'Artista desconocido',
      duration: 0,
      thumbnail: null,
      source: 'youtube',
    });
  });

  it('treats manually cleared fields as edits even when the lookup finishes later', async () => {
    const harness = await mountLibrary();
    await openAdd(harness);
    await harness.update((library) => {
      library.setTrackUrl(urlA);
    });
    await elapseDebounce();
    await harness.update((library) => {
      library.onTrackTitleChange('');
      library.onTrackArtistChange('');
    });
    await elapseDebounce();
    await answer(requestFor(urlA), { track: metadataA });
    expect(harness.state.name).toBe('');
    expect(harness.state.trackArtist).toBe('');
    await harness.submit();
    expect(harness.mutate.mock.calls[0]?.[2]).toEqual({
      ...metadataA,
      title: '',
      artist: 'Artista desconocido',
    });
  });

  it('does not restore cleared manual fields from already resolved metadata on submit', async () => {
    const harness = await mountLibrary();
    await resolveA(harness);
    await harness.update((library) => {
      library.onTrackTitleChange('');
      library.onTrackArtistChange('');
    });
    await harness.submit();
    expect(harness.mutate.mock.calls[0]?.[2]).toEqual({
      ...metadataA,
      title: '',
      artist: 'Artista desconocido',
    });
  });

  it('previews the same artist fallback it saves after the artist field is manually cleared', async () => {
    const harness = await mountLibrary(false, true);
    await resolveA(harness);
    await harness.update((library) => {
      library.onTrackTitleChange('Título propio');
      library.onTrackArtistChange('');
    });
    const preview = document.querySelector('.track-preview-copy')?.textContent;
    expect(harness.state.trackArtist).toBe('');
    await harness.submit();
    expect(harness.mutate.mock.calls[0]?.[2]).toEqual({
      ...metadataA,
      title: 'Título propio',
      artist: 'Artista desconocido',
    });
    expect(preview).toContain('Título propio');
    expect(preview).toContain('Artista desconocido');
    expect(preview).not.toContain(metadataA.artist);
  });

  it('cancels a query when the URL is erased and ignores its eventual response', async () => {
    const harness = await mountLibrary();
    await openAdd(harness);
    await harness.update((library) => {
      library.setTrackUrl(urlA);
    });
    await elapseDebounce();
    const pending = requestFor(urlA);
    await harness.update((library) => {
      library.setTrackUrl('');
    });
    expect(pending.signal?.aborted).toBe(true);
    expect(harness.state.resolvingTrack).toBe(false);
    await answer(pending, { track: metadataA });
    expect(harness.state.trackUrl).toBe('');
    expect(harness.state.resolvedTrack).toBe(null);
    expect(harness.state.name).toBe('');
    expect(harness.state.trackArtist).toBe('');
  });

  it('clears automatic fields when a resolved URL is erased but retains manual fields', async () => {
    const harness = await mountLibrary();
    await resolveA(harness);
    await harness.update((library) => {
      library.onTrackArtistChange('Mi artista');
      library.setTrackUrl('');
    });
    expect(harness.state.resolvedTrack).toBe(null);
    expect(harness.state.name).toBe('');
    expect(harness.state.trackArtist).toBe('Mi artista');
  });

  it.each([false, true])(
    'cancels the old lookup and starts a clean draft after closing and reopening (StrictMode=%s)',
    async (strict) => {
      const harness = await mountLibrary(strict);
      await openAdd(harness);
      await harness.update((library) => {
        library.setTrackUrl(urlA);
      });
      await elapseDebounce();
      const pending = requestFor(urlA);
      await harness.update((library) => {
        library.onTrackTitleChange('Borrador antiguo');
      });
      await harness.update((library) => {
        library.setModal(null);
      });
      expect(pending.signal?.aborted).toBe(true);
      await harness.update((library) => {
        library.setModal({ type: 'add', playlist: playlistB });
      });
      await answer(pending, { track: metadataA });
      expect(harness.state.trackUrl).toBe('');
      expect(harness.state.name).toBe('');
      expect(harness.state.trackArtist).toBe('');
      expect(harness.state.resolvedTrack).toBe(null);
      expect(harness.state.resolvingTrack).toBe(false);
    },
  );
});

describe('mounted library cancellation lifecycle', () => {
  it.each(['guild', 'session'] as const)(
    'cancels requests and discards the old editor when the %s changes',
    async (change) => {
      const harness = await mountLibrary();
      await openAdd(harness);
      await harness.update((library) => {
        library.setTrackUrl(urlA);
      });
      await elapseDebounce();
      const pendingMetadata = requestFor(urlA);
      const pendingLibrary = libraryRequests()[0];
      await harness.changeContext({
        guildId: change === 'guild' ? 'guild-b' : 'guild-a',
        session: change === 'session' ? { ...session, csrfToken: 'replacement-session' } : session,
      });
      expect(pendingMetadata.signal?.aborted).toBe(true);
      expect(pendingLibrary.signal?.aborted).toBe(true);
      expect(harness.state.modal).toBe(null);
      await answer(pendingMetadata, { track: metadataA });
      await finishLibrary([playlistA], pendingLibrary);
      expect(harness.state.resolvedTrack).toBe(null);
      expect(harness.state.playlists).toEqual([]);
      await finishLibrary([playlistB]);
      expect(harness.state.playlists).toEqual([playlistB]);
      expect(harness.reportError).not.toHaveBeenCalled();
    },
  );

  it('aborts in-flight library and metadata requests on unmount and ignores their late settlements', async () => {
    const harness = await mountLibrary();
    await openAdd(harness);
    await harness.update((library) => {
      library.setTrackUrl(urlA);
    });
    await elapseDebounce();
    const pendingMetadata = requestFor(urlA);
    const pendingLibrary = libraryRequests()[0];
    await harness.unmount();
    expect(pendingMetadata.signal?.aborted).toBe(true);
    expect(pendingLibrary.signal?.aborted).toBe(true);
    await act(async () => {
      pendingMetadata.reject(new Error('lookup completed after unmount'));
      pendingLibrary.reject(new Error('library completed after unmount'));
    });
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it('removes the metadata debounce on unmount before any request is issued', async () => {
    const harness = await mountLibrary();
    await openAdd(harness);
    await harness.update((library) => {
      library.setTrackUrl(urlA);
    });
    await harness.unmount();
    await elapseDebounce();
    expect(metadataRequests()).toHaveLength(0);
  });

  it('ignores the StrictMode probe request and accepts only the live library response', async () => {
    const harness = await mountLibrary(true);
    const [probe, live] = libraryRequests();
    expect(libraryRequests()).toHaveLength(2);
    expect(probe.signal?.aborted).toBe(true);
    expect(live.signal?.aborted).toBe(false);
    await finishLibrary([playlistA], probe);
    expect(harness.state.playlists).toEqual([]);
    expect(harness.state.libraryLoading).toBe(true);
    await finishLibrary([playlistB], live);
    expect(harness.state.playlists).toEqual([playlistB]);
    expect(harness.state.libraryLoading).toBe(false);
  });
});
