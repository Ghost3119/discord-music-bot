import { randomBytes } from 'node:crypto';
import { Queue, Song } from 'distube';

export type PlaybackMode = 'preparing' | 'playing' | 'paused' | 'recovering' | 'alternative' | 'blocked' | 'ended' | 'disconnected';
export interface PlaybackState {
  session: string;
  mode: PlaybackMode;
  attempt: number;
  failures: number[];
  blocked: boolean;
  closing: boolean;
  probe: boolean;
  busy: number;
  revision: number;
  lastError: { code: string; reference: string; time: number } | undefined;
  errorSong: Song | undefined;
  lastProgress: number | undefined;
  resource: object | undefined;
  song: Song | undefined;
  frames: number;
  observedAt: number;
  waiting: number;
  continuous: number;
  stalled: boolean;
}
const states = new WeakMap<Queue, PlaybackState>();
export function getPlaybackState(queue: Queue): PlaybackState | undefined { return states.get(queue); }
export function initPlaybackState(queue: Queue, now = Date.now()): PlaybackState {
  const existing = states.get(queue);
  if (existing) return existing;
  const state: PlaybackState = { session: randomBytes(8).toString('hex'), mode: 'preparing', attempt: 0, failures: [], blocked: false,
    closing: false, probe: false, busy: 0, revision: 0, lastError: undefined, errorSong: undefined, lastProgress: undefined, resource: undefined, song: undefined,
    frames: 0, observedAt: now, waiting: 0, continuous: 0, stalled: false };
  states.set(queue, state); return state;
}
export const playbackLabels: Record<PlaybackMode, string> = {
  preparing: '⏳ Preparando audio', playing: '▶ Reproduciendo', paused: '⏸ En pausa', recovering: '🔄 Recuperando audio',
  alternative: '🔎 Buscando alternativa', blocked: '🛑 Pausado por fallos', ended: '✓ Cola terminada', disconnected: '🔌 Desconectado',
};
export function playbackLabel(queue: Queue): string {
  const state = getPlaybackState(queue);
  return state?.blocked ? playbackLabels.blocked : queue.paused ? playbackLabels.paused : playbackLabels[state?.mode ?? 'playing'];
}
export function markQueueEdited(queue: Queue): void {
  const state = getPlaybackState(queue);
  if (state) state.revision++;
}
export function resetObservation(queue: Queue, now = Date.now()): void {
  const state = getPlaybackState(queue);
  if (!state) return;
  state.resource = undefined; state.waiting = 0; state.continuous = 0; state.stalled = false; state.observedAt = now;
}
