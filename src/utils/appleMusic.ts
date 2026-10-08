const APPLE_MUSIC_REGEX = /^https?:\/\/music\.apple\.com\/[a-z]{2}\/(?:album|song|playlist)\//;

export interface AppleMusicResult {
  isAppleMusic: boolean;
  query: string;
  title?: string;
  artist?: string;
}

interface ITunesLookupResponse {
  results: ITunesTrack[];
}

interface ITunesTrack {
  wrapperType?: string;
  artistName?: string;
  trackName?: string;
  collectionName?: string;
}

function isLookupResponse(value: unknown): value is ITunesLookupResponse {
  return typeof value === 'object' && value !== null && Array.isArray((value as ITunesLookupResponse).results);
}

function getAppleMusicId(query: string): string | undefined {
  try {
    const url = new URL(query);
    const songId = url.searchParams.get('i');
    if (songId && /^\d{5,}$/.test(songId)) return songId;

    return url.pathname
      .split('/')
      .reverse()
      .find((segment) => /^(?:id)?\d{5,}$/.test(segment))
      ?.replace(/^id/, '');
  } catch {
    return undefined;
  }
}

export async function resolveAppleMusic(query: string): Promise<AppleMusicResult> {
  if (!APPLE_MUSIC_REGEX.test(query)) {
    return { isAppleMusic: false, query };
  }

  const id = getAppleMusicId(query);
  if (!id) {
    return { isAppleMusic: false, query };
  }

  return lookupAppleMusic(id, query);
}

async function lookupAppleMusic(id: string, originalQuery: string): Promise<AppleMusicResult> {
  try {
    const response = await fetch(`https://itunes.apple.com/lookup?id=${id}`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Apple Music devolvió HTTP ${response.status}`);
    const data: unknown = await response.json();

    if (!isLookupResponse(data) || data.results.length === 0) {
      return { isAppleMusic: true, query: originalQuery };
    }

    const track = data.results.find((result) => result.wrapperType === 'track') ?? data.results[0];
    if (!track) {
      return { isAppleMusic: true, query: originalQuery };
    }

    const artist = track.artistName ?? '';
    const title = track.trackName ?? track.collectionName ?? '';
    const searchTerm = `${artist} ${title}`.trim();

    if (!searchTerm) {
      return { isAppleMusic: true, query: originalQuery, title, artist };
    }

    return {
      isAppleMusic: true,
      query: searchTerm,
      title,
      artist,
    };
  } catch (error) {
    console.error('Error resolviendo Apple Music:', error);
    return { isAppleMusic: true, query: originalQuery };
  }
}
