import { useEffect, useSyncExternalStore } from 'react';
import type { LyricsCurrentResponse } from '../../../../src/web/lyrics/contracts';
import type { PlaybackSnapshot } from '../../lib/api';

export function lyricsIdentity(snapshot: PlaybackSnapshot | null) {
  return snapshot?.current ? JSON.stringify([snapshot.guildId, snapshot.current.id, snapshot.playbackId ?? null]) : '';
}
let activeKey = '';
let selection: { key: string; data: LyricsCurrentResponse } | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => listeners.forEach((listener) => listener());

/** RAM only: retained across immersive reopen, discarded on another playback. */
export function useManualLyrics(snapshot: PlaybackSnapshot | null, enabled = true) {
  const key = lyricsIdentity(snapshot);
  const data = useSyncExternalStore(subscribe, () => selection?.key === key ? selection.data : null, () => null);
  useEffect(() => {
    if (!enabled) return;
    activeKey = key;
    if (selection && selection.key !== key) { selection = null; notify(); }
  }, [key, enabled]);
  return data;
}

export function selectManualLyrics(snapshot: PlaybackSnapshot, data: LyricsCurrentResponse) {
  const key = lyricsIdentity(snapshot);
  if (!key || activeKey !== key || data.guildId !== snapshot.guildId || data.trackId !== snapshot.current?.id || data.playbackId !== (snapshot.playbackId ?? null)) return false;
  if (!['synced', 'plain', 'instrumental'].includes(data.status)) return false;
  selection = { key, data };
  notify();
  return true;
}

export function clearManualLyrics(snapshot: PlaybackSnapshot | null) {
  if (selection?.key !== lyricsIdentity(snapshot)) return;
  selection = null;
  notify();
}
