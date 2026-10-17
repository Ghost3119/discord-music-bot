import type { LyricsCandidate, LyricsDiagnostics, LyricsQuery, LyricsResult, LyricsSource } from './contracts';
import { parseLrc } from './lrc';

export interface LyricsRecord {
  id: number; trackName: string; artistName: string; albumName: string; duration: number | null;
  instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null;
}
const promotional = /\s*[\[(](?:official(?:\s+(?:music|lyric))?\s+(?:video|audio|lyrics?)|lyrics?(?:\s+video)?|visuali[sz]er|hd|4k)[\])]\s*/gi;
const editions = /\b(remix|cover|live|festival|acoustic|instrumental|nightcore|demo|remaster(?:ed)?|radio\s+edit|sped\s*up|slowed(?:\s*(?:down|and\s+reverb))?)\b/gi;
export function normalizeLyricsName(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\bfeaturing\b/g, 'feat').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
export function cleanLyricsQuery(query: LyricsQuery): LyricsQuery {
  const artist = query.artist.trim().replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  let title = query.title.replace(promotional, ' ').replace(/\s+[-–—|]\s*(?:official(?:\s+(?:music|lyric))?\s+(?:video|audio|lyrics?)|visuali[sz]er)\s*$/i, '').trim();
  const split = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (split && normalizeLyricsName(split[1]!) === normalizeLyricsName(artist)) title = split[2]!.trim();
  return { title, artist, duration: query.duration, ...(query.durationReliable !== undefined ? { durationReliable: query.durationReliable } : {}), ...(query.album ? { album: query.album.trim() } : {}) };
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
    && (record['duration'] === null || typeof record['duration'] === 'number' && Number.isFinite(record['duration']) && record['duration'] > 0 && record['duration'] <= 86_400)
    && typeof record['instrumental'] === 'boolean' && lyrics('plainLyrics', 50_000) && lyrics('syncedLyrics', 100_000)
    && (!record['instrumental'] || (!record['plainLyrics'] && !record['syncedLyrics']));
}
export function resultForLyricsRecord(record: LyricsRecord): LyricsResult {
  const source: LyricsSource = { name: 'LRCLIB', url: 'https://lrclib.net', recordId: record.id };
  if (record.instrumental) return { status: 'instrumental', source };
  if (record.syncedLyrics?.trim()) {
    const lines = parseLrc(record.syncedLyrics);
    if (lines.length && lines.some(line => line.text.trim())) return { status: 'synced', lines, source };
  }
  if (record.plainLyrics?.trim()) return { status: 'plain', plainLyrics: record.plainLyrics.trim(), source };
  if (!record.syncedLyrics?.trim()) return { status: 'not_found' };
  return { status: 'temporary_error', retryAfterMs: 30_000, reason: 'invalid_response' };
}
function metadataMatches(query: LyricsQuery, record: Pick<LyricsRecord, 'trackName' | 'artistName' | 'albumName' | 'duration'>): boolean {
  const actual = cleanLyricsQuery({ title: record.trackName, artist: record.artistName, duration: record.duration ?? 0 });
  return normalizeLyricsName(query.title) === normalizeLyricsName(actual.title)
    && normalizeLyricsName(query.artist) === normalizeLyricsName(actual.artist)
    && editionSignature(`${query.title} ${query.album ?? ''}`) === editionSignature(`${actual.title} ${record.albumName}`)
    && (!query.album || normalizeLyricsName(query.album) === normalizeLyricsName(record.albumName));
}
export function candidateCompatibilityWarning(query: LyricsQuery, candidate: Pick<LyricsCandidate, 'title' | 'artist' | 'album' | 'duration'>): string | undefined {
  const compatible = metadataMatches(cleanLyricsQuery(query), { trackName: candidate.title, artistName: candidate.artist, albumName: candidate.album, duration: candidate.duration })
    && candidate.duration !== null && Math.abs(query.duration - candidate.duration) <= 2;
  return compatible ? undefined : 'La versión o duración difiere; las letras podrían estar desincronizadas.';
}
export function lyricsCandidate(query: LyricsQuery, record: LyricsRecord): LyricsCandidate {
  const warning = candidateCompatibilityWarning(query, { title: record.trackName, artist: record.artistName, album: record.albumName, duration: record.duration });
  return { id: record.id, title: record.trackName, artist: record.artistName, album: record.albumName, duration: record.duration,
    synced: !!record.syncedLyrics?.trim(), plain: !!record.plainLyrics?.trim(), instrumental: record.instrumental,
    ...(warning ? { warning } : {}) };
}
/** Exact normalized metadata and edition markers, duration +/-2s; never choose a partial title.
 * Approximate video durations permit only unique plain content within 15s/10%, never timestamps. */
