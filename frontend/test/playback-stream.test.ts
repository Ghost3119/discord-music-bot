import { describe, expect, it, vi } from 'vitest';
import { ApiError, type PlaybackSnapshot } from '../src/lib/api';
import { connectPlayback, type StreamSource } from '../src/lib/playback-stream';

function snapshot(guildId = 'guild-a', title = 'Actual'): PlaybackSnapshot {
  return { guildId, status: 'playing', current: { id: 'track-1', url: 'https://www.youtube.com/watch?v=test', title, artist: 'Artista', duration: 120, thumbnail: null, source: 'youtube' }, queue: [], currentTime: 4, volume: 50, repeat: 0, voice: null, health: {}, incidents: [] };
}
class Source implements StreamSource {
  onopen: StreamSource['onopen'] = null;
  onerror: StreamSource['onerror'] = null;
  closed = false;
  listener: ((event: MessageEvent) => void) | undefined;
  addEventListener(_type: string, listener: (event: MessageEvent) => void) { this.listener = listener; }
  emit(state: PlaybackSnapshot) { this.listener?.({ data: JSON.stringify(state) } as MessageEvent); }
  close() { this.closed = true; }
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function harness(fetchState: (signal: AbortSignal) => Promise<PlaybackSnapshot>) {
  const source = new Source();
  const onState = vi.fn();
  const onError = vi.fn();
  const onConnection = vi.fn();
  const onInvalidate = vi.fn();
  const stream = connectPlayback({ guildId: 'guild-a', fetchState, createSource: () => source, onState, onError, onConnection, onInvalidate });
  return { source, stream, onState, onError, onConnection, onInvalidate };
}

describe('playback REST and SSE lifecycle', () => {
  it('loads initially and resynchronizes when SSE connects or reconnects', async () => {
    const fetchState = vi.fn().mockResolvedValue(snapshot());
    const { source, stream, onState, onConnection } = harness(fetchState);
    await settle();
    expect(onState).toHaveBeenCalledWith(snapshot());
    source.onopen?.(new Event('open'));
    await settle();
    expect(fetchState).toHaveBeenCalledTimes(2);
    expect(onConnection).toHaveBeenLastCalledWith('live');
    source.onerror?.(new Event('error'));
    await settle();
    expect(fetchState).toHaveBeenCalledTimes(3);
    expect(onConnection).toHaveBeenLastCalledWith('reconnecting');
    source.onopen?.(new Event('open'));
    await settle();
    expect(fetchState).toHaveBeenCalledTimes(4);
    stream.close();
  });

  it('never overwrites a newer SSE event with an older REST response', async () => {
    let resolve!: (state: PlaybackSnapshot) => void;
    const pending = new Promise<PlaybackSnapshot>((done) => { resolve = done; });
    const { source, stream, onState } = harness(() => pending);
    source.emit(snapshot('guild-a', 'Nueva canción'));
    resolve(snapshot('guild-a', 'Canción anterior'));
    await settle();
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState.mock.calls[0][0].current.title).toBe('Nueva canción');
    stream.close();
  });

  it('invalidates requests and closes EventSource when changing guild or logging out', async () => {
    let resolve!: (state: PlaybackSnapshot) => void;
    let signal!: AbortSignal;
    const pending = new Promise<PlaybackSnapshot>((done) => { resolve = done; });
    const { source, stream, onState } = harness((requestSignal) => { signal = requestSignal; return pending; });
    stream.close();
    resolve(snapshot());
    source.emit(snapshot());
    await settle();
    expect(signal.aborted).toBe(true);
    expect(source.closed).toBe(true);
    expect(source.onopen).toBeNull();
    expect(source.onerror).toBeNull();
    expect(onState).not.toHaveBeenCalled();
  });

  it('ignores snapshots belonging to a different guild', async () => {
    const { source, stream, onState } = harness(async () => snapshot('guild-b'));
    await settle();
    source.emit(snapshot('guild-b'));
    expect(onState).not.toHaveBeenCalled();
    source.emit(snapshot());
    expect(onState).toHaveBeenCalledTimes(1);
    stream.close();
  });

  it('detects session expiry through REST when EventSource hides its 401 response', async () => {
    const expired = new ApiError('La sesión expiró.', 401);
    const fetchState = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(expired);
    const { source, stream, onError } = harness(fetchState);
    await settle();
    source.onerror?.(new Event('error'));
    await settle();
    expect(onError).toHaveBeenCalledWith(expired);
    stream.close();
  });

  it('keeps the most recent REST refresh when requests resolve out of order', async () => {
    const resolvers: Array<(state: PlaybackSnapshot) => void> = [];
    const { stream, onState } = harness(() => new Promise((resolve) => resolvers.push(resolve)));
    void stream.refresh();
    resolvers[1](snapshot('guild-a', 'Nueva canción'));
    await settle();
    resolvers[0](snapshot('guild-a', 'Canción anterior'));
    await settle();
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState.mock.calls[0][0].current.title).toBe('Nueva canción');
    stream.close();
  });

  it('closes the revoked stream and clears stale state on a forbidden REST resync', async () => {
    const forbidden = new ApiError('Ya no tienes acceso a este servidor.', 403);
    const fetchState = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(forbidden);
    const { source, stream, onInvalidate, onError } = harness(fetchState);
    await settle();
    source.onerror?.(new Event('error'));
    await settle();
    expect(source.closed).toBe(true);
    expect(stream.closed).toBe(true);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(forbidden);
    await stream.refresh();
    expect(fetchState).toHaveBeenCalledTimes(2);
  });
});

describe('authoritative snapshot ordering', () => {
  it('rejects old or duplicated sequence without replacing track metadata or receipt', async () => {
    const { source, stream, onState } = harness(async () => snapshot());
    await settle();
    const state = { ...snapshot(), playbackId: 'new', snapshotEpoch: 'server-A', sequence: 10 };
    source.emit(state);
    source.emit({ ...state, current: { ...state.current!, title: 'Obsolete' }, sequence: 9 });
    source.emit({ ...state, sequence: 10 });
    expect(onState).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenLastCalledWith(state);
    stream.close();
  });
  it('accepts a new server epoch with a restarted sequence and resynchronizes metadata', async () => {
    const { source, stream, onState } = harness(async () => snapshot());
    await settle();
    source.emit({ ...snapshot(), playbackId: 'first', snapshotEpoch: 'server-A', sequence: 100 });
    const next = { ...snapshot(), playbackId: 'second', snapshotEpoch: 'server-B', sequence: 1 };
    source.emit(next);
    expect(onState).toHaveBeenLastCalledWith(next);
    stream.close();
  });
});
