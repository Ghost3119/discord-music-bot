// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, type PlaybackSnapshot } from '../src/lib/api';
import { LyricsPanel } from '../src/features/lyrics/LyricsPanel';
import { useLyrics } from '../src/features/lyrics/use-lyrics';
import { snapshot, track } from './regression-fixtures';

vi.mock('../src/lib/api', async (original) => ({ ...(await original<typeof import('../src/lib/api')>()), api: vi.fn() }));
type Request = { path: string; signal?: AbortSignal | null; resolve: (data: unknown) => void; reject: (error: unknown) => void };
let roots: Root[], requests: Request[], sequence = 0;
const source = { name: 'LRCLIB', url: 'https://lrclib.net', recordId: 42 };
const candidate = { id: 42, title: 'Canción elegida', artist: 'Artista', album: 'Álbum', duration: 120, synced: true, plain: true, instrumental: false };
const identity = (state: PlaybackSnapshot) => ({ guildId: state.guildId, trackId: state.current?.id ?? null, playbackId: state.playbackId ?? null });
const result = (state: PlaybackSnapshot, status = 'synced') => ({ ...identity(state), status, source, plainLyrics: 'Una letra original\nSegunda línea', lines: [{ timeMs: 0, text: 'Primera línea original' }, { timeMs: 2000, text: 'Segunda línea original' }] });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
const settle = async (request: Request, data: unknown) => { await act(async () => request.resolve(data)); };
const submit = async () => { await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); };

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); roots = []; requests = []; sequence++;
  vi.mocked(api).mockReset().mockImplementation((path, options) => new Promise((resolve, reject) => requests.push({ path, signal: options?.signal, resolve, reject })) as ReturnType<typeof api>);
});
afterEach(async () => {
  await act(async () => { roots.forEach((root) => root.unmount()); await vi.runOnlyPendingTimersAsync(); });
  document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers();
});
async function screen(injected = false, automatic = 'not_found') {
  let state = snapshot({ guildId: `manual-${sequence}`, playbackId: 'play-a' }), open = true, position = 0;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  function Harness() {
    const query = useLyrics(state, open && !injected);
    const fixture = { status: 'ready' as const, data: { ...identity(state), status: 'not_found' as const }, error: '', canRetry: false, retry: vi.fn() };
    return <><input data-outside aria-label="Fuera" /><output>{query.data?.status}</output>{open && <LyricsPanel snapshot={state} positionSeconds={position} discontinuity={0} lyricsQuery={injected ? fixture : query} />}</>;
  }
  const render = () => root.render(<StrictMode><Harness /></StrictMode>);
  await act(async () => render());
  if (!injected) { expect(requests).toHaveLength(1); await settle(requests[0], automatic === 'plain' ? result(state, 'plain') : { ...identity(state), status: automatic }); }
  return { container, get state() { return state; }, async update(next: Partial<PlaybackSnapshot>) { state = { ...state, ...next }; await act(async () => render()); }, async visible(value: boolean) { open = value; await act(async () => render()); }, async position(value: number) { position = value; await act(async () => render()); } };
}
async function search(current: PlaybackSnapshot, candidates = [candidate]) {
  button('Buscar letras manualmente').focus(); await click('Buscar letras manualmente');
  await submit();
  const request = requests.at(-1)!;
  expect(request.path).toContain('/lyrics/search?');
  await settle(request, { ...identity(current), status: 'results', candidates });
}

