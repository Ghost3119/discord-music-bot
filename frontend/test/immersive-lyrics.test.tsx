// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, type PlaybackSnapshot } from '../src/lib/api';
import { useLyrics } from '../src/features/lyrics/use-lyrics';
import { LyricsPanel } from '../src/features/lyrics/LyricsPanel';
import { snapshot, track } from './regression-fixtures';

vi.mock('../src/lib/api', async (original) => ({ ...(await original<typeof import('../src/lib/api')>()), api: vi.fn() }));
type Lyrics = ReturnType<typeof useLyrics>;
type Request = { path: string; signal?: AbortSignal | null; resolve: (data: unknown) => void; reject: (reason: unknown) => void };
let roots: Root[], requests: Request[], testId = 0;
const source = { name: 'LRCLIB' as const, url: 'https://lrclib.net' as const, recordId: 1 };
function response(state: PlaybackSnapshot, extra: Record<string, unknown> = {}) {
  return { guildId: state.guildId, trackId: state.current?.id ?? null, playbackId: state.playbackId ?? null, status: 'synced', source, lines: [{ timeMs: 0, text: 'Una línea original' }, { timeMs: 2000, text: 'El ritmo nos acompaña' }, { timeMs: 4000, text: 'Y vuelve a comenzar' }], ...extra };
}
async function harness(initial: PlaybackSnapshot | null, strict = false) {
  let state = initial, enabled = true, value!: Lyrics;
  function Harness() { value = useLyrics(state, enabled); return <output>{value.status}:{value.data?.status}:{value.error}</output>; }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const render = () => root.render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />);
  await act(async () => render());
  return { get value() { return value; }, root, container,
    async setState(next: PlaybackSnapshot | null) { state = next; await act(async () => render()); },
    async setEnabled(next: boolean) { enabled = next; await act(async () => render()); },
    async rerender() { await act(async () => render()); },
  };
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  roots = []; requests = []; testId += 1;
  vi.mocked(api).mockReset().mockImplementation((path, options) => new Promise((resolve, reject) => requests.push({ path, signal: options?.signal, resolve, reject })) as ReturnType<typeof api>);
});
afterEach(async () => {
  await act(async () => { roots.forEach((root) => root.unmount()); await vi.runOnlyPendingTimersAsync(); });
  document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers();
});
function state(overrides: Partial<PlaybackSnapshot> = {}) { return snapshot({ guildId: `lyrics-test-${testId}`, playbackId: 'instance-a', ...overrides }); }

describe('current lyrics lifecycle', () => {
  it('does not query idle playback or a closed view', async () => {
    const screen = await harness(state({ current: null, status: 'idle' }));
    expect(screen.value.status).toBe('idle'); expect(requests).toHaveLength(0);
    await screen.setEnabled(false); await screen.setState(state());
    expect(requests).toHaveLength(0);
  });
  it('shares one in-flight request under real StrictMode effects', async () => {
    const current = state(), screen = await harness(current, true);
    expect(requests).toHaveLength(1); expect(requests[0].signal?.aborted).toBe(false);
    await act(async () => requests[0].resolve(response(current)));
    expect(screen.value.data?.status).toBe('synced');
  });
  it('does not requery on two-second snapshots and uses a short cache across reopen', async () => {
    const current = state(), screen = await harness(current);
    await act(async () => requests[0].resolve(response(current)));
    await screen.setState({ ...current, currentTime: 42 });
    await screen.setEnabled(false); await screen.setEnabled(true);
    expect(requests).toHaveLength(1); expect(screen.value.data?.status).toBe('synced');
    await screen.setEnabled(false);
    await act(async () => vi.advanceTimersByTimeAsync(120_001));
    await screen.setEnabled(true); expect(requests).toHaveLength(2);
  });
  it('drops A immediately when B becomes current and ignores the late A result', async () => {
    const a = state(), b = state({ current: track('other'), playbackId: 'instance-b' }), screen = await harness(a);
    await screen.setState(b);
    expect(screen.value.data).toBeNull(); expect(screen.value.status).toBe('loading');
    await act(async () => requests[1].resolve(response(b)));
    await act(async () => requests[0].resolve(response(a)));
    expect(screen.value.data?.trackId).toBe('other');
  });
  it('does not let a late A error replace a successful B response', async () => {
    const a = state(), b = state({ current: track('other'), playbackId: 'instance-b' }), screen = await harness(a);
    await screen.setState(b); await act(async () => requests[1].resolve(response(b)));
    await act(async () => requests[0].reject(new Error('old failure')));
    expect(screen.value.status).toBe('ready'); expect(screen.value.error).toBe('');
  });
  it('invalidates the old identity when the guild changes', async () => {
    const a = state(), b = state({ guildId: `other-guild-${testId}`, playbackId: 'instance-b' }), screen = await harness(a);
    await screen.setState(b);
    expect(requests[1].path).toBe(`/api/guilds/${b.guildId}/lyrics/current`);
    await act(async () => requests[0].resolve(response(a)));
    expect(screen.value.data).toBeNull();
    await act(async () => requests[1].resolve(response(b)));
    expect(screen.value.data?.guildId).toBe(b.guildId);
  });
  it('distinguishes another playback of the same track', async () => {
    const a = state(), b = { ...a, playbackId: 'instance-again' }, screen = await harness(a);
    await act(async () => requests[0].resolve(response(a)));
    await screen.setState(b); expect(screen.value.data).toBeNull(); expect(requests).toHaveLength(2);
  });
  it('rejects a response whose authoritative identity no longer matches', async () => {
    const a = state(), screen = await harness(a);
    await act(async () => requests[0].resolve(response(a, { playbackId: 'new-instance' })));
    expect(screen.value.status).toBe('stale'); expect(screen.value.data).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(requests).toHaveLength(1);
    await act(async () => screen.value.retry()); expect(requests).toHaveLength(2);
  });
  it('aborts after unmount and never applies an eventual response', async () => {
    const current = state(), screen = await harness(current);
    await act(async () => screen.root.unmount()); roots = [];
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(requests[0].signal?.aborted).toBe(true);
    await act(async () => requests[0].resolve(response(current)));
    expect(screen.container.textContent).toBe('');
  });
  it('preserves a provider retry delay above one minute with no automatic retries', async () => {
    const current = state(), screen = await harness(current);
    await act(async () => requests[0].resolve(response(current, { status: 'temporary_error', retryAfterMs: 90_000 })));
    expect(screen.value.canRetry).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(60_001));
    expect(screen.value.canRetry).toBe(false); expect(requests).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(30_005));
    expect(screen.value.canRetry).toBe(true); expect(requests).toHaveLength(1);
    await act(async () => { screen.value.retry(); screen.value.retry(); });
    expect(requests).toHaveLength(2);
  });
  it('explains an expired session and disables a pointless lyrics retry', async () => {
    const screen = await harness(state());
    await act(async () => requests[0].reject(new ApiError('Expired', 401)));
    expect(screen.value.status).toBe('error'); expect(screen.value.error).toContain('Vuelve al dashboard');
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(screen.value.canRetry).toBe(false); expect(requests).toHaveLength(1);
  });
});

