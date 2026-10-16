import type { PlaybackSnapshot } from '../../lib/api';
import type { LyricsLine } from '../../../../src/web/lyrics/contracts';

/** Last matching line in a stable, time-sorted list. Equal times select the last source line. */
export function findActiveLine(lines: readonly LyricsLine[], timeMs: number): number {
  if (!Number.isFinite(timeMs) || timeMs < 0) return -1;
  let lower = 0;
  let upper = lines.length;
  while (lower < upper) {
    const middle = (lower + upper) >>> 1;
    if (lines[middle]!.timeMs <= timeMs) lower = middle + 1;
    else upper = middle;
  }
  return lower - 1;
}

export type PlaybackConnection = 'connecting' | 'live' | 'reconnecting';
export interface LyricsClockReading {
  positionSeconds: number;
  discontinuity: number;
}
export interface PlaybackClockReading extends LyricsClockReading {
  advancing: boolean;
}

export const CLOCK_DRIFT_THRESHOLD_MS = 750;
export const CLOCK_CORRECTION_WINDOW_MS = 2000;
export const CLOCK_STALE_AFTER_MS = 8000;
export const CLOCK_TICK_MS = 100;

interface Anchor {
  identity: string | null;
  guildId: string;
  positionMs: number;
  anchoredAt: number;
  receivedAt: number;
  durationMs: number | null;
  correctionMs: number;
  running: boolean;
  sequence?: number;
  sampledAt?: number;
  snapshotEpoch?: string;
}

const finite = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const clampPosition = (position: number, duration: number | null) => Math.min(duration ?? Infinity, Math.max(0, position));

/**
 * Presentation estimate only. All local times are performance.now() milliseconds.
 * sampledAt is compared only with earlier server sampledAt values, never with local time.
 */
export class PlaybackClock {
  private anchor: Anchor | null = null;
  private discontinuity = 0;

  read(now: number): PlaybackClockReading {
    const anchor = this.anchor;
    if (!anchor) return { positionSeconds: 0, discontinuity: this.discontinuity, advancing: false };
    const expiresAt = anchor.receivedAt + CLOCK_STALE_AFTER_MS;
    const elapsed = anchor.running ? Math.max(0, Math.min(now, expiresAt) - anchor.anchoredAt) : 0;
    const correction = anchor.correctionMs * Math.min(1, elapsed / CLOCK_CORRECTION_WINDOW_MS);
    const positionMs = clampPosition(anchor.positionMs + elapsed + correction, anchor.durationMs);
    return {
      positionSeconds: positionMs / 1000,
      discontinuity: this.discontinuity,
      advancing: anchor.running && now < expiresAt && (anchor.durationMs === null || positionMs < anchor.durationMs),
    };
  }

  /** Losing connectivity freezes immediately. Opening SSE alone cannot resume stale data. */
  setConnection(connection: PlaybackConnection, now: number): void {
    if (connection === 'live' || !this.anchor?.running) return;
    const positionMs = this.read(now).positionSeconds * 1000;
    this.anchor = { ...this.anchor, positionMs, anchoredAt: now, correctionMs: 0, running: false };
  }

  accept(snapshot: PlaybackSnapshot | null, connection: PlaybackConnection, receivedAt: number, now: number): boolean {
    if (!snapshot) {
      if (this.anchor?.identity) this.discontinuity++;
      this.anchor = null;
      return true;
    }
    const previous = this.anchor;
    const sameGuild = previous?.guildId === snapshot.guildId;
    const sameEpoch = previous?.snapshotEpoch === snapshot.snapshotEpoch;
    // Sequence is authoritative when available; legacy snapshots use only server-domain time.
    if (sameGuild && sameEpoch && previous) {
      if (finite(snapshot.sequence) && finite(previous.sequence)) {
        if (snapshot.sequence <= previous.sequence) return false;
      } else if (finite(snapshot.sampledAt) && finite(previous.sampledAt) && snapshot.sampledAt < previous.sampledAt) {
        return false;
      }
    }

    const track = snapshot.current;
    const identity = track ? `${snapshot.guildId}\u0000${snapshot.playbackId ?? `${track.source}:${track.id}:${track.url}`}` : null;
    const identityChanged = previous?.identity !== identity || !sameGuild || !sameEpoch;
    const durationMs = track && finite(track.duration) && track.duration > 0 ? track.duration * 1000 : null;
    const running = Boolean(track && snapshot.status === 'playing' && connection === 'live');
    const safeReceipt = Number.isFinite(receivedAt) ? Math.min(now, receivedAt) : now;
    const ageMs = running ? Math.min(CLOCK_STALE_AFTER_MS, Math.max(0, now - safeReceipt)) : 0;
    const authoritativeMs = track && finite(snapshot.currentTime) ? Math.max(0, snapshot.currentTime * 1000) : 0;
    const targetMs = clampPosition(authoritativeMs + ageMs, durationMs);
    const estimatedMs = previous ? this.read(now).positionSeconds * 1000 : targetMs;
    const differenceMs = targetMs - estimatedMs;
    const smooth = !identityChanged && previous?.running && running && Math.abs(differenceMs) <= CLOCK_DRIFT_THRESHOLD_MS;

    if (identityChanged || Math.abs(differenceMs) > CLOCK_DRIFT_THRESHOLD_MS) this.discontinuity++;
    this.anchor = {
      identity,
      guildId: snapshot.guildId,
      positionMs: smooth ? estimatedMs : targetMs,
      anchoredAt: now,
      receivedAt: safeReceipt,
      durationMs,
      correctionMs: smooth ? differenceMs : 0,
      running,
      sequence: snapshot.sequence,
      sampledAt: snapshot.sampledAt,
      snapshotEpoch: snapshot.snapshotEpoch,
    };
    return true;
  }
}
