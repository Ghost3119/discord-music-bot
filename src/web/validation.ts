import type { MusicAction } from './contracts';
import { WebError, TrackMetadata } from './database';
import { youtubeThumbnail } from '../music/artwork';

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
  if (host === 'music.youtube.com' && url.pathname === '/search') {
    const q = cleanMetadataText(url.searchParams.get('q'), 400);
    if (q) return { url: `https://music.youtube.com/search?q=${encodeURIComponent(q)}`, source: 'csv' };
  }
  throw new WebError(400, 'Use a permanent YouTube, SoundCloud, Spotify track or Apple Music song URL');
}
const IMAGE_HOSTS = [
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
const safeThumbnail = sanitizeThumbnailUrl;

function cleanMetadataText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function fallbackTitleFromUrl(url: string, source: string): string {
  try {
    const parsed = new URL(url);
    if (source === 'youtube') return `YouTube (${parsed.searchParams.get('v') ?? 'video'})`;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const slug = source === 'apple_music' ? segments[2] : segments.at(-1);
    if (slug) {
      const decoded = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
      if (decoded) return decoded.slice(0, 300);
    }
  } catch { /* ignore */ }
  return 'Canción sin título';
}

export async function resolveTrackUrlMetadata(value: unknown, fetchImpl: typeof fetch = fetch): Promise<TrackMetadata> {
  const { url, source } = publicTrackUrl(value);
  let title = '';
  let artist = '';
  let duration = 0;
  let thumbnail: string | null = null;

  if (source === 'youtube') {
    const videoId = new URL(url).searchParams.get('v');
    if (videoId) thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  try {
    if (source === 'apple_music') {
      const parsed = new URL(url);
      const id = parsed.searchParams.get('i') ?? parsed.pathname.split('/').at(-1);
      if (id && /^\d+$/.test(id)) {
        const res = await fetchImpl(`https://itunes.apple.com/lookup?id=${id}`, { signal: AbortSignal.timeout(6_000) });
        if (res.ok) {
          const data = await res.json() as { results?: Array<Record<string, unknown>> };
          const list = Array.isArray(data?.results) ? data.results : [];
          const track = list.find(item => item['wrapperType'] === 'track') ?? list[0];
          if (track) {
            title = cleanMetadataText(track['trackName'] ?? track['collectionName'], 300);
            artist = cleanMetadataText(track['artistName'], 300);
            const millis = track['trackTimeMillis'];
            if (typeof millis === 'number' && Number.isFinite(millis) && millis > 0) {
              duration = Math.min(604800, Math.round(millis / 1000));
            }
            const art = typeof track['artworkUrl100'] === 'string' ? track['artworkUrl100'].replace(/\/100x100bb\./, '/600x600bb.') : null;
            thumbnail = safeThumbnail(art) ?? thumbnail;
          }
        }
      }
    } else {
      const endpoint = source === 'youtube'
        ? `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
        : source === 'soundcloud'
          ? `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`
          : `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
      const res = await fetchImpl(endpoint, { signal: AbortSignal.timeout(6_000) });
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        title = cleanMetadataText(data['title'], 300);
        const rawAuthor = cleanMetadataText(data['author_name'], 300).replace(/\s*-\s*Topic$/i, '').trim();
        artist = rawAuthor;
        thumbnail = safeThumbnail(data['thumbnail_url']) ?? thumbnail;
      }
    }
  } catch {
    // Fallback gracefully to URL-derived metadata if upstream oEmbed/lookup is unreachable.
  }

  return {
    url,
    source,
    title: title || fallbackTitleFromUrl(url, source),
    artist: artist || 'Artista desconocido',
    duration,
    thumbnail,
  };
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
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !IMAGE_HOSTS.includes(parsed.hostname)) throw new WebError(400, 'Invalid thumbnail host');
    parsed.search = '';
    parsed.hash = '';
    thumbnail = parsed.toString();
  }
  return { url, source, title: text(item['title'], 300, 'title'), artist: text(item['artist'] ?? '', 300, 'artist', true), duration: Math.round(number(item['duration'], 0, 604800, 'duration')), thumbnail: thumbnail ?? youtubeThumbnail(source, undefined, url) ?? null };
}

export function playlistImportCommitPayload(value: unknown): {
  name: string;
  tracks: TrackMetadata[];
  requestId?: string;
} {
  const body = object(value);
  const name = playlistName(body);
  const rawTracks = body['tracks'];
  if (!Array.isArray(rawTracks) || rawTracks.length === 0) {
    throw new WebError(400, 'Selecciona al menos una canción para importar la playlist.');
  }
  if (rawTracks.length > 500) {
    throw new WebError(400, 'No se pueden importar más de 500 canciones en una playlist.');
  }
  const tracks = rawTracks.map((item, idx) => {
    try {
      const validated = trackMetadata(item);
      return {
        ...validated,
        artist: validated.artist || 'Artista desconocido',
      };
    } catch (error) {
      const detail = error instanceof WebError ? error.message : 'Invalid track metadata';
      throw new WebError(400, `Canción inválida en la posición ${idx + 1}: ${detail}`);
    }
  });
  let requestId: string | undefined;
  if (body['requestId'] !== undefined) {
    requestId = text(body['requestId'], 120, 'requestId');
  }
  return { name, tracks, ...(requestId ? { requestId } : {}) };
}
export function publicPlayUrl(value: string): string {
  try {
    const resolved = publicTrackUrl(value);
    if (resolved.source === 'csv') {
      const q = cleanMetadataText(new URL(resolved.url).searchParams.get('q'), 400);
      if (q) return q;
    }
    return resolved.url;
  } catch { /* Albums and playlists are playback inputs, not saved tracks. */ }
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
      const normalizedQuery = /^[a-z][a-z\d+.-]*:|^\/\//i.test(query) ? publicPlayUrl(query) : query;
      const track = item['track'] !== undefined ? trackMetadata(item['track']) : undefined;
      return { action: 'play', query: normalizedQuery, ...(track ? { track } : {}) };
    }
    case 'pause': case 'resume': case 'skip': case 'stop': case 'shuffle': return { action: item['action'] };
    case 'autoplay':
      if (typeof item['enabled'] !== 'boolean') throw new WebError(400, 'Invalid radio state');
      return { action: 'autoplay', enabled: item['enabled'] };
    case 'recommend': return { action: 'recommend', amount: item['amount'] === undefined ? 5 : integer(item['amount'], 1, 20, 'recommendation amount') };
    case 'volume': return { action: 'volume', volume: integer(item['volume'], 0, 100, 'volume') };
    case 'repeat': return { action: 'repeat', mode: integer(item['mode'], 0, 2, 'repeat mode') };
    case 'remove': return { action: 'remove', index: integer(item['index'], 1, 10000, 'queue index') };
    case 'move': return { action: 'move', from: integer(item['from'], 1, 10000, 'source index'), to: integer(item['to'], 1, 10000, 'target index') };
    default: throw new WebError(400, 'Unknown music action');
  }
}