describe('lyrics presentation and follow behavior', () => {
  async function panel(extra: Record<string, unknown> = {}) {
    const current = state();
    let positionSeconds = 1, discontinuity = 0;
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    const render = () => root.render(<LyricsPanel snapshot={current} positionSeconds={positionSeconds} discontinuity={discontinuity} />);
    await act(async () => render()); await act(async () => requests[0].resolve(response(current, extra)));
    return { container, async position(value: number, jump = 0) { positionSeconds = value; discontinuity = jump; await act(async () => render()); } };
  }
  it('marks the current line without continuously announcing lyrics', async () => {
    const screen = await panel();
    expect(screen.container.querySelector('[aria-current="true"]')?.textContent).toBe('Una línea original');
    await screen.position(3);
    expect(screen.container.querySelector('[aria-current="true"]')?.textContent).toBe('El ritmo nos acompaña');
    expect(screen.container.querySelector('[aria-live]')).toBeNull();
  });
  it('renders plain lyrics with their original line breaks and no active line', async () => {
    const screen = await panel({ status: 'plain', plainLyrics: 'Verso original\nOtra línea' });
    expect(screen.container.querySelector('.immersive-plain-lyrics')?.textContent).toBe('Verso original\nOtra línea');
    expect(screen.container.textContent).toContain('Sin sincronización');
    expect(screen.container.querySelector('[aria-current]')).toBeNull();
  });
  it.each([
    ['rate_limited', 'limitó las consultas'],
    ['timeout', 'tardó demasiado'],
    ['unavailable', 'No se pudo conectar'],
    ['invalid_response', 'respuesta que no pudimos utilizar'],
    ['busy', 'otras consultas'],
  ])('explains the temporary %s reason', async (reason, text) => {
    const screen = await panel({ status: 'temporary_error', retryAfterMs: 2000, reason });
    expect(screen.container.textContent).toContain(text);
  });
  it.each([['instrumental', 'Esta pista es instrumental.'], ['not_found', 'No hay letras disponibles'], ['ambiguous', 'Sin una coincidencia confiable'], ['temporary_error', 'Las letras no están disponibles ahora']])('renders the explicit %s state', async (status, text) => {
    const screen = await panel({ status, retryAfterMs: 2000 });
    expect(screen.container.textContent).toContain(text);
  });
  it('suspends following on manual scroll and resumes only after the explicit action', async () => {
    const screen = await panel();
    const scroller = screen.container.querySelector<HTMLElement>('.immersive-lyrics-scroll')!;
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 400, height: 400 } as DOMRect);
    const scroll = vi.fn(); scroller.scrollTo = scroll;
    screen.container.querySelectorAll<HTMLElement>('[data-line-index]').forEach((line, index) => {
      line.getBoundingClientRect = () => ({ top: 300 + index * 80, bottom: 350 + index * 80, height: 50 } as DOMRect);
    });
    await screen.position(3); expect(scroll).toHaveBeenCalledTimes(1);
    await act(async () => scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 50 })));
    await screen.position(5); expect(scroll).toHaveBeenCalledTimes(1);
    const follow = screen.container.querySelector<HTMLButtonElement>('.immersive-follow')!;
    expect(follow.textContent).toBe('Seguir reproducción');
    await act(async () => follow.click()); expect(scroll).toHaveBeenCalledTimes(2);
  });
});