describe('manual lyrics discovery and lifecycle', () => {
  it('offers manual search for an automatic plain fallback while preserving its lyrics', async () => {
    const view = await screen(false, 'plain');
    expect(view.container.textContent).toContain('Sin sincronización');
    expect(button('Buscar letras manualmente')).toBeDefined();
    await click('Buscar letras manualmente'); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(view.container.querySelector('.immersive-plain-lyrics')).not.toBeNull();
  });
  it('edits detected metadata, encodes search, traps focus, closes with Escape and restores trigger', async () => {
    const view = await screen();
    button('Buscar letras manualmente').focus(); const trigger = document.activeElement;
    await click('Buscar letras manualmente');
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    const fields = dialog.querySelectorAll('input');
    expect(fields[0].value).toBe(view.state.current?.title); expect(fields[1].value).toBe('Artista');
    await act(async () => view.container.querySelector<HTMLInputElement>('[data-outside]')!.focus());
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(fields[0], 'Título & versión');
      fields[0].dispatchEvent(new Event('input', { bubbles: true }));
    });
    await submit();
    expect(new URL(requests.at(-1)!.path, 'http://local').searchParams.get('title')).toBe('Título & versión');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
    expect(requests.at(-1)!.signal?.aborted).toBe(true);
    await settle(requests.at(-1)!, { ...identity(view.state), status: 'results', candidates: [candidate] });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('selects synchronized lyrics, publishes to other hook consumers and restores automatic lookup', async () => {
    const view = await screen(); await search(view.state);
    expect(document.querySelector('.lyrics-search-results')?.textContent).toContain('Álbum · 2:00');
    await click('Elegir'); const request = requests.at(-1)!;
    expect(request.path).toContain('/lyrics/selection?'); expect(request.path).toContain('recordId=42');
    await settle(request, result(view.state));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(view.container.querySelector('output')?.textContent).toBe('synced');
    expect(view.container.querySelector('[aria-current="true"]')?.textContent).toBe('Primera línea original');
    await view.position(3); expect(view.container.querySelector('[aria-current="true"]')?.textContent).toBe('Segunda línea original');
    const count = requests.length;
    await view.visible(false); await view.visible(true); await view.update({ currentTime: 45 });
    expect(view.container.querySelector('output')?.textContent).toBe('synced'); expect(requests).toHaveLength(count);
    await click('Volver a búsqueda automática');
    expect(view.container.querySelector('output')?.textContent).toBe('not_found'); expect(requests).toHaveLength(count);
  });
  it('aligns the active lyric immediately when selecting synchronized lyrics mid-song', async () => {
    const view = await screen(); await view.position(30);
    const scroller = view.container.querySelector<HTMLElement>('.immersive-lyrics-scroll')!;
    scroller.scrollTo = vi.fn((options: ScrollToOptions) => { scroller.scrollTop = options.top ?? 0; }) as typeof scroller.scrollTo;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === scroller) return { top: 0, bottom: 400, height: 400 } as DOMRect;
      const index = this.getAttribute('data-line-index');
      if (index !== null) { const top = Number(index) * 90 - scroller.scrollTop; return { top, bottom: top + 50, height: 50 } as DOMRect; }
      return { top: 0, bottom: 0, height: 0 } as DOMRect;
    });
    await search(view.state); await click('Elegir');
    await settle(requests.at(-1)!, { ...result(view.state), lines: Array.from({ length: 20 }, (_, index) => ({ timeMs: index * 2000, text: `Verso original ${index}` })) });
    const active = scroller.querySelector<HTMLElement>('[aria-current="true"]')!;
    expect(active.textContent).toBe('Verso original 15');
    expect(scroller.scrollTop).toBeGreaterThan(1000);
    expect(active.getBoundingClientRect().top).toBeGreaterThanOrEqual(120);
    expect(active.getBoundingClientRect().bottom).toBeLessThanOrEqual(240);
  });
  it('renders plain manual lyrics with an injected automatic query without issuing automatic requests', async () => {
    const view = await screen(true); expect(requests).toHaveLength(0);
    await search(view.state, [{ ...candidate, synced: false }]); await click('Elegir');
    await settle(requests.at(-1)!, result(view.state, 'plain'));
    expect(view.container.textContent).toContain('Sin sincronización');
    expect(view.container.querySelector('.immersive-plain-lyrics')?.textContent).toContain('Una letra original\nSegunda línea');
    expect(view.container.querySelector('[aria-current]')).toBeNull();
    await click('Volver a búsqueda automática'); expect(view.container.textContent).toContain('No encontramos letras');
    expect(requests).toHaveLength(2);
  });
  it('requires explicit confirmation for incompatible versions and duration', async () => {
    const view = await screen(); await search(view.state, [{ ...candidate, duration: 200, warning: 'La versión es diferente; podría estar desincronizada.' }]);
    const count = requests.length; await click('Elegir'); expect(requests).toHaveLength(count);
    expect(document.querySelector('.lyrics-search-confirmation')?.textContent).toContain('desincronizada');
    await click('Cancelar'); expect(document.querySelector('.lyrics-search-confirmation')).toBeNull();
    await click('Elegir'); await click('Usar esta versión'); expect(requests).toHaveLength(count + 1);
    await settle(requests.at(-1)!, result(view.state, 'plain'));
    expect(view.container.textContent).toContain('Sin sincronización');
  });
  it.each(['skip', 'repeat', 'guild'])('aborts and discards late selection on %s', async (change) => {
    const view = await screen(); const previous = view.state; await search(view.state); await click('Elegir');
    const oldSelection = requests.at(-1)!;
    await view.update(change === 'skip' ? { current: track('next'), playbackId: 'play-b' } : change === 'repeat' ? { playbackId: 'play-again' } : { guildId: `other-${sequence}` });
    expect(oldSelection.signal?.aborted).toBe(true); expect(document.querySelector('[role="dialog"]')).toBeNull();
    await settle(oldSelection, result(previous)); expect(view.container.querySelector('.immersive-lyric-lines')).toBeNull();
    await settle(requests.at(-1)!, { ...identity(view.state), status: 'not_found' });
    await view.update(identity(previous).guildId === view.state.guildId ? { current: previous.current, playbackId: previous.playbackId } : { guildId: previous.guildId });
    expect(view.container.querySelector('.immersive-lyric-lines')).toBeNull();
  });
  it('closes a pending search on guild change and never resurrects its dialog or results', async () => {
    const view = await screen(), old = view.state;
    await click('Buscar letras manualmente'); await submit(); const oldSearch = requests.at(-1)!;
    await view.update({ guildId: `new-${sequence}` });
    expect(oldSearch.signal?.aborted).toBe(true); expect(document.querySelector('[role="dialog"]')).toBeNull();
    await settle(oldSearch, { ...identity(old), status: 'results', candidates: [candidate] });
    await view.update({ guildId: old.guildId });
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(view.container.textContent).not.toContain(candidate.title);
  });
  it('discards an applied manual selection after another playback even when returning to its previous identity', async () => {
    const view = await screen(), old = view.state;
    await search(old); await click('Elegir'); await settle(requests.at(-1)!, result(old));
    await view.update({ playbackId: 'new-playback' });
    expect(view.container.querySelector('.immersive-lyric-lines')).toBeNull();
    await view.update({ playbackId: old.playbackId });
    expect(view.container.querySelector('.immersive-lyric-lines')).toBeNull();
    expect(view.container.querySelector('output')?.textContent).toBe('not_found');
  });
  it('does not apply a selected response with mismatched identity', async () => {
    const view = await screen(); await search(view.state); await click('Elegir');
    await settle(requests.at(-1)!, { ...result(view.state), playbackId: 'wrong-instance' });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('La canción cambió');
    expect(view.container.querySelector('.immersive-lyric-lines')).toBeNull();
  });
  it('keeps temporary failures retryable after Retry-After without automatic calls or treating them as absence', async () => {
    const view = await screen(); await click('Buscar letras manualmente'); await submit();
    const count = requests.length;
    await settle(requests.at(-1)!, { ...identity(view.state), status: 'temporary_error', reason: 'rate_limited', retryAfterMs: 90_000 });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('limitó las consultas');
    expect(button('Volver a buscar').disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(90_010));
    expect(button('Volver a buscar').disabled).toBe(false); expect(requests).toHaveLength(count);
    await submit(); await settle(requests.at(-1)!, { ...identity(view.state), status: 'results', candidates: [] });
    expect(document.querySelector('.lyrics-search-results')?.textContent).toContain('No encontramos resultados');
  });
  it('shows recoverable selection errors and prevents retries after access expires', async () => {
    const view = await screen(); await search(view.state); await click('Elegir');
    await act(async () => requests.at(-1)!.reject(new Error('network')));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Vuelve a intentarlo');
    await act(async () => vi.advanceTimersByTimeAsync(2005)); await click('Elegir');
    await act(async () => requests.at(-1)!.reject(new ApiError('denied', 403)));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Vuelve al dashboard');
    await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(button('Elegir').disabled).toBe(true);
  });
  it('treats HTTP429 from the route limiter as a technical cooldown without automatic retries', async () => {
    await screen(); await click('Buscar letras manualmente'); await submit(); const count = requests.length;
    await act(async () => requests.at(-1)!.reject(new ApiError('limit', 429)));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('limitó las consultas');
    await act(async () => vi.advanceTimersByTimeAsync(59_000)); expect(button('Volver a buscar').disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1010)); expect(button('Volver a buscar').disabled).toBe(false);
    expect(requests).toHaveLength(count);
  });
  it('does not clear a shared automatic flight when just one subscriber unmounts', async () => {
    const state = snapshot({ guildId: `shared-${sequence}`, playbackId: 'shared' }); let first = true;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); roots.push(root);
    function Consumer() { const query = useLyrics(state); return <span>{query.data?.status}</span>; }
    const render = () => root.render(<StrictMode>{first && <Consumer key="first" />}<Consumer key="second" /></StrictMode>);
    await act(async () => render()); expect(requests).toHaveLength(1);
    first = false; await act(async () => render()); await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(requests[0].signal?.aborted).toBe(false);
    await settle(requests[0], result(state)); expect(container.textContent).toBe('synced');
  });
});
