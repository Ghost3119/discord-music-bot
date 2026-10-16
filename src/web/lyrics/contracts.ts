/** Lyrics are ephemeral, read-only presentation data; no provider secrets or media URLs. */
export interface LyricsQuery { title: string; artist: string; album?: string; duration: number }
export interface LyricsLine { timeMs: number; text: string }
export interface LyricsSource { name: 'LRCLIB'; url: 'https://lrclib.net'; recordId: number }
export type LyricsFailureReason = 'rate_limited' | 'timeout' | 'unavailable' | 'invalid_response' | 'busy';
export type LyricsResult =
  | { status: 'synced'; lines: LyricsLine[]; source: LyricsSource }
  | { status: 'plain'; plainLyrics: string; source: LyricsSource }
  | { status: 'instrumental'; source: LyricsSource }
  | { status: 'not_found' }
  | { status: 'ambiguous' }
  | { status: 'temporary_error'; retryAfterMs: number; reason?: LyricsFailureReason };
export type LyricsCurrentResponse = { guildId: string; trackId: string | null; playbackId: string | null } &
  (LyricsResult | { status: 'idle' | 'stale' });
export interface LyricsProvider { findLyrics(query: LyricsQuery, signal?: AbortSignal): Promise<LyricsResult> }
