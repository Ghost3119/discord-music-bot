import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CustomSelect } from '../src/components/common/CustomSelect';
import { IconButton } from '../src/components/common/IconButton';
import { Loading } from '../src/components/common/StateFeedback';
import { Header } from '../src/components/layout/Header';
import { Sidebar } from '../src/components/layout/Sidebar';
import { PlayerBar, type PlaybackBindings } from '../src/components/player/PlayerBar';
import { MobilePlaybackTools } from '../src/components/player/MobilePlaybackTools';
import { NowPlaying } from '../src/components/player/NowPlaying';
import { QueueSection, TrackItem, TrackList, trackSortIds, type TrackActions } from '../src/components/queue/TrackList';
import { Login } from '../src/features/auth/Login';
import { PlayerView } from '../src/features/dashboard/PlayerView';
import { DiagnosticsView } from '../src/features/diagnostics/DiagnosticsView';
import { FavoritesView } from '../src/features/favorites/FavoritesView';
import { LibraryView, type LibraryViewBindings } from '../src/features/library/LibraryView';
import { LibraryDialog, type LibraryDialogBindings } from '../src/features/library/LibraryDialog';
import { playlist, session, snapshot, track } from './regression-fixtures';

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const result: ReactElement<Record<string, unknown>>[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return;
    result.push(child, ...elements(child.props.children as ReactNode));
  });
  return result;
}

function control(node: ReactNode, label: string) {
  const found = elements(node).find(({ props }) => props.label === label || props['aria-label'] === label);
  if (!found) throw new Error(`Missing control: ${label}`);
  return found.props;
}

function click(node: ReactNode, label: string) {
  return (control(node, label).onClick as () => unknown)();
}

function tag(markup: string, name: string, attribute: string, value: string) {
  const found = markup.match(new RegExp(`<${name}\\b[^>]*>`, 'g'))?.find((opening) => opening.includes(`${attribute}="${value}"`));
  if (!found) throw new Error(`Missing ${name}[${attribute}="${value}"]`);
  return found;
}

function playback(overrides: Partial<PlaybackBindings> = {}): PlaybackBindings {
  return { state: snapshot(), busy: '', controlsDisabled: false, volumeDraft: null, setVolumeDraft: vi.fn(), action: vi.fn().mockResolvedValue(undefined), isFavorite: () => false, toggleFavorite: vi.fn(), onSaveTrack: vi.fn(), ...overrides };
}

function actions(overrides: Partial<TrackActions> = {}): TrackActions {
  return { busy: false, playbackReady: true, isFavorite: () => false, onPlay: vi.fn(), onToggleFavorite: vi.fn(), onSave: vi.fn(), onMove: vi.fn(), onRemove: vi.fn(), ...overrides };
}

function library(overrides: Partial<LibraryViewBindings> = {}): LibraryViewBindings {
  return { playlists: [], libraryLoading: false, busy: '', playbackReady: true, onSelectPlaylist: vi.fn(), onCreatePlaylist: vi.fn(), onRenamePlaylist: vi.fn(), onDeletePlaylist: vi.fn(), onAddTrack: vi.fn(), onLoadPlaylist: vi.fn(), ...overrides };
}

function dialog(overrides: Partial<LibraryDialogBindings> = {}): LibraryDialogBindings {
  return { modal: null, busy: '', error: '', playlists: [], name: '', targetPlaylist: '', trackUrl: '', trackArtist: '', resolvedTrack: null, resolvingTrack: false, onClose: vi.fn(), onCreatePlaylist: vi.fn(), onNameChange: vi.fn(), onTargetPlaylistChange: vi.fn(), onTrackUrlChange: vi.fn(), onTrackTitleChange: vi.fn(), onTrackArtistChange: vi.fn(), onSubmit: vi.fn(), ...overrides };
}

