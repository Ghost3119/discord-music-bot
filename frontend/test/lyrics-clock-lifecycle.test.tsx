// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackSnapshot } from '../src/lib/api';
import { markPlaybackReceived, playbackReceivedAt } from '../src/lib/playback-receipt';
import { useLyricsClock } from '../src/features/lyrics/use-lyrics-clock';
import type { PlaybackConnection } from '../src/features/lyrics/playback-clock';

function snapshot(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    guildId: 'guild-a', status: 'playing', current: { id: 'a', url: 'https://www.youtube.com/watch?v=a', title: 'Prueba', artist: 'SONORA', duration: 120, thumbnail: null, source: 'youtube' },
    playbackId: 'a', sequence: 1, currentTime: 10, queue: [], volume: 50, repeat: 0, voice: null, health: {}, incidents: [],
    ...overrides,
  };
}

let now: number;
let visibility: DocumentVisibilityState;
let roots: Root[];
let containers: HTMLElement[];
beforeEach(() => {
  now = 0;
  visibility = 'visible';
  roots = [];
  containers = [];
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => {
  act(() => roots.forEach((root) => root.unmount()));
  containers.forEach((container) => container.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount(initial: PlaybackSnapshot | null = snapshot(), strict = false) {
  let current = initial;
  let connection: PlaybackConnection = 'live';
  let enabled = true;
  let parentRenders = 0;
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  function Clock() {
    const reading = useLyricsClock(current, connection, enabled);
    return <output data-discontinuity={reading.discontinuity}>{reading.positionSeconds.toFixed(3)}</output>;
  }
  function Parent() { parentRenders++; return <Clock />; }
  const render = () => act(() => root.render(strict ? <StrictMode><Parent /></StrictMode> : <Parent />));
  render();
  return {
    container,
    position: () => Number(container.querySelector('output')!.textContent),
    parentRenders: () => parentRenders,
    update(state: PlaybackSnapshot | null, status: PlaybackConnection = connection) { current = state; connection = status; render(); },
    setEnabled(value: boolean) { enabled = value; render(); },
    unmount() { act(() => root.unmount()); roots = roots.filter((item) => item !== root); },
  };
}
function advance(ms: number) {
  act(() => { now += ms; vi.advanceTimersByTime(ms); });
}
function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  act(() => document.dispatchEvent(new Event('visibilitychange')));
}

describe('mounted lyrics clock lifecycle', () => {
  it('updates only the local clock subtree and cancels its timer when paused', () => {
    const view = mount();
    const parentRenders = view.parentRenders();
    expect(vi.getTimerCount()).toBe(1);
    advance(1000);
    expect(view.position()).toBe(11);
    expect(view.parentRenders()).toBe(parentRenders);
    view.update(snapshot({ sequence: 2, status: 'paused', currentTime: 11 }));
    expect(vi.getTimerCount()).toBe(0);
    advance(2000);
    expect(view.position()).toBe(11);
    view.update(snapshot({ sequence: 3, currentTime: 11 }));
    advance(1000);
    expect(view.position()).toBe(12);
  });

  it('stops background work when hidden or disabled and resumes from the monotonic estimate', () => {
    const view = mount();
    advance(1000);
    setVisibility('hidden');
    expect(vi.getTimerCount()).toBe(0);
    advance(1000);
    expect(view.position()).toBe(11);
    setVisibility('visible');
    expect(view.position()).toBe(12);
    expect(vi.getTimerCount()).toBe(1);
    view.setEnabled(false);
    expect(vi.getTimerCount()).toBe(0);
    advance(1000);
    expect(view.position()).toBe(12);
    view.setEnabled(true);
    expect(view.position()).toBe(13);
  });

  it('waits for fresh data after SSE reconnect instead of resuming an old snapshot', () => {
    const current = snapshot();
    const view = mount(current);
    advance(1000);
    view.update(current, 'reconnecting');
    advance(1000);
    expect(view.position()).toBe(11);
    view.update(current, 'live');
    expect(vi.getTimerCount()).toBe(0);
    advance(1000);
    expect(view.position()).toBe(11);
    view.update(markPlaybackReceived(snapshot({ sequence: 2, currentTime: 13 }), now));
    advance(1000);
    expect(view.position()).toBe(14);
  });

  it('cleans timer and visibility listener through StrictMode and unmount', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const view = mount(snapshot(), true);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    const registered = add.mock.calls.filter(([event]) => event === 'visibilitychange');
    const removed = remove.mock.calls.filter(([event]) => event === 'visibilitychange');
    expect(registered.length).toBeGreaterThan(0);
    expect(removed).toHaveLength(registered.length);
    for (const [, listener] of registered) expect(removed.some(([, removedListener]) => removedListener === listener)).toBe(true);
  });

  it('retains receipt metadata across reopen without serializing browser time', () => {
    const current = markPlaybackReceived(snapshot(), now);
    expect(playbackReceivedAt(current)).toBe(0);
    expect(JSON.stringify(current)).not.toContain('receivedAt');
    const first = mount(current);
    advance(1000);
    first.unmount();
    advance(1500);
    const reopened = mount(current);
    expect(reopened.position()).toBe(12.5);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('stops its interval after stale data and handles changing guilds without old progress', () => {
    const view = mount();
    advance(9000);
    expect(view.position()).toBe(18);
    expect(vi.getTimerCount()).toBe(0);
    view.update(snapshot({ guildId: 'guild-b', playbackId: 'b', currentTime: 2 }));
    expect(view.position()).toBe(2);
    advance(1000);
    expect(view.position()).toBe(3);
    view.update(null);
    expect(view.position()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
