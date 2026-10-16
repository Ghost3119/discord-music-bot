import type { PlaybackSnapshot } from './api';

// Browser monotonic receipt times never enter REST/SSE contracts or persisted state.
const receipts = new WeakMap<PlaybackSnapshot, number>();

export function markPlaybackReceived(snapshot: PlaybackSnapshot, at = performance.now()): PlaybackSnapshot {
  receipts.set(snapshot, at);
  return snapshot;
}

export function playbackReceivedAt(snapshot: PlaybackSnapshot): number | undefined {
  return receipts.get(snapshot);
}
