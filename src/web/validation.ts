import type { MusicAction } from './contracts';
import { WebError, TrackMetadata } from './database';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WebError(400, 'Expected a JSON object');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, field: string, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new WebError(400, `Invalid ${field}`);
  return value.trim();
}
export function playlistName(value: unknown): string { return text(object(value)['name'], 100, 'playlist name'); }
function number(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new WebError(400, `Invalid ${field}`);
  return value;
}
function integer(value: unknown, min: number, max: number, field: string): number {
  const parsed = number(value, min, max, field);
  if (!Number.isInteger(parsed)) throw new WebError(400, `Invalid ${field}`);
  return parsed;
}
/** Preserve only durable public media links; streaming/extractor URLs are never persisted. */
export function publicTrackUrl(value: unknown): { url: string; source: string } {
  const input = text(value, 2048, 'track URL');
  let url: URL;
  try { url = new URL(input); } catch { throw new WebError(400, 'Invalid track URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new WebError(400, 'Track URL must be a public HTTPS media link');
  const host = url.hostname.toLowerCase();
  if (['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(host) && url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') ?? '')) {
    return { url: `https://www.youtube.com/watch?v=${url.searchParams.get('v')!}`, source: 'youtube' };
  }
  if (host === 'youtu.be' && /^\/[\w-]{11}$/.test(url.pathname)) return { url: `https://www.youtube.com/watch?v=${url.pathname.slice(1)}`, source: 'youtube' };
  if (['youtube.com', 'www.youtube.com'].includes(host) && /^\/(shorts|live)\/[\w-]{11}$/.test(url.pathname)) return { url: `https://www.youtube.com/watch?v=${url.pathname.split('/')[2]!}`, source: 'youtube' };
  if (['soundcloud.com', 'www.soundcloud.com'].includes(host) && /^\/[\w-]+\/[\w-]+\/?$/.test(url.pathname) && !/^\/(stream|api|discover|search|you)\//.test(url.pathname)) return { url: `https://soundcloud.com${url.pathname.replace(/\/$/, '')}`, source: 'soundcloud' };
  if (host === 'open.spotify.com' && /^\/(intl-[a-z]{2}\/)?track\/[A-Za-z0-9]{22}$/.test(url.pathname)) return { url: `https://open.spotify.com/track/${url.pathname.split('/').at(-1)!}`, source: 'spotify' };
  if (host === 'music.apple.com' && /^\/[a-z]{2}\/album\/[^/]+\/\d+$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('i') ?? '')) return { url: `https://music.apple.com${url.pathname}?i=${url.searchParams.get('i')!}`, source: 'apple_music' };
  if (host === 'music.apple.com' && /^\/[a-z]{2}\/song\/[^/]+\/\d+$/.test(url.pathname)) return { url: `https://music.apple.com${url.pathname}`, source: 'apple_music' };
  throw new WebError(400, 'Use a permanent YouTube, SoundCloud, Spotify track or Apple Music song URL');
}
export function trackMetadata(value: unknown): TrackMetadata {
  const item = object(value);
  const { url, source } = publicTrackUrl(item['url']);
  // source is derived from the public URL, never trusted from the browser.
  let thumbnail: string | null = null;
  if (item['thumbnail'] != null) {
    const candidate = text(item['thumbnail'], 2048, 'thumbnail');
    let parsed: URL;
    try { parsed = new URL(candidate); } catch { throw new WebError(400, 'Invalid thumbnail'); }
    const imageHosts = ['i.ytimg.com', 'img.youtube.com', 'i.scdn.co', 'images.genius.com', 'is1-ssl.mzstatic.com', 'is2-ssl.mzstatic.com', 'is3-ssl.mzstatic.com', 'is4-ssl.mzstatic.com', 'is5-ssl.mzstatic.com', 'i1.sndcdn.com'];
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !imageHosts.includes(parsed.hostname)) throw new WebError(400, 'Invalid thumbnail host');
    thumbnail = parsed.toString();
  }
  return { url, source, title: text(item['title'], 300, 'title'), artist: text(item['artist'] ?? '', 300, 'artist', true), duration: Math.round(number(item['duration'], 0, 604800, 'duration')), thumbnail };
}
export function publicPlayUrl(value: string): string {
  try { return publicTrackUrl(value).url; } catch { /* Albums and playlists are playback inputs, not saved tracks. */ }
  let url: URL;
  try { url = new URL(value); } catch { throw new WebError(400, 'Invalid media URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new WebError(400, 'Use a public HTTPS media link');
  if (['youtube.com', 'www.youtube.com', 'music.youtube.com'].includes(url.hostname) && url.pathname === '/playlist' && /^[\w-]{10,100}$/.test(url.searchParams.get('list') ?? '')) return `https://www.youtube.com/playlist?list=${url.searchParams.get('list')!}`;
  if (url.hostname === 'open.spotify.com' && /^\/(intl-[a-z]{2}\/)?(album|playlist)\/[A-Za-z0-9]{22}$/.test(url.pathname)) return `${url.origin}${url.pathname}`;
  if (['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname) && /^\/[\w-]+\/sets\/[\w-]+\/?$/.test(url.pathname)) return `https://soundcloud.com${url.pathname}`;
  if (url.hostname === 'music.apple.com' && /^\/[a-z]{2}\/(album|playlist)\/[^/]+\/[A-Za-z\d.-]+$/.test(url.pathname)) return `${url.origin}${url.pathname}`;
  throw new WebError(400, 'Use a public YouTube, SoundCloud, Spotify or Apple Music link');
}
export function musicAction(value: unknown): MusicAction {
  const item = object(value);
  switch (item['action']) {
    case 'play': {
      const query = text(item['query'], 500, 'query');
      // Search strings are allowed; URLs must target recognized public sources.
      return { action: 'play', query: /^[a-z][a-z\d+.-]*:|^\/\//i.test(query) ? publicPlayUrl(query) : query };
    }
    case 'pause': case 'resume': case 'skip': case 'stop': case 'shuffle': return { action: item['action'] };
    case 'volume': return { action: 'volume', volume: integer(item['volume'], 0, 100, 'volume') };
    case 'repeat': return { action: 'repeat', mode: integer(item['mode'], 0, 2, 'repeat mode') };
    case 'remove': return { action: 'remove', index: integer(item['index'], 1, 10000, 'queue index') };
    case 'move': return { action: 'move', from: integer(item['from'], 1, 10000, 'source index'), to: integer(item['to'], 1, 10000, 'target index') };
    default: throw new WebError(400, 'Unknown music action');
  }
}
