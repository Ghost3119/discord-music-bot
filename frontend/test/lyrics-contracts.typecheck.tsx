import type { LyricsCurrentResponse, LyricsResult } from '../../src/web/lyrics/contracts';
const source = { name: 'LRCLIB' as const, url: 'https://lrclib.net' as const, recordId: 1 };
const synced: LyricsResult = { status: 'synced', lines: [{ timeMs: 1000, text: 'Original test line' }], source };
const response: LyricsCurrentResponse = { guildId: 'guild', trackId: 'track', playbackId: 'instance', ...synced };
// @ts-expect-error synchronized lyrics require numeric timestamps, not seconds as text
const badTimestamp: LyricsResult = { status: 'synced', lines: [{ timeMs: '1', text: 'Test' }], source };
// @ts-expect-error plain lyrics cannot use synchronized line fields instead of text
const badPlain: LyricsResult = { status: 'plain', lines: [], source };
// @ts-expect-error a provider error requires a retry delay
const badError: LyricsResult = { status: 'temporary_error' };
// @ts-expect-error a current lookup must carry its playback instance identity
const missingIdentity: LyricsCurrentResponse = { guildId: 'guild', trackId: 'track', status: 'idle' };
// @ts-expect-error stale responses never carry old lyrics
const staleText: LyricsCurrentResponse = { guildId: 'guild', trackId: 'track', playbackId: 'new', status: 'stale', plainLyrics: 'Old' };
void [response, badTimestamp, badPlain, badError, missingIdentity, staleText];
