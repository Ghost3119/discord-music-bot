/** Lyrics are ephemeral, read-only presentation data; no provider secrets or media URLs. */
export interface LyricsQuery { title: string; artist: string; album?: string; duration: number; durationReliable?: boolean }
export interface LyricsLine { timeMs: number; text: string }
export interface LyricsSource { name: 'LRCLIB'; url: 'https://lrclib.net'; recordId: number }
export type LyricsFailureReason = 'rate_limited' | 'timeout' | 'connection' | 'unavailable' | 'invalid_response' | 'busy';
export interface LyricsDiagnostics { stage: 'exact' | 'normalized' | 'plain_fallback'; decision: 'matched' | 'no_candidates' | 'metadata_rejected' | 'conflicting_content' | 'conflicting_timestamps' | 'duration_plain_fallback'; candidateCount: number; rejectedCount: number }
export type LyricsResult = { diagnostics?: LyricsDiagnostics; warning?: string } & (
  | { status: 'synced'; lines: LyricsLine[]; source: LyricsSource }
  | { status: 'plain'; plainLyrics: string; source: LyricsSource }
  | { status: 'instrumental'; source: LyricsSource }
  | { status: 'not_found' }
  | { status: 'ambiguous' }
  | { status: 'temporary_error'; retryAfterMs: number; reason?: LyricsFailureReason });
export interface LyricsCandidate {
  id: number; title: string; artist: string; album: string; duration: number | null;
  synced: boolean; plain: boolean; instrumental: boolean; warning?: string;
}
export type LyricsSearchResult = { status: 'results'; candidates: LyricsCandidate[] } | Extract<LyricsResult, { status: 'temporary_error' }>;
export type LyricsCurrentResponse = { guildId: string; trackId: string | null; playbackId: string | null } &
  (LyricsResult | { status: 'idle' | 'stale' });
export type LyricsSearchResponse = { guildId: string; trackId: string | null; playbackId: string | null } &
  (LyricsSearchResult | { status: 'idle' | 'stale' });
export interface LyricsProvider { findLyrics(query: LyricsQuery, signal?: AbortSignal): Promise<LyricsResult> }
