const APPLE_MUSIC_REGEX = /^https?:\/\/music\.apple\.com\/[a-z]{2}\/(?:album|song|playlist)\//;

export interface AppleMusicResult {
  isAppleMusic: boolean;
  query: string;
  title?: string;
  artist?: string;
}

export async function resolveAppleMusic(query: string): Promise<AppleMusicResult> {
  if (!APPLE_MUSIC_REGEX.test(query)) {
    return { isAppleMusic: false, query };
  }

  const cleanUrl = query.split('?')[0].split('#')[0];

  const segments = cleanUrl.split('/');
  const idSegment = segments.reverse().find((s: string) => /^\d{5,}$/.test(s));
  if (!idSegment) {
    const idWithPrefix = cleanUrl.match(/\/id(\d+)/);
    if (idWithPrefix) {
      return lookupAppleMusic(idWithPrefix[1], query);
    }
    return { isAppleMusic: false, query };
  }

  return lookupAppleMusic(idSegment, query);
}

async function lookupAppleMusic(id: string, originalQuery: string): Promise<AppleMusicResult> {
  try {
    const response = await fetch(`https://itunes.apple.com/lookup?id=${id}`);
    const data: any = await response.json();

    if (!data.results || data.results.length === 0) {
      return { isAppleMusic: true, query: originalQuery };
    }

    const track = data.results.find((r: any) => r.wrapperType === 'track') ?? data.results[0];
    const artist = track.artistName ?? '';
    const title = track.trackName ?? '';
    const searchTerm = `${artist} ${title}`.trim();

    const ytSearch = `ytsearch:${searchTerm}`;

    return {
      isAppleMusic: true,
      query: ytSearch || originalQuery,
      title,
      artist,
    };
  } catch (error) {
    console.error('Error resolviendo Apple Music:', error);
    return { isAppleMusic: true, query: originalQuery };
  }
}