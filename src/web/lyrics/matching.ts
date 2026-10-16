import type { LyricsQuery, LyricsResult, LyricsSource } from './contracts';
import { parseLrc } from './lrc';

export interface LyricsRecord {
  id: number; trackName: string; artistName: string; albumName: string; duration: number;
  instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null;
}
const promotional = /\s*[\[(](?:official(?:\s+(?:music|lyric))?\s+(?:video|audio|lyrics?)|lyrics?(?:\s+video)?|visuali[sz]er|hd|4k)[\])]\s*/gi;
const editions = /\b(remix|cover|live|acoustic|instrumental|nightcore|sped\s*up|slowed(?:\s*(?:down|and\s+reverb))?)\b/gi;
export function normalizeLyricsName(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
export function cleanLyricsQuery(query: LyricsQuery): LyricsQuery {
  const artist = query.artist.trim().replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  let title = query.title.replace(promotional, ' ').trim();
  const split = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (split && normalizeLyricsName(split[1]!) === normalizeLyricsName(artist)) title = split[2]!.trim();
  return { title, artist, duration: query.duration, ...(query.album ? { album: query.album.trim() } : {}) };
}
function editionSignature(value: string): string {
  return [...new Set([...value.matchAll(editions)].map(match => normalizeLyricsName(match[0]).replace(/^slowed.*/, 'slowed')))].sort().join('|');
}
export function isLyricsRecord(value: unknown): value is LyricsRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const text = (field: string, max: number, empty = false): boolean => typeof record[field] === 'string' && (empty || (record[field] as string).trim().length > 0) && (record[field] as string).length <= max;
  const lyrics = (field: string, max: number): boolean => record[field] === null || text(field, max, true);
  return Number.isSafeInteger(record['id']) && (record['id'] as number) > 0 && text('trackName', 300) && text('artistName', 300) && text('albumName', 300, true)
    && typeof record['duration'] === 'number' && Number.isFinite(record['duration']) && record['duration'] > 0 && record['duration'] <= 86_400
    && typeof record['instrumental'] === 'boolean' && lyrics('plainLyrics', 50_000) && lyrics('syncedLyrics', 100_000)
    && (!record['instrumental'] || (!record['plainLyrics'] && !record['syncedLyrics']));
}
function resultFor(record: LyricsRecord): LyricsResult {
  const source: LyricsSource = { name: 'LRCLIB', url: 'https://lrclib.net', recordId: record.id };
  if (record.instrumental) return { status: 'instrumental', source };
  if (record.syncedLyrics?.trim()) {
    const lines = parseLrc(record.syncedLyrics);
    if (lines.length && lines.some(line => line.text.trim())) return { status: 'synced', lines, source };
  }
  if (record.plainLyrics?.trim()) return { status: 'plain', plainLyrics: record.plainLyrics.trim(), source };
  return { status: 'temporary_error', retryAfterMs: 30_000, reason: 'invalid_response' };
}
/** Exact normalized metadata and edition markers, duration +/-2s; never choose a partial title. */
export function matchLyrics(query: LyricsQuery, records: LyricsRecord[]): LyricsResult {
  if (!records.length) return { status: 'not_found' };
  const expected = cleanLyricsQuery(query);
  if (!expected.title || !expected.artist || !Number.isFinite(query.duration) || query.duration <= 0) return { status: 'ambiguous' };
  const matches = records.filter(record => {
    const actual = cleanLyricsQuery({ title: record.trackName, artist: record.artistName, duration: record.duration });
    return normalizeLyricsName(expected.title) === normalizeLyricsName(actual.title)
      && normalizeLyricsName(expected.artist) === normalizeLyricsName(actual.artist)
      && editionSignature(expected.title) === editionSignature(actual.title)
      && Math.abs(query.duration - record.duration) <= 2
      && (!query.album || normalizeLyricsName(query.album) === normalizeLyricsName(record.albumName));
  }).sort((a, b) => Math.abs(query.duration - a.duration) - Math.abs(query.duration - b.duration) || a.id - b.id);
  if (!matches.length) return { status: 'ambiguous' };
  const candidates = matches.map(resultFor);
  const signatures = new Set(candidates.map(result => {
    switch (result.status) {
      case 'synced': return JSON.stringify(['synced', result.lines]);
      case 'plain': return JSON.stringify(['plain', result.plainLyrics]);
      default: return result.status;
    }
  }));
  return signatures.size === 1 ? candidates[0]! : { status: 'ambiguous' };
}
