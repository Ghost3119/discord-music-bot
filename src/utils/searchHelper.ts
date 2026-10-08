import { SearchSource, YtDlpSearchPlugin } from '../music/ytDlpSearchPlugin';

export interface SearchResultItem {
  title: string;
  url: string;
  duration?: number;
  uploader?: string;
}

const searchPlugin = new YtDlpSearchPlugin();

export async function searchSongs(query: string, limit = 5, source: SearchSource = 'youtube'): Promise<SearchResultItem[]> {
  if (!query.trim()) return [];
  const songs = await searchPlugin.searchCandidates(query.trim(), limit, source);
  return songs.filter((song) => song.url && song.name).map((song) => ({
    title: song.name!, url: song.url!, duration: song.duration,
    ...(song.uploader.name ? { uploader: song.uploader.name } : {}),
  }));
}