export function matchLyrics(query: LyricsQuery, records: LyricsRecord[]): LyricsResult {
  const expected = cleanLyricsQuery(query);
  const report = (result: LyricsResult, decision: LyricsDiagnostics['decision'], rejectedCount: number): LyricsResult => ({ ...result,
    diagnostics: { stage: expected.title === query.title && expected.artist === query.artist ? 'exact' : 'normalized', decision, candidateCount: records.length, rejectedCount } });
  if (!records.length) return report({ status: 'not_found' }, 'no_candidates', 0);
  if (!expected.title || !expected.artist || !Number.isFinite(query.duration) || query.duration <= 0) return report({ status: 'ambiguous' }, 'metadata_rejected', records.length);
  const compatible = records.filter(record => metadataMatches(expected, record));
  const matches = compatible.filter(record => record.duration !== null && Math.abs(query.duration - record.duration) <= 2)
    .sort((a, b) => Math.abs(query.duration - a.duration!) - Math.abs(query.duration - b.duration!) || a.id - b.id);
  if (!matches.length) {
    const fallback = query.durationReliable === false ? compatible.filter(record => record.duration !== null && !record.instrumental && record.plainLyrics?.trim()
      && Math.abs(query.duration - record.duration) <= Math.max(15, query.duration * 0.1)).sort((a, b) => a.id - b.id) : [];
    // All nearby compatible records must agree: missing content is not evidence of agreement.
    const nearby = compatible.filter(record => record.duration === null || Math.abs(query.duration - record.duration) <= Math.max(15, query.duration * 0.1));
    if (fallback.length && fallback.length === nearby.length && new Set(fallback.map(record => record.plainLyrics!.trim())).size === 1) {
      const record = fallback[0]!;
      return { status: 'plain', plainLyrics: record.plainLyrics!.trim(), source: { name: 'LRCLIB', url: 'https://lrclib.net', recordId: record.id },
        diagnostics: { stage: 'plain_fallback', decision: 'duration_plain_fallback', candidateCount: records.length, rejectedCount: records.length - fallback.length } };
    }
    return report({ status: 'ambiguous' }, fallback.length ? 'conflicting_content' : 'metadata_rejected', records.length - fallback.length);
  }
  const candidates = matches.map(resultForLyricsRecord);
  const signatures = new Set(candidates.map(result => {
    switch (result.status) {
      case 'synced': return JSON.stringify(['synced', result.lines]);
      case 'plain': return JSON.stringify(['plain', result.plainLyrics]);
      default: return result.status;
    }
  }));
  // Identical words with conflicting timing are usable as text only. Never guess timestamps.
  if (signatures.size > 1 && candidates.every(result => result.status === 'synced') && matches.every(record => !record.instrumental && !!record.plainLyrics?.trim())
    && new Set(matches.map(record => record.plainLyrics!.trim())).size === 1
    && new Set(candidates.map(result => result.status === 'synced' ? JSON.stringify(result.lines.map(line => line.text)) : '')).size === 1) {
    const record = matches[0]!;
    return report({ status: 'plain', plainLyrics: record.plainLyrics!.trim(), source: { name: 'LRCLIB', url: 'https://lrclib.net', recordId: record.id },
      warning: 'Encontramos sincronizaciones distintas para el mismo texto; mostramos las letras sin sincronización.' }, 'conflicting_timestamps', records.length - matches.length);
  }
  return signatures.size === 1 ? report(candidates[0]!, 'matched', records.length - matches.length)
    : report({ status: 'ambiguous' }, 'conflicting_content', records.length - matches.length);
}
