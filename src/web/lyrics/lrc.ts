import type { LyricsLine } from './contracts';

/** Milliseconds throughout; equal timestamps retain source order. */
export function parseLrc(source: string): LyricsLine[] {
  const rows = source.slice(0, 256_000).replace(/^\uFEFF/u, '').split(/\r\n|\r|\n/u);
  let offsetMs = 0;
  for (const row of rows) {
    const offset = row.trim().match(/^\[offset:([+-]?\d{1,8})\]$/iu);
    if (offset) offsetMs = Number(offset[1]);
  }

  const lines: LyricsLine[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // Only leading tags are timing/metadata. Brackets inside lyric text stay literal.
    const tagged = row.trimStart().match(/^((?:\[[^\]\r\n]*\])+)(.*)$/u);
    if (!tagged) continue;
    const text = tagged[2]!.trim();
    for (const tag of tagged[1]!.matchAll(/\[([^\]]*)\]/gu)) {
      const timestamp = tag[1]!.match(/^(\d{1,5}):([0-5]\d)(?:\.(\d{1,9}))?$/u);
      if (!timestamp) continue;
      const fraction = timestamp[3] ? Number(`0.${timestamp[3]}`) : 0;
      const timeMs = Math.max(0, Math.round((Number(timestamp[1]) * 60 + Number(timestamp[2]) + fraction) * 1000) + offsetMs);
      const key = `${timeMs}\u0000${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({ timeMs, text });
      if (lines.length === 5000) return lines.sort((a, b) => a.timeMs - b.timeMs);
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}
