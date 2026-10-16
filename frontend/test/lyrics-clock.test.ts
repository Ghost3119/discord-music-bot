import { describe, expect, it } from 'vitest';
import type { PlaybackSnapshot } from '../src/lib/api';
import { PlaybackClock, CLOCK_STALE_AFTER_MS } from '../src/features/lyrics/playback-clock';

function snapshot(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    guildId: 'guild-a', status: 'playing',
    current: { id: 'track-a', url: 'https://www.youtube.com/watch?v=a', title: 'Tema original', artist: 'SONORA', duration: 120, thumbnail: null, source: 'youtube' },
    playbackId: 'playback-a', snapshotEpoch: 'epoch-a', sequence: 1, sampledAt: 1700000000000,
    queue: [], currentTime: 10, volume: 50, repeat: 0, voice: null, health: {}, incidents: [],
    ...overrides,
  };
}

describe('monotonic presentation playback clock', () => {
  it('interpolates bot seconds using local monotonic milliseconds and clamps duration', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot(), 'live', 1000, 1000);
    expect(clock.read(3500).positionSeconds).toBe(12.5);
    clock.accept(snapshot({ sequence: 2, currentTime: 119 }), 'live', 3500, 3500);
    expect(clock.read(6000)).toMatchObject({ positionSeconds: 120, advancing: false });
  });

  it('freezes at the confirmed pause position and resumes from a fresh confirmation', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot(), 'live', 1000, 1000);
    clock.accept(snapshot({ sequence: 2, status: 'paused', currentTime: 12.4 }), 'live', 3500, 3500);
    expect(clock.read(9000)).toMatchObject({ positionSeconds: 12.4, advancing: false });
    clock.accept(snapshot({ sequence: 3, currentTime: 12.4 }), 'live', 10000, 10000);
    expect(clock.read(12000).positionSeconds).toBeCloseTo(14.4);
  });

  it.each(['recovering', 'blocked'] as const)('does not advance while %s', (status) => {
    const clock = new PlaybackClock();
    clock.accept(snapshot({ status }), 'live', 0, 0);
    expect(clock.read(5000)).toMatchObject({ positionSeconds: 10, advancing: false });
  });

  it('applies forward and backward seeks immediately with a discontinuity signal', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot(), 'live', 0, 0);
    const first = clock.read(1000).discontinuity;
    clock.accept(snapshot({ sequence: 2, currentTime: 45 }), 'live', 1000, 1000);
    expect(clock.read(1000)).toMatchObject({ positionSeconds: 45, discontinuity: first + 1 });
    clock.accept(snapshot({ sequence: 3, currentTime: 3 }), 'live', 2000, 2000);
    expect(clock.read(2000)).toMatchObject({ positionSeconds: 3, discontinuity: first + 2 });
  });

  it('resets when the same song is replayed, a different song shares its title, or the guild changes', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot(), 'live', 0, 0);
    let discontinuity = clock.read(0).discontinuity;
    clock.accept(snapshot({ playbackId: 'replay-a', sequence: 2, currentTime: 0 }), 'live', 1000, 1000);
    expect(clock.read(1000)).toMatchObject({ positionSeconds: 0, discontinuity: ++discontinuity });
    clock.accept(snapshot({ playbackId: 'playback-b', sequence: 3, currentTime: 0, current: { ...snapshot().current!, id: 'track-b' } }), 'live', 2000, 2000);
    expect(clock.read(2000).discontinuity).toBe(++discontinuity);
    clock.accept(snapshot({ guildId: 'guild-b', sequence: 1 }), 'live', 3000, 3000);
    expect(clock.read(3000)).toMatchObject({ positionSeconds: 10, discontinuity: ++discontinuity });
  });

  it('freezes on SSE loss and requires a new snapshot after connection opens', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot(), 'live', 1000, 1000);
    clock.setConnection('reconnecting', 3000);
    expect(clock.read(6000)).toMatchObject({ positionSeconds: 12, advancing: false });
    clock.setConnection('live', 6000);
    expect(clock.read(8000)).toMatchObject({ positionSeconds: 12, advancing: false });
    clock.accept(snapshot({ sequence: 2, currentTime: 18 }), 'live', 9000, 9000);
    expect(clock.read(10000)).toMatchObject({ positionSeconds: 19, advancing: true });
  });

  it('never advances reconnecting REST snapshots even when their bot status is playing', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot(), 'reconnecting', 0, 0);
    expect(clock.read(5000)).toMatchObject({ positionSeconds: 10, advancing: false });
  });

  it('rejects old or duplicate sequence data without changing position or playback identity', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot({ sequence: 10 }), 'live', 0, 0);
    expect(clock.accept(snapshot({ sequence: 9, playbackId: 'old', currentTime: 90 }), 'live', 1000, 1000)).toBe(false);
    expect(clock.accept(snapshot({ sequence: 10, currentTime: 90 }), 'live', 1500, 1500)).toBe(false);
    expect(clock.read(2000).positionSeconds).toBe(12);
  });

  it('accepts a restarted backend with a new epoch even when its sequence and server time are lower', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot({ sequence: 100 }), 'live', 0, 0);
    const old = clock.read(1000).discontinuity;
    expect(clock.accept(snapshot({ sequence: 1, snapshotEpoch: 'epoch-b', sampledAt: 1000, playbackId: 'after-restart', currentTime: 2 }), 'live', 1000, 1000)).toBe(true);
    expect(clock.read(1000)).toMatchObject({ positionSeconds: 2, discontinuity: old + 1 });
  });

  it('compares fallback server timestamps only within their own temporal domain', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot({ sequence: undefined, sampledAt: 9999999999999 }), 'live', 10, 10);
    expect(clock.accept(snapshot({ sequence: undefined, sampledAt: 1, currentTime: 100 }), 'live', 100, 100)).toBe(false);
    expect(clock.read(1010).positionSeconds).toBe(11);
  });

  it.each([600, -600])('slews a small %ims drift within two seconds without jumping', (difference) => {
    const clock = new PlaybackClock();
    clock.accept(snapshot(), 'live', 1000, 1000);
    const old = clock.read(3000).discontinuity;
    clock.accept(snapshot({ sequence: 2, currentTime: 12 + difference / 1000 }), 'live', 3000, 3000);
    expect(clock.read(3000)).toMatchObject({ positionSeconds: 12, discontinuity: old });
    expect(clock.read(4000).positionSeconds).toBeCloseTo(13 + difference / 2000);
    expect(clock.read(5000).positionSeconds).toBeCloseTo(14 + difference / 1000);
  });

  it('corrects large drift immediately rather than smoothing a seek', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot(), 'live', 0, 0);
    clock.accept(snapshot({ sequence: 2, currentTime: 12 }), 'live', 1000, 1000);
    expect(clock.read(1000).positionSeconds).toBe(12);
  });

  it('freezes after eight seconds without confirmation and resumes with fresh bot data', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot(), 'live', 1000, 1000);
    expect(clock.read(1000 + CLOCK_STALE_AFTER_MS + 1000)).toMatchObject({ positionSeconds: 18, advancing: false });
    clock.accept(snapshot({ sequence: 2, currentTime: 25 }), 'live', 11000, 11000);
    expect(clock.read(12000)).toMatchObject({ positionSeconds: 26, advancing: true });
  });

  it('uses original browser receipt time when reopening the panel between SSE updates', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot(), 'live', 1000, 3500);
    expect(clock.read(3500).positionSeconds).toBe(12.5);
  });

  it('clears on stop and tolerates unknown duration or invalid positions', () => {
    const clock = new PlaybackClock();
    clock.accept(snapshot({ current: { ...snapshot().current!, duration: 0 }, currentTime: NaN }), 'live', 0, 0);
    expect(clock.read(2000).positionSeconds).toBe(2);
    clock.accept(snapshot({ sequence: 2, current: null, status: 'idle' }), 'live', 2000, 2000);
    expect(clock.read(5000)).toMatchObject({ positionSeconds: 0, advancing: false });
    clock.accept(null, 'connecting', 5000, 5000);
    expect(clock.read(6000)).toMatchObject({ positionSeconds: 0, advancing: false });
  });
});
