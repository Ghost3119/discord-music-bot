/** Metadata-only fallback. No network, album inheritance, or inference for other providers. */
export function youtubeThumbnail(source: string, id?: unknown, inputUrl?: unknown): string | undefined {
  if (!source.toLowerCase().startsWith('youtube')) return undefined;
  const valid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
  let urlId: string | undefined;
  if (typeof inputUrl === 'string') {
    try {
      const url = new URL(inputUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
      if (['youtube.com','www.youtube.com','music.youtube.com','m.youtube.com'].includes(url.hostname)) {
        urlId = url.pathname === '/watch' ? url.searchParams.get('v') ?? undefined : /^\/(?:shorts|live)\/[\w-]{11}$/.test(url.pathname) ? url.pathname.split('/')[2] : undefined;
      } else if (url.hostname === 'youtu.be') urlId = url.pathname.slice(1);
      else return undefined;
      if (!valid(urlId)) return undefined;
    } catch { if (inputUrl !== id) return undefined; }
  }
  if (valid(id) && valid(urlId) && id !== urlId) return undefined;
  const videoId = valid(urlId) ? urlId : valid(id) ? id : undefined;
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined;
}

export const IMAGE_HOSTS = [
  'i.ytimg.com', 'img.youtube.com',
  'i.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com', 'mosaic.scdn.co',
  'images.genius.com',
  'is1-ssl.mzstatic.com', 'is2-ssl.mzstatic.com', 'is3-ssl.mzstatic.com', 'is4-ssl.mzstatic.com', 'is5-ssl.mzstatic.com',
  'i1.sndcdn.com', 'i2.sndcdn.com', 'i3.sndcdn.com', 'i4.sndcdn.com',
];

export function sanitizeThumbnailUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !IMAGE_HOSTS.includes(parsed.hostname)) return null;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch { return null; }
}