describe('shared and navigation markup regression', () => {
  it('preserves OAuth login, disabled connection state, alert and retry action', () => {
    const retry = vi.fn();
    const login = Login({ loading: false, error: 'Conexión interrumpida.', retry });
    const html = renderToStaticMarkup(login);
    expect(tag(html, 'a', 'href', '/auth/discord')).toContain('discord-login');
    expect(html).toContain('role="alert"');
    const retryButton = elements(login).find(({ props }) => props.onClick === retry);
    (retryButton?.props.onClick as () => void)();
    expect(retry).toHaveBeenCalledTimes(1);
    const loading = renderToStaticMarkup(<Login loading error="" retry={retry} />);
    expect(loading).toContain('Conectando con tu espacio');
    expect(loading).not.toContain('href="/auth/discord"');
    expect(loading).toMatch(/<button[^>]*disabled=""/);
  });

  it('retains button names/pressed state and announces loading', () => {
    const html = renderToStaticMarkup(<IconButton label="Guardar en favoritos" active aria-pressed disabled><span>♥</span></IconButton>);
    expect(tag(html, 'button', 'aria-label', 'Guardar en favoritos')).toContain('title="Guardar en favoritos"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('is-active');
    expect(renderToStaticMarkup(<Loading text="Sincronizando…" />)).toContain('role="status"');
  });

  it('keeps the guild combobox contract and loading placeholder', () => {
    const selected = renderToStaticMarkup(<CustomSelect id="guild-select" variant="guild" label="ESCUCHANDO EN" value="guild-a" options={[{ value: 'guild-a', label: 'Comunidad' }]} onChange={vi.fn()} />);
    expect(selected).toContain('guild-picker');
    const trigger = tag(selected, 'button', 'role', 'combobox');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toContain('aria-haspopup="listbox"');
    expect(trigger).toContain('aria-controls="guild-select-listbox"');
    expect(selected).toContain('Comunidad');
    const loading = renderToStaticMarkup(<CustomSelect disabled value="" options={[]} placeholder="Buscando servidores…" onChange={vi.fn()} />);
    expect(loading).toContain('Buscando servidores…');
    expect(tag(loading, 'button', 'role', 'combobox')).toContain('disabled=""');
  });

  it('keeps all four views, mobile backdrop siblings and selected playlist navigation', () => {
    const onNavigate = vi.fn();
    const onOpenPlaylist = vi.fn();
    const node = Sidebar({ mobileNav: true, view: 'library', playing: true, guildId: 'guild-a', playlists: [playlist()], selectedPlaylist: 'playlist-a', loggingOut: false, onCloseNavigation: vi.fn(), onNavigate, onOpenPlaylist, onCreatePlaylist: vi.fn(), onLogout: vi.fn() });
    const html = renderToStaticMarkup(node);
    expect(html).toMatch(/^<button[^>]*class="nav-backdrop"/);
    expect(html).toContain('class="sidebar sidebar-open"');
    expect(html).toContain('aria-label="Navegación principal"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('playlist-link-active');
    const buttons = elements(node).filter(({ type, props }) => type === 'button' && String(props.className).startsWith('nav-item'));
    buttons.forEach(({ props }) => (props.onClick as () => void)());
    expect(onNavigate.mock.calls.map(([view]) => view)).toEqual(['player', 'search', 'library', 'favorites', 'diagnostics']);
    const item = elements(node).find(({ props }) => String(props.className).includes('playlist-link-active'))!;
    (item.props.onClick as () => void)();
    expect(onOpenPlaylist).toHaveBeenCalledWith('playlist-a');
  });

  it.each([['', 'live', 'Sin servidor'], ['guild-a', 'live', 'En tiempo real'], ['guild-a', 'reconnecting', 'Reconectando'], ['guild-a', 'connecting', 'Conectando']])('shows header connectivity for %s / %s', (guildId, connection, expected) => {
    const html = renderToStaticMarkup(<Header session={session} view="favorites" guildId={guildId} connection={connection} onOpenNavigation={vi.fn()} />);
    expect(html).toContain(expected);
    expect(html).toContain('<strong>Favoritos</strong>');
    expect(tag(html, 'button', 'aria-label', 'Abrir navegación')).toContain('mobile-menu');
  });
});

describe('player and queue regression', () => {
  it.each([['playing', 'Reproduciendo'], ['paused', 'En pausa'], ['recovering', 'Recuperando audio'], ['blocked', 'Reproducción bloqueada'], ['idle', 'En espera']] as const)('preserves the %s player state', (status, label) => {
    const current = status === 'idle' ? null : track();
    const html = renderToStaticMarkup(<NowPlaying playback={playback({ state: snapshot({ status, current }) })} />);
    expect(html).toContain(label);
    expect(html).toContain('aria-label="Canción actual"');
    expect(tag(html, 'button', 'aria-label', 'Siguiente canción').includes('disabled=""')).toBe(status === 'blocked' || status === 'idle');
    if (status === 'paused') expect(html).toContain('Continuar');
    if (status === 'idle') expect(html).toContain('now-card-idle');
  });

  it('keeps progress semantics, clamps the fill and preserves an explicit zero volume draft', () => {
    const html = renderToStaticMarkup(<PlayerBar playback={playback({ state: snapshot({ currentTime: 30.7 }), volumeDraft: 0 })} onShowQueue={vi.fn()} />);
    const progress = tag(html, 'div', 'role', 'progressbar');
    expect(progress).toContain('aria-label="Progreso de la canción"');
    expect(progress).toContain('aria-valuemin="0"');
    expect(progress).toContain('aria-valuemax="120"');
    expect(progress).toContain('aria-valuenow="30"');
    expect(tag(html, 'input', 'id', 'volume')).toContain('value="0"');
    for (const [currentTime, width] of [[-5, '0'], [150, '100']]) {
      const edge = renderToStaticMarkup(<PlayerBar playback={playback({ state: snapshot({ currentTime: Number(currentTime) }) })} onShowQueue={vi.fn()} />);
      expect(edge).toContain(`style="width:${width}%"`);
    }
    const idle = renderToStaticMarkup(<PlayerBar playback={playback({ state: null, controlsDisabled: true })} onShowQueue={vi.fn()} />);
    expect(idle).toContain('aria-valuemax="0"');
    expect(idle).toContain('style="width:0%"');
    expect(tag(idle, 'button', 'aria-label', 'Continuar reproducción')).toContain('disabled=""');
  });

  it.each(['playing', 'paused'] as const)('dispatches the correct play/pause command while %s', async (status) => {
    const bindings = playback({ state: snapshot({ status, repeat: 2 }) });
    const node = PlayerBar({ playback: bindings, onShowQueue: vi.fn() });
    await click(node, status === 'playing' ? 'Pausar reproducción' : 'Continuar reproducción');
    await click(node, 'Repetición: cola. Cambiar modo');
    expect(bindings.action).toHaveBeenNthCalledWith(1, { action: status === 'playing' ? 'pause' : 'resume' });
    expect(bindings.action).toHaveBeenNthCalledWith(2, { action: 'repeat', mode: 0 });
  });

  it.each(['desktop', 'mobile'] as const)('commits %s volume on pointer and adjustment keys only', async (variant) => {
    const bindings = playback();
    const node = variant === 'desktop' ? PlayerBar({ playback: bindings, onShowQueue: vi.fn() }) : MobilePlaybackTools({ playback: bindings });
    const input = elements(node).find(({ type }) => type === 'input')!.props;
    const keyUp = input.onKeyUp as (event: { key: string; currentTarget: { value: string } }) => void;
    keyUp({ key: 'Tab', currentTarget: { value: '81' } });
    expect(bindings.action).not.toHaveBeenCalled();
    keyUp({ key: 'ArrowRight', currentTarget: { value: '81' } });
    (input.onPointerUp as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: '82' } });
    await Promise.resolve();
    expect(bindings.action).toHaveBeenNthCalledWith(1, { action: 'volume', volume: 81 });
    expect(bindings.action).toHaveBeenNthCalledWith(2, { action: 'volume', volume: 82 });
    expect(bindings.setVolumeDraft).toHaveBeenLastCalledWith(null);
    const html = renderToStaticMarkup(node);
    const id = variant === 'desktop' ? 'volume' : 'mobile-volume';
    expect(html).toContain(`for="${id}"`);
    expect(tag(html, 'input', 'id', id)).toContain('type="range"');
  });

  it('preserves row siblings and queue order, duration and drag/remove wiring', () => {
    const callbacks = actions();
    const tracks = [track('first'), track('middle'), track('last')];
    const html = renderToStaticMarkup(<TrackList tracks={tracks} context="queue" actions={callbacks} />);
    expect(html).toMatch(/^<div class="track-row"/);
    expect(html.match(/class="track-row"/g)).toHaveLength(3);
    expect(html).toContain('<span class="track-index-number">01</span>');
    expect(html).toContain('<span class="track-index-number">03</span>');
    expect(html.indexOf('Canción first')).toBeLessThan(html.indexOf('Canción middle'));
    const handle = tag(html, 'button', 'aria-label', 'Reordenar Canción first');
    expect(handle).toContain('aria-roledescription="sortable"');
    expect(handle).not.toContain('disabled=""');
    expect(html).not.toContain('aria-label="Subir');
    expect(html).not.toContain('aria-label="Bajar');
    const middle = TrackItem({ track: tracks[1], index: 1, context: 'queue', actions: callbacks });
    click(middle, 'Retirar Canción middle');
    click(middle, 'Guardar Canción middle en playlist');
    expect(callbacks.onRemove).toHaveBeenCalledWith(tracks[1], 1, undefined);
    expect(callbacks.onSave).toHaveBeenCalledWith(tracks[1]);
    const busy = renderToStaticMarkup(<TrackList tracks={tracks} context="queue" actions={actions({ busy: true })} />);
    expect(tag(busy, 'button', 'aria-label', 'Reordenar Canción middle')).toContain('disabled=""');
    const single = renderToStaticMarkup(<TrackList tracks={[tracks[0]]} context="queue" actions={callbacks} />);
    expect(tag(single, 'button', 'aria-label', 'Reordenar Canción first')).toContain('disabled=""');
    const queue = renderToStaticMarkup(<QueueSection state={snapshot({ queue: tracks })} controlsDisabled={false} onShuffle={vi.fn()} actions={callbacks} />);
    expect(queue).toContain('3 canciones · 6:00 de buena música');
  });

  it('gives duplicated queue entries unique sortable ids', () => {
    const repeated = track('same');
    expect(trackSortIds([repeated, track('other'), repeated, repeated])).toEqual([
      repeated.id,
      track('other').id,
      `${repeated.id}#1`,
      `${repeated.id}#2`,
    ]);
  });

  it('keeps playlist ownership and favorites without queue-only controls', () => {
    const saved = playlist();
    const callbacks = actions({ isFavorite: () => true });
    const row = TrackItem({ track: saved.tracks[1], index: 1, context: 'playlist', owner: saved, actions: callbacks });
    click(row, 'Retirar Canción track-b');
    expect(callbacks.onRemove).toHaveBeenCalledWith(saved.tracks[1], 1, saved);
    const sortable = renderToStaticMarkup(<TrackList tracks={saved.tracks} context="playlist" owner={saved} actions={callbacks} />);
    expect(sortable).toContain('aria-label="Reordenar Canción track-b"');
    const favorite = TrackItem({ track: saved.tracks[0], index: 0, context: 'favorites', actions: callbacks });
    click(favorite, 'Reproducir Canción track-a');
    click(favorite, 'Quitar de favoritos: Canción track-a');
    expect(callbacks.onPlay).toHaveBeenCalledWith(saved.tracks[0]);
    expect(callbacks.onToggleFavorite).toHaveBeenCalledWith(saved.tracks[0]);
    const html = renderToStaticMarkup(favorite);
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('aria-label="Reordenar');
    expect(html).not.toContain('aria-label="Retirar');
    expect(html).not.toContain('en playlist');
    const favorites = renderToStaticMarkup(<TrackList tracks={saved.tracks} context="favorites" actions={callbacks} />);
    expect(favorites).not.toContain('aria-label="Reordenar');
  });

  it('keeps collection actions busy and playback disabled until state is available', () => {
    const html = renderToStaticMarkup(<TrackItem track={track()} index={0} context="playlist" owner={playlist()} actions={actions({ busy: true, playbackReady: false })} />);
    for (const label of ['Reproducir Canción track-a', 'Guardar en favoritos: Canción track-a', 'Retirar Canción track-a']) {
      expect(tag(html, 'button', 'aria-label', label)).toContain('disabled=""');
    }
    const loading = renderToStaticMarkup(<QueueSection state={null} controlsDisabled onShuffle={vi.fn()} actions={actions()} />);
    expect(loading).toContain('role="status"');
    expect(loading).toContain('Sincronizando la cola…');
    const empty = renderToStaticMarkup(<QueueSection state={snapshot({ queue: [] })} controlsDisabled={false} onShuffle={vi.fn()} actions={actions()} />);
    expect(empty).toContain('Hay espacio para una más.');
  });
});

