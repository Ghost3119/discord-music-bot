import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PlaybackSnapshot } from '../../lib/api';
import { playbackReceivedAt } from '../../lib/playback-receipt';
import { CLOCK_TICK_MS, PlaybackClock, type LyricsClockReading, type PlaybackConnection } from './playback-clock';

const monotonicNow = () => performance.now();

export function useLyricsClock(
  snapshot: PlaybackSnapshot | null,
  connection: PlaybackConnection,
  enabled = true,
): LyricsClockReading {
  const clock = useRef<PlaybackClock | null>(null);
  if (!clock.current) clock.current = new PlaybackClock();
  const lastSnapshot = useRef<PlaybackSnapshot | null | undefined>(undefined);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const [reading, setReading] = useState<LyricsClockReading>(() => clock.current!.read(monotonicNow()));

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useLayoutEffect(() => {
    const now = monotonicNow();
    const current = clock.current!;
    current.setConnection(connection, now);
    if (lastSnapshot.current !== snapshot) {
      current.accept(snapshot, connection, snapshot ? playbackReceivedAt(snapshot) ?? now : now, now);
      lastSnapshot.current = snapshot;
    }
    if (enabled && visible) {
      const next = current.read(now);
      setReading((previous) => previous.positionSeconds === next.positionSeconds && previous.discontinuity === next.discontinuity ? previous : next);
    }
  }, [snapshot, connection, enabled, visible]);

  useEffect(() => {
    const current = clock.current!;
    if (!enabled || !visible || !current.read(monotonicNow()).advancing) return;
    const timer = window.setInterval(() => {
      const next = current.read(monotonicNow());
      setReading((previous) => previous.positionSeconds === next.positionSeconds && previous.discontinuity === next.discontinuity ? previous : next);
      if (!next.advancing) window.clearInterval(timer);
    }, CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [snapshot, connection, enabled, visible]);

  return reading;
}
