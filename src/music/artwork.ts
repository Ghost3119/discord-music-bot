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
