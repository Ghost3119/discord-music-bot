export interface HistoryEntry {
  id: string; guildId: string; title: string; source: string; time: number;
  result: 'completed' | 'skipped' | 'failed'; code: string; reference: string;
  url: string | undefined; searchSource: 'youtube' | 'soundcloud'; alternative: string | undefined;
}

export function publicMusicUrl(input: string | undefined): string | undefined {
  if (!input || input.length > 1000) return undefined;
  try {
    const url = new URL(input ?? '');
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase();
    if (['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
      const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
      return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : undefined;
    }
    if (['soundcloud.com', 'www.soundcloud.com'].includes(host) && /^\/[^/]+\/[^/]+\/?$/.test(url.pathname)) return `https://soundcloud.com${url.pathname}`;
    if (host === 'open.spotify.com' && /^\/track\/[a-zA-Z0-9]+$/.test(url.pathname)) return `${url.origin}${url.pathname}`;
    if (host === 'music.apple.com' && url.pathname.includes('/album/') && /^\d+$/.test(url.searchParams.get('i') ?? '')) return `${url.origin}${url.pathname}?i=${url.searchParams.get('i')}`;
  } catch { /* Unusable sources stay visible without a retry button. */ }
  return undefined;
}

/** Initial reads remain synchronous to preserve construction semantics. */
export interface HistoryStorage {
  read(): HistoryEntry[];
  write(entries: HistoryEntry[]): Promise<void>;
}
