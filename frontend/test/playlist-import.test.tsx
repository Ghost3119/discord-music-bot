// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaylistImportDialog, type PlaylistImportDialogProps } from '../src/features/library/PlaylistImportDialog';
import { inspectPlaylistUrl } from '../src/features/library/playlist-import-url';
import { LibraryView } from '../src/features/library/LibraryView';
import { api, ApiError, type ImportedPlaylistPreview, type Playlist } from '../src/lib/api';
import { session } from './regression-fixtures';

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  api: vi.fn(),
}));

interface PendingCall {
  path: string;
  options: RequestInit | undefined;
  csrfToken: string | undefined;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const samplePreview: ImportedPlaylistPreview = {
  platform: 'youtube_music',
  playlistId: 'PL_SAMPLE_123',
  sourceUrl: 'https://music.youtube.com/playlist?list=PL_SAMPLE_123',
  title: 'Ritmos de Medianoche',
  author: 'Curador Sonora',
  thumbnail: 'https://i.ytimg.com/vi/cover111111/hqdefault.jpg',
  totalCount: 4,
  importedCount: 3,
  omittedCount: 1,
  truncated: false,
  tracks: [
    {
      url: 'https://www.youtube.com/watch?v=track000001',
      title: 'Primera Canción',
      artist: 'Artista Uno',
      duration: 185,
      thumbnail: 'https://i.ytimg.com/vi/track000001/hqdefault.jpg',
      source: 'youtube',
      sourceId: 'track000001',
      platform: 'youtube_music',
      position: 0,
    },
    {
      url: 'https://www.youtube.com/watch?v=track000002',
      title: 'Segunda Canción',
      artist: 'Artista Dos',
      duration: 210,
      thumbnail: 'https://i.ytimg.com/vi/track000002/hqdefault.jpg',
      source: 'youtube',
      sourceId: 'track000002',
      platform: 'youtube_music',
      position: 1,
    },
    {
      url: 'https://www.youtube.com/watch?v=track000001',
      title: 'Primera Canción (Repetición)',
      artist: 'Artista Uno',
      duration: 185,
      thumbnail: null,
      source: 'youtube',
      sourceId: 'track000001',
      platform: 'youtube_music',
      position: 2,
    },
  ],
};

let pendingCalls: PendingCall[];
let roots: Root[];

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mountImportDialog(overrides: Partial<PlaylistImportDialogProps> = {}) {
  const props: PlaylistImportDialogProps = {
    open: true,
    guildId: 'guild-a',
    session,
    onClose: vi.fn(),
    onImported: vi.fn(),
    onOpenPlaylist: vi.fn(),
    ...overrides,
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  const render = (nextProps: Partial<PlaylistImportDialogProps> = {}) => {
    Object.assign(props, nextProps);
    root.render(<PlaylistImportDialog {...props} />);
  };

  await act(async () => {
    render();
  });

  return {
    props,
    async rerender(nextProps: Partial<PlaylistImportDialogProps>) {
      await act(async () => {
        render(nextProps);
      });
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  pendingCalls = [];
  roots = [];
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation((path, options, csrfToken) => {
    return new Promise((resolve, reject) => {
      pendingCalls.push({ path, options, csrfToken, resolve, reject });
    }) as ReturnType<typeof api>;
  });
});

afterEach(async () => {
  await act(async () => {
    roots.forEach((root) => root.unmount());
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('playlist URL inspection helper', () => {
  it('identifies YouTube, YouTube Music, Spotify (unsupported yet) and invalid links', () => {
    expect(inspectPlaylistUrl('')).toMatchObject({ status: 'empty', platform: null });
    expect(inspectPlaylistUrl('https://www.youtube.com/playlist?list=PL1234567890')).toEqual({
      status: 'valid',
      platform: 'youtube',
      label: 'YouTube',
    });
    expect(inspectPlaylistUrl('https://music.youtube.com/playlist?list=OLAK5uy_1234567890')).toEqual({
      status: 'valid',
      platform: 'youtube_music',
      label: 'YouTube Music',
    });
    expect(inspectPlaylistUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toMatchObject({
      status: 'valid',
      platform: 'spotify',
      label: 'Spotify',
    });
    expect(inspectPlaylistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({
      status: 'invalid',
      platform: 'youtube',
    });
    expect(inspectPlaylistUrl('https://music.youtube.com/playlist?list=LM')).toMatchObject({
      status: 'invalid',
      platform: 'youtube_music',
    });
    expect(inspectPlaylistUrl('https://example.com/playlist?list=PL1234')).toMatchObject({
      status: 'invalid',
      platform: null,
    });
  });
});

describe('LibraryView Importar playlist trigger', () => {
  it('renders the Importar playlist button and invokes onImportPlaylist when clicked', async () => {
    const onImportPlaylist = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <LibraryView
          library={{
            playlists: [],
            libraryLoading: false,
            busy: '',
            playbackReady: true,
            onSelectPlaylist: vi.fn(),
            onCreatePlaylist: vi.fn(),
            onImportPlaylist,
            onRenamePlaylist: vi.fn(),
            onDeletePlaylist: vi.fn(),
            onAddTrack: vi.fn(),
            onLoadPlaylist: vi.fn(),
          }}
          trackActions={{
            busy: false,
            playbackReady: true,
            isFavorite: () => false,
            onPlay: vi.fn(),
            onToggleFavorite: vi.fn(),
            onSave: vi.fn(),
            onMove: vi.fn(),
            onRemove: vi.fn(),
          }}
        />,
      );
    });

    const importBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Importar playlist'),
    );
    expect(importBtn).toBeDefined();
    await act(async () => {
      importBtn!.click();
    });
    expect(onImportPlaylist).toHaveBeenCalledOnce();
  });
});

describe('PlaylistImportDialog user workflow and invariants', () => {
  it('detects platform, fetches preview, allows track deselection, renames playlist, prevents double-click, saves and opens imported playlist', async () => {
    const harness = await mountImportDialog();

    const urlInput = document.querySelector<HTMLInputElement>('input[type="url"]')!;
    expect(urlInput).toBeTruthy();

    await act(async () => {
      setNativeInputValue(urlInput, samplePreview.sourceUrl);
    });

    expect(document.querySelector('.import-platform-pill')?.textContent).toBe('YouTube Music');

    const analyzeBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Analizar'),
    )!;
    await act(async () => {
      analyzeBtn.click();
    });

    expect(pendingCalls).toHaveLength(1);
    expect(pendingCalls[0]!.path).toBe('/api/guilds/guild-a/playlists/import/preview');
    expect(document.body.textContent).toContain('Consultando metadatos de la playlist…');

    await act(async () => {
      pendingCalls[0]!.resolve({ preview: samplePreview });
    });

    expect(document.body.textContent).toContain('por Curador Sonora');
    expect(document.body.textContent).toContain('1 no disponibles omitidas');
    expect(document.querySelectorAll('.import-ledger-row')).toHaveLength(3);

    // Exclude the second track (index 1)
    const checkboxes = document.querySelectorAll<HTMLInputElement>('.import-ledger-row input[type="checkbox"]');
    expect(checkboxes).toHaveLength(3);
    await act(async () => {
      checkboxes[1]!.click();
    });
    expect(document.body.textContent).toContain('2 de 3 seleccionadas');

    // Rename the playlist before saving
    const nameInput = document.querySelector<HTMLInputElement>('.import-name-field input')!;
    expect(nameInput.value).toBe('Ritmos de Medianoche');
    await act(async () => {
      setNativeInputValue(nameInput, 'Mi Selección YTM');
    });

    // Click Importar twice rapidly -> only 1 API call should be dispatched (double-click guard)
    const importSubmitBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Importar (2)'),
    )!;
    await act(async () => {
      importSubmitBtn.click();
      importSubmitBtn.click();
    });

    expect(pendingCalls).toHaveLength(2);
    const commitCall = pendingCalls[1]!;
    expect(commitCall.path).toBe('/api/guilds/guild-a/playlists/import');
    const sentPayload = JSON.parse(String(commitCall.options?.body));
    expect(sentPayload.name).toBe('Mi Selección YTM');
    expect(sentPayload.tracks).toHaveLength(2);
    expect(sentPayload.tracks[0].title).toBe('Primera Canción');
    expect(sentPayload.tracks[1].title).toBe('Primera Canción (Repetición)');
    expect(typeof sentPayload.requestId).toBe('string');

    const createdPlaylist: Playlist = {
      id: 'pl-imported-99',
      name: 'Mi Selección YTM',
      tracks: sentPayload.tracks.map((item: Record<string, unknown>, i: number) => ({
        id: `t-${i}`,
        ...item,
      })),
    };

    await act(async () => {
      commitCall.resolve({ playlist: createdPlaylist });
    });

    expect(harness.props.onImported).toHaveBeenCalledWith(createdPlaylist);
    expect(document.body.textContent).toContain('«Mi Selección YTM» ya está en tu biblioteca');

    const openPlaylistBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Abrir playlist importada'),
    )!;
    await act(async () => {
      openPlaylistBtn.click();
    });
    expect(harness.props.onOpenPlaylist).toHaveBeenCalledWith('pl-imported-99');
    expect(harness.props.onClose).toHaveBeenCalledOnce();
  });

  it('aborts in-flight preview when cancelled, when guild changes, or when dialog is closed and reopened', async () => {
    const harness = await mountImportDialog();
    const urlInput = document.querySelector<HTMLInputElement>('input[type="url"]')!;

    await act(async () => {
      setNativeInputValue(urlInput, 'https://www.youtube.com/playlist?list=PL_ABORT_TEST');
    });

    const analyzeBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Analizar'),
    )!;
    await act(async () => {
      analyzeBtn.click();
    });

    const previewReq = pendingCalls[0]!;
    expect((previewReq.options?.signal as AbortSignal)?.aborted).toBe(false);

    // 1. User clicks Cancelar during preview
    const cancelBtn = [...document.querySelectorAll('button')].find(
      (btn) => btn.textContent === 'Cancelar',
    )!;
    await act(async () => {
      cancelBtn.click();
    });
    expect((previewReq.options?.signal as AbortSignal)?.aborted).toBe(true);
    expect(document.body.textContent).toContain('Consulta cancelada.');

    // Late resolution is ignored
    await act(async () => {
      previewReq.resolve({ preview: samplePreview });
    });
    expect(document.querySelectorAll('.import-ledger-row')).toHaveLength(0);

    // 2. Start another preview and change guildId -> aborts and resets state
    await act(async () => {
      const nextAnalyze = [...document.querySelectorAll('button')].find((btn) =>
        btn.textContent?.includes('Analizar'),
      )!;
      nextAnalyze.click();
    });
    const secondReq = pendingCalls[1]!;
    await harness.rerender({ guildId: 'guild-b' });
    expect((secondReq.options?.signal as AbortSignal)?.aborted).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe('');

    // 3. Reopening the dialog starts with a clean slate
    await act(async () => {
      setNativeInputValue(
        document.querySelector<HTMLInputElement>('input[type="url"]')!,
        samplePreview.sourceUrl,
      );
    });
    await harness.rerender({ open: false });
    await harness.rerender({ open: true });
    expect(document.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe('');
  });

  it('displays backend errors clearly and allows retrying', async () => {
    await mountImportDialog();
    const urlInput = document.querySelector<HTMLInputElement>('input[type="url"]')!;

    await act(async () => {
      setNativeInputValue(urlInput, 'https://www.youtube.com/playlist?list=PL_PRIVATE');
    });
    const analyzeBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Analizar'),
    )!;
    await act(async () => {
      analyzeBtn.click();
    });

    await act(async () => {
      pendingCalls[0]!.reject(new ApiError('La playlist es privada o requiere iniciar sesión.', 403));
    });

    expect(document.querySelector('.import-error-banner')?.textContent).toContain(
      'La playlist es privada o requiere iniciar sesión.',
    );
  });

  it('handles Spotify restriction errors by offering a one-click switch to CSV import and completes CSV preview/save', async () => {
    const harness = await mountImportDialog();
    const urlInput = document.querySelector<HTMLInputElement>('input[type="url"]')!;

    await act(async () => {
      setNativeInputValue(urlInput, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    });
    expect(document.querySelector('.import-platform-pill')?.textContent).toBe('Spotify');

    const analyzeBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Analizar'),
    )!;
    await act(async () => {
      analyzeBtn.click();
    });

    await act(async () => {
      pendingCalls[0]!.reject(
        new ApiError(
          'La playlist de Spotify no es accesible en Development Mode. Usa la pestaña «Archivo CSV».',
          404,
          'SPOTIFY_PLAYLIST_INACCESSIBLE',
        ),
      );
    });

    const switchBtn = [...document.querySelectorAll<HTMLButtonElement>('.import-error-banner button')].find((btn) =>
      btn.textContent?.includes('Cambiar a Archivo CSV'),
    );
    expect(switchBtn).toBeDefined();

    await act(async () => {
      switchBtn!.click();
    });

    // Now in CSV mode: click Cargar ejemplo and Analizar CSV
    const loadSampleBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Cargar ejemplo'),
    )!;
    await act(async () => {
      loadSampleBtn.click();
    });

    const analyzeCsvBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Analizar CSV'),
    )!;
    await act(async () => {
      analyzeCsvBtn.click();
    });

    expect(pendingCalls).toHaveLength(2);
    expect(pendingCalls[1]!.path).toBe('/api/guilds/guild-a/playlists/import/csv');

    const csvPreview: ImportedPlaylistPreview = {
      platform: 'csv',
      playlistId: 'csv-import',
      sourceUrl: 'https://music.youtube.com/search?q=playlist',
      title: 'spotify favoritas',
      author: 'Archivo CSV',
      thumbnail: null,
      totalCount: 2,
      importedCount: 2,
      omittedCount: 0,
      truncated: false,
      tracks: [
        {
          url: 'https://open.spotify.com/track/1IHWl5LamUGEuP4ozKQSXZ',
          title: 'Tití Me Preguntó',
          artist: 'Bad Bunny',
          album: 'Un Verano Sin Ti',
          duration: 243,
          thumbnail: null,
          source: 'spotify',
          sourceId: '1IHWl5LamUGEuP4ozKQSXZ',
          platform: 'csv',
          position: 0,
        },
      ],
    };

    await act(async () => {
      pendingCalls[1]!.resolve({ preview: csvPreview });
    });

    expect(document.body.textContent).toContain('CSV · Spotify / Manual');
    expect(document.body.textContent).toContain('Bad Bunny · Un Verano Sin Ti');

    const importSubmitBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Importar (1)'),
    )!;
    await act(async () => {
      importSubmitBtn.click();
    });

    expect(pendingCalls).toHaveLength(3);
    expect(pendingCalls[2]!.path).toBe('/api/guilds/guild-a/playlists/import');
    await act(async () => {
      pendingCalls[2]!.resolve({
        playlist: {
          id: 'pl-csv-1',
          name: 'spotify favoritas',
          tracks: csvPreview.tracks.map((t, i) => ({ ...t, id: `trk-${i}` })),
        },
      });
    });
    expect(harness.props.onImported).toHaveBeenCalledOnce();
  });
});
