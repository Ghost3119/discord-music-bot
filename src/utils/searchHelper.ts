import { json } from '@distube/yt-dlp';
import { SearchSource } from '../music/ytDlpSearchPlugin';

export interface SearchResultItem {
  title: string;
  url: string;
  duration?: number;
  uploader?: string;
}

interface RawEntry {
  title?: string;
  url?: string;
  webpage_url?: string;
  duration?: number;
  uploader?: string;
}

interface RawSearchOutput {
  entries?: RawEntry[];
  title?: string;
  url?: string;
  webpage_url?: string;
  duration?: number;
  uploader?: string;
}

/**
 * Searches YouTube or SoundCloud for multiple song options using yt-dlp.
 */
export async function searchSongs(
  query: string,
  limit = 5,
  source: SearchSource = 'youtube',
): Promise<SearchResultItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const prefix = source === 'soundcloud' ? `scsearch${limit}:` : `ytsearch${limit}:`;
  const searchQuery = `${prefix}${trimmed}`;

  const raw = (await json(searchQuery, {
    dumpSingleJson: true,
    noWarnings: true,
    flatPlaylist: true,
    skipDownload: true,
    simulate: true,
  })) as RawSearchOutput;

  if (!raw) return [];

  const entries: RawEntry[] = Array.isArray(raw.entries)
    ? raw.entries
    : raw.title && (raw.webpage_url || raw.url)
      ? [raw]
      : [];

  return entries
    .filter((entry): entry is RawEntry & { title: string } => {
      return typeof entry.title === 'string' && entry.title.trim().length > 0 && !!(entry.webpage_url || entry.url);
    })
    .slice(0, limit)
    .map((entry) => {
      const item: SearchResultItem = {
        title: entry.title,
        url: entry.webpage_url ?? entry.url!,
      };
      if (typeof entry.duration === 'number' && entry.duration > 0) {
        item.duration = entry.duration;
      }
      if (entry.uploader) {
        item.uploader = entry.uploader;
      }
      return item;
    });
}
