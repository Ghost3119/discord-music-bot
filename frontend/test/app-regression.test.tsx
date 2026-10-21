import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { Sidebar } from '../src/components/layout/Sidebar';
import { PlayerView } from '../src/features/dashboard/PlayerView';
import { useSonoraApp } from '../src/hooks/use-sonora-app';
import { session, snapshot, playlist, track } from './regression-fixtures';

vi.mock('../src/hooks/use-sonora-app', () => ({ useSonoraApp: vi.fn() }));

function descendants(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => isValidElement<Record<string, unknown>>(child) ? [child, ...descendants(child.props.children as ReactNode)] : []);
}

function appState(overrides: Partial<ReturnType<typeof useSonoraApp>> = {}) {
  const state = snapshot();
  return {
    session, authLoading: false, authError: '', retryAuth: vi.fn(), guilds: [{ id: 'guild-a', name: 'Comunidad', icon: null }], guildId: 'guild-a', setGuildId: vi.fn(), guildsLoading: false,
    view: 'player', setView: vi.fn(), mobileNav: false, setMobileNav: vi.fn(), error: '', setError: vi.fn(), notice: '', busy: '', loggingOut: false, logout: vi.fn(),
    state, connection: 'live', refresh: vi.fn().mockResolvedValue(undefined), current: state.current, controlsDisabled: false, playing: true, volumeDraft: null, setVolumeDraft: vi.fn(), action: vi.fn().mockResolvedValue(undefined), query: '', setQuery: vi.fn(), addToQueue: vi.fn(),
    playlists: [], favorites: [], libraryLoading: false, selectedPlaylist: '', setSelectedPlaylist: vi.fn(), playlist: undefined, modal: null, setModal: vi.fn(), name: '', setName: vi.fn(), targetPlaylist: '', setTargetPlaylist: vi.fn(), trackUrl: '', setTrackUrl: vi.fn(), trackArtist: '', setTrackArtist: vi.fn(), resolvedTrack: null, resolvingTrack: false, onTrackTitleChange: vi.fn(), onTrackArtistChange: vi.fn(), isFavorite: () => false, toggleFavorite: vi.fn(), reorderPlaylist: vi.fn(), removePlaylistTrack: vi.fn(), loadPlaylist: vi.fn(), submitModal: vi.fn(), reloadLibrary: vi.fn(), clearLibrary: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useSonoraApp>;
}

beforeEach(() => vi.clearAllMocks());

describe('application composition regression', () => {
  it('translates queue row indices to the existing one-based music API contract', async () => {
    const app = appState();
    vi.mocked(useSonoraApp).mockReturnValue(app);
    const view = descendants(App()).find(({ type }) => type === PlayerView)!;
    const { trackActions } = view.props as unknown as Parameters<typeof PlayerView>[0];
    await trackActions.onMove(1, 0);
    await trackActions.onRemove(track(), 2);
    expect(app.action).toHaveBeenNthCalledWith(1, { action: 'move', from: 2, to: 1 });
    expect(app.action).toHaveBeenNthCalledWith(2, { action: 'remove', index: 3 });
  });

  it('routes playlist moves/removals through library ownership and saves stable metadata', async () => {
    const app = appState();
    vi.mocked(useSonoraApp).mockReturnValue(app);
    const view = descendants(App()).find(({ type }) => type === PlayerView)!;
    const { trackActions } = view.props as unknown as Parameters<typeof PlayerView>[0];
    const saved = playlist();
    const song = saved.tracks[1];
    await trackActions.onMove(1, 0, saved);
    await trackActions.onRemove(song, 1, saved);
    expect(app.reorderPlaylist).toHaveBeenCalledWith(saved, 1, 0);
    expect(app.removePlaylistTrack).toHaveBeenCalledWith(saved, song);
    expect(app.action).not.toHaveBeenCalled();
    await trackActions.onPlay(song);
    const { id: _id, ...metadata } = song;
    expect(app.action).toHaveBeenCalledWith({ action: 'play', query: song.url, track: metadata });
    trackActions.onSave(song);
    expect(app.setModal).toHaveBeenCalledWith({ type: 'save', track: song });
  });

  it('resets playlist selection/mobile navigation when changing views and opens sidebar playlists', () => {
    const app = appState({ mobileNav: true });
    vi.mocked(useSonoraApp).mockReturnValue(app);
    const sidebar = descendants(App()).find(({ type }) => type === Sidebar)!;
    const props = sidebar.props as unknown as Parameters<typeof Sidebar>[0];
    props.onNavigate('diagnostics');
    expect(app.setView).toHaveBeenLastCalledWith('diagnostics');
    expect(app.setSelectedPlaylist).toHaveBeenLastCalledWith('');
    expect(app.setMobileNav).toHaveBeenLastCalledWith(false);
    props.onOpenPlaylist('playlist-a');
    expect(app.setSelectedPlaylist).toHaveBeenLastCalledWith('playlist-a');
    expect(app.setView).toHaveBeenLastCalledWith('library');
    expect(app.setMobileNav).toHaveBeenLastCalledWith(false);
  });

  it.each([['player', 'search-bar'], ['library', 'library-view'], ['favorites', 'favorites-view'], ['diagnostics', 'diagnostics-view']] as const)('composes only the selected %s view', (view, className) => {
    vi.mocked(useSonoraApp).mockReturnValue(appState({ view }));
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain(`class="${className}"`);
    const others = ['search-bar', 'library-view', 'favorites-view', 'diagnostics-view'].filter((value) => value !== className);
    others.forEach((value) => expect(html).not.toContain(`class="${value}"`));
    expect(html).toContain('id="main-content"');
    expect(html).toContain('aria-label="Controles de reproducción"');
  });

  it('shows login for an expired session and the empty guild state for a signed-in member', () => {
    vi.mocked(useSonoraApp).mockReturnValue(appState({ session: null, authError: 'Tu sesión terminó.' }));
    const login = renderToStaticMarkup(<App />);
    expect(login).toContain('class="login-page"');
    expect(login).toContain('Tu sesión terminó.');
    expect(login).not.toContain('class="app-shell"');
    vi.mocked(useSonoraApp).mockReturnValue(appState({ guildId: '', guilds: [] }));
    const noGuild = renderToStaticMarkup(<App />);
    expect(noGuild).toContain('Tu espacio está casi listo');
    expect(noGuild).not.toContain('class="search-bar"');
    expect(noGuild).not.toContain('class="diagnostics-view"');
  });
});