describe('feature view regression', () => {
  it('preserves the search input, submit and diagnostics actions without an extra wrapper', () => {
    const bindings = { playback: playback(), connection: 'live', query: 'Una canción', onQueryChange: vi.fn(), onAddToQueue: vi.fn(), onDiagnostics: vi.fn(), trackActions: actions() };
    const node = PlayerView(bindings);
    const html = renderToStaticMarkup(node);
    expect(html).toMatch(/^<form class="search-bar">/);
    expect(html).toContain('for="music-search"');
    expect(tag(html, 'input', 'id', 'music-search')).toContain('maxLength="500"');
    expect(tag(html, 'button', 'aria-label', 'Agregar a la cola')).not.toContain('disabled=""');
    const input = elements(node).find(({ props }) => props.id === 'music-search')!;
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Otra canción' } });
    expect(bindings.onQueryChange).toHaveBeenCalledWith('Otra canción');
    const form = elements(node).find(({ type }) => type === 'form')!;
    const event = { preventDefault: vi.fn() };
    (form.props.onSubmit as (event: unknown) => void)(event);
    expect(bindings.onAddToQueue).toHaveBeenCalledWith(event);
    const diagnostics = elements(node).find(({ props }) => props.onClick === bindings.onDiagnostics)!;
    (diagnostics.props.onClick as () => void)();
    expect(bindings.onDiagnostics).toHaveBeenCalledTimes(1);
    const blank = renderToStaticMarkup(<PlayerView {...bindings} query="   " />);
    expect(tag(blank, 'button', 'aria-label', 'Agregar a la cola')).toContain('disabled=""');
  });

  it('keeps library loading, empty, grid and selected playlist states', () => {
    const callbacks = actions();
    const saved = playlist();
    const loading = renderToStaticMarkup(<LibraryView library={library({ libraryLoading: true })} trackActions={callbacks} />);
    expect(loading).toContain('role="status"');
    expect(loading).toContain('Abriendo tu biblioteca…');
    expect(renderToStaticMarkup(<LibraryView library={library()} trackActions={callbacks} />)).toContain('Crear mi primera playlist');
    const grid = renderToStaticMarkup(<LibraryView library={library({ playlists: [saved] })} trackActions={callbacks} />);
    expect(grid).toContain('class="playlist-grid"');
    expect(tag(grid, 'div', 'role', 'button')).toContain('tabindex="0"');
    expect(grid).toContain('aria-label="Escuchar Noches sin prisa"');
    const detail = renderToStaticMarkup(<LibraryView library={library({ playlist: saved, playlists: [saved] })} trackActions={callbacks} />);
    expect(detail).toContain('<h2>Noches sin prisa</h2>');
    expect(detail).toContain('2 canciones · 4:00');
    expect(detail.match(/class="track-row"/g)).toHaveLength(2);
    expect(detail).toContain('aria-label="Renombrar playlist"');
    const empty = playlist({ tracks: [] });
    expect(renderToStaticMarkup(<LibraryView library={library({ playlist: empty })} trackActions={callbacks} />)).toContain('Una playlist llena de posibilidades');
  });

  it('retains playlist keyboard activation and stops play clicks from opening the card', () => {
    const saved = playlist();
    const bindings = library({ playlists: [saved] });
    const node = LibraryView({ library: bindings, trackActions: actions() });
    const card = elements(node).find(({ props }) => props.role === 'button')!;
    const keyDown = card.props.onKeyDown as (event: { key: string; preventDefault: () => void }) => void;
    const preventDefault = vi.fn();
    keyDown({ key: 'Tab', preventDefault });
    expect(bindings.onSelectPlaylist).not.toHaveBeenCalled();
    keyDown({ key: 'Enter', preventDefault });
    keyDown({ key: ' ', preventDefault });
    expect(bindings.onSelectPlaylist).toHaveBeenCalledTimes(2);
    expect(bindings.onSelectPlaylist).toHaveBeenLastCalledWith(saved.id);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    const stopPropagation = vi.fn();
    (control(node, 'Escuchar Noches sin prisa').onClick as (event: { stopPropagation: () => void }) => void)({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(bindings.onLoadPlaylist).toHaveBeenCalledWith(saved);
    expect(bindings.onSelectPlaylist).toHaveBeenCalledTimes(2);
  });

  it('keeps favorites loading, empty and saved-track variants', () => {
    const callbacks = actions();
    const loading = renderToStaticMarkup(<FavoritesView favorites={[]} libraryLoading trackActions={callbacks} />);
    expect(loading).toContain('role="status"');
    expect(loading).toContain('Buscando tus favoritas…');
    const empty = renderToStaticMarkup(<FavoritesView favorites={[]} libraryLoading={false} trackActions={callbacks} />);
    expect(empty).toContain('Aquí viven tus próximas favoritas');
    const saved = renderToStaticMarkup(<FavoritesView favorites={[track()]} libraryLoading={false} trackActions={callbacks} />);
    expect(saved).toContain('1 canciones que se quedan contigo.');
    expect(saved).toContain('aria-label="Reproducir Canción track-a"');
    expect(saved).not.toContain('aria-label="Retirar');
  });

  it('preserves diagnostics metrics, preload details, incident timestamps and refresh', () => {
    const refresh = vi.fn();
    const state = snapshot({ status: 'blocked', health: { connected: true, ping: 42, preload: { requested: 3, buffersReady: 2 } }, incidents: [{ code: 'AUDIO_BLOCKED', message: 'Espera antes de reintentar.', at: '2026-10-15T18:30:00.000Z' }] });
    const node = DiagnosticsView({ state, connection: 'reconnecting', refresh });
    const html = renderToStaticMarkup(node);
    expect(html).toContain('Reconectando');
    expect(html).toContain('Reproducción bloqueada');
    expect(html).toContain('<dt>Latencia</dt><dd>42 ms</dd>');
    expect(html).toContain('<h2>Precarga de audio</h2>');
    expect(html).toContain('<dt>Precargas solicitadas</dt><dd>3</dd>');
    expect(html).toContain('AUDIO_BLOCKED');
    expect(tag(html, 'time', 'dateTime', '2026-10-15T18:30:00.000Z')).toBeDefined();
    const update = elements(node).find(({ props }) => props.onClick === refresh)!;
    (update.props.onClick as () => void)();
    expect(refresh).toHaveBeenCalledOnce();
    const empty = renderToStaticMarkup(<DiagnosticsView state={null} connection="connecting" refresh={refresh} />);
    expect(empty).toContain('Esperando el estado del motor…');
    expect(empty).toContain('Todo en armonía.');
    expect(empty).not.toContain('<h2>Precarga de audio</h2>');
  });

  it.each(['playlist', 'save', 'add', 'delete'] as const)('retains %s dialog titles and required-field submission guards', (type) => {
    const saved = playlist();
    const modal = type === 'playlist' ? { type } : type === 'save' ? { type, track: track() } : { type, playlist: saved };
    const node = LibraryDialog({ dialog: dialog({ modal }) });
    const titles = { playlist: 'Una playlist, un mood.', save: 'Guardar en una playlist', add: 'Agregar a tu colección', delete: 'Eliminar playlist' };
    expect(node.props.title).toBe(titles[type]);
    const form = renderToStaticMarkup(node.props.children);
    expect(tag(form, 'button', 'type', 'submit').includes('disabled=""')).toBe(type !== 'delete');
    if (type === 'save') expect(form).toContain('Primero necesitas crear una playlist.');
    if (type === 'add') expect(tag(form, 'input', 'type', 'url')).toContain('required=""');
    if (type === 'playlist') expect(form).toContain('maxLength="100"');
  });

  it('keeps resolved-track previews, manual metadata callbacks, alerts and busy dialog protection', () => {
    const { id: _id, ...metadata } = track();
    const bindings = dialog({ modal: { type: 'add', playlist: playlist() }, name: 'Título manual', trackArtist: 'Artista manual', trackUrl: metadata.url, resolvedTrack: metadata, error: 'No se pudo guardar.' });
    const node = LibraryDialog({ dialog: bindings });
    const form = renderToStaticMarkup(node.props.children);
    expect(form).toContain('aria-live="polite"');
    expect(form).toContain('Datos detectados');
    expect(form).toContain('<strong>Título manual</strong>');
    expect(form).toContain('Artista manual · 2:00');
    expect(form).toContain('role="alert"');
    expect(tag(form, 'button', 'type', 'submit')).not.toContain('disabled=""');
    const inputs = elements(node.props.children).filter(({ type }) => type === 'input');
    (inputs[1].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Título ajustado' } });
    (inputs[2].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Artista ajustado' } });
    expect(bindings.onTrackTitleChange).toHaveBeenCalledWith('Título ajustado');
    expect(bindings.onTrackArtistChange).toHaveBeenCalledWith('Artista ajustado');
    node.props.onOpenChange(false);
    expect(bindings.onClose).toHaveBeenCalledOnce();
    const busy = LibraryDialog({ dialog: { ...bindings, busy: 'save' } });
    busy.props.onOpenChange(false);
    expect(bindings.onClose).toHaveBeenCalledOnce();
    expect(tag(renderToStaticMarkup(busy.props.children), 'button', 'type', 'submit')).toContain('disabled=""');
  });
});
