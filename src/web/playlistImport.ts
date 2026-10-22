import type { ImportPlatform, ImportedPlaylistPreview, ImportedPlaylistTrack } from './contracts';
import { WebError } from './database';
import { publicTrackUrl, sanitizeThumbnailUrl } from './validation';
import { runYtDlp, type YtDlpFlags } from '../music/ytDlpRunner';
import { classifyMusicError } from '../music/errors';
import { youtubeThumbnail } from '../music/artwork';

export type { ImportPlatform, ImportedPlaylistPreview, ImportedPlaylistTrack } from './contracts';

export interface ParsedPlaylistUrl {
  platform: ImportPlatform;
  playlistId: string;
  canonicalUrl: string;
  sourceUrl: string;
}

export interface PlaylistImportAdapter {
  readonly platform: ImportPlatform;
  canHandle(parsed: ParsedPlaylistUrl): boolean;
  resolvePlaylist(parsed: ParsedPlaylistUrl, signal: AbortSignal): Promise<ImportedPlaylistPreview>;
}

export interface PlaylistImportService {
  parseUrl(rawUrl: unknown): ParsedPlaylistUrl;
  previewPlaylist(rawUrl: unknown, signal: AbortSignal): Promise<ImportedPlaylistPreview>;
}

export type YtDlpExecutor = (input: string, flags?: YtDlpFlags, signal?: AbortSignal) => Promise<unknown>;

export interface PlaylistImportServiceOptions {
  runYtDlp?: YtDlpExecutor;
  adapters?: PlaylistImportAdapter[];
  pageSize?: number;
  maxTracks?: number;
}

export const DEFAULT_IMPORT_PAGE_SIZE = 100;
export const DEFAULT_IMPORT_MAX_TRACKS = 500;

interface RawYtDlpThumb {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

interface RawYtDlpEntry {
  _type?: unknown;
  id?: unknown;
  title?: unknown;
  fulltitle?: unknown;
  url?: unknown;
  webpage_url?: unknown;
  original_url?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  thumbnails?: unknown;
  uploader?: unknown;
  channel?: unknown;
  artist?: unknown;
  creators?: unknown;
  availability?: unknown;
  live_status?: unknown;
  ie_key?: unknown;
  extractor?: unknown;
}

interface RawYtDlpPlaylist {
  id?: unknown;
  title?: unknown;
  uploader?: unknown;
  channel?: unknown;
  thumbnail?: unknown;
  thumbnails?: unknown;
  playlist_count?: unknown;
  availability?: unknown;
  entries?: unknown;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanArtist(value: unknown): string {
  const cleaned = cleanText(value, 300).replace(/\s*-\s*Topic$/i, '').trim();
  return cleaned;
}

function pickThumbnail(rawThumb: unknown, rawThumbs: unknown): string | null {
  const direct = sanitizeThumbnailUrl(rawThumb);
  if (direct) return direct;
  if (!Array.isArray(rawThumbs)) return null;
  let best: string | null = null;
  let bestScore = -1;
  for (const item of rawThumbs) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as RawYtDlpThumb;
    const safe = sanitizeThumbnailUrl(candidate.url);
    if (!safe) continue;
    const width = typeof candidate.width === 'number' && Number.isFinite(candidate.width) ? candidate.width : 0;
    const height = typeof candidate.height === 'number' && Number.isFinite(candidate.height) ? candidate.height : 0;
    const score = width * height;
    if (score >= bestScore) {
      bestScore = score;
      best = safe;
    }
  }
  return best;
}

function isUnavailableEntry(entry: RawYtDlpEntry, title: string): boolean {
  const lower = title.toLowerCase();
  if (
    lower === '[private video]' ||
    lower === '[deleted video]' ||
    lower === 'private video' ||
    lower === 'deleted video' ||
    lower === '[unavailable video]'
  ) {
    return true;
  }
  if (typeof entry.availability === 'string') {
    const avail = entry.availability.toLowerCase();
    if (['private', 'needs_auth', 'subscriber_only', 'premium_only'].includes(avail)) return true;
  }
  return false;
}

function normalizeEntryTrack(
  entry: RawYtDlpEntry,
  platform: ImportPlatform,
  position: number,
): ImportedPlaylistTrack | null {
  if (!entry || typeof entry !== 'object') return null;
  const rawTitle = cleanText(entry.title ?? entry.fulltitle, 300);
  if (isUnavailableEntry(entry, rawTitle)) return null;

  const rawId = typeof entry.id === 'string' ? entry.id.trim() : typeof entry.id === 'number' ? String(entry.id) : '';
  const candidateUrl =
    (typeof entry.webpage_url === 'string' && entry.webpage_url.trim()) ||
    (typeof entry.original_url === 'string' && entry.original_url.trim()) ||
    (typeof entry.url === 'string' && entry.url.trim()) ||
    '';

  let normalizedUrl: { url: string; source: string } | null = null;
  if (candidateUrl.startsWith('https://')) {
    try {
      normalizedUrl = publicTrackUrl(candidateUrl);
    } catch {
      normalizedUrl = null;
    }
  }
  if (!normalizedUrl && /^[\w-]{11}$/.test(rawId)) {
    normalizedUrl = { url: `https://www.youtube.com/watch?v=${rawId}`, source: 'youtube' };
  }
  if (!normalizedUrl && /^[\w-]{11}$/.test(candidateUrl)) {
    normalizedUrl = { url: `https://www.youtube.com/watch?v=${candidateUrl}`, source: 'youtube' };
  }
  if (!normalizedUrl) return null;

  const videoId = new URL(normalizedUrl.url).searchParams.get('v') ?? rawId;
  const sourceId = /^[\w-]{11}$/.test(videoId) ? videoId : rawId || normalizedUrl.url;

  const creator = Array.isArray(entry.creators) && entry.creators.length > 0 ? entry.creators[0] : undefined;
  const artist =
    cleanArtist(entry.artist) ||
    cleanArtist(entry.uploader) ||
    cleanArtist(entry.channel) ||
    cleanArtist(creator) ||
    'Artista desconocido';

  const title = rawTitle || `YouTube (${sourceId})`;
  const rawDuration = typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration > 0
    ? Math.min(604_800, Math.round(entry.duration))
    : 0;

  // Never inherit the playlist cover for individual tracks; only use the entry's own thumbnail or video ID fallback.
  const thumbnail =
    pickThumbnail(entry.thumbnail, entry.thumbnails) ??
    youtubeThumbnail('youtube', sourceId, normalizedUrl.url) ??
    null;

  return {
    url: normalizedUrl.url,
    title,
    artist,
    duration: rawDuration,
    thumbnail,
    source: normalizedUrl.source,
    sourceId,
    platform,
    position,
  };
}

export function parsePlaylistImportUrl(value: unknown): ParsedPlaylistUrl {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new WebError(400, 'Introduce un enlace válido de playlist de YouTube o YouTube Music.');
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new WebError(400, 'Introduce un enlace HTTPS válido de YouTube o YouTube Music.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new WebError(400, 'El enlace debe ser una URL pública HTTPS sin credenciales ni puertos.');
  }

  const host = url.hostname.toLowerCase();
  if (host === 'open.spotify.com' && /^\/(?:intl-[a-z]{2}\/)?playlist\/([A-Za-z0-9]{22})\/?$/.test(url.pathname)) {
    const playlistId = url.pathname.split('/').filter(Boolean).at(-1)!;
    return {
      platform: 'spotify',
      playlistId,
      canonicalUrl: `https://open.spotify.com/playlist/${playlistId}`,
      sourceUrl: `https://open.spotify.com/playlist/${playlistId}`,
    };
  }

  const isYouTubeMusic = host === 'music.youtube.com';
  const isYouTube = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host);
  if (!isYouTube && host !== 'youtu.be') {
    throw new WebError(400, 'Solo se permiten enlaces públicos de YouTube o YouTube Music.');
  }

  const listParam = url.searchParams.get('list')?.trim() ?? '';
  if (!listParam) {
    if ((url.pathname === '/watch' && url.searchParams.has('v')) || host === 'youtu.be') {
      throw new WebError(400, 'Este enlace es de una sola canción. Pega el enlace de una playlist (con ?list=…).');
    }
    throw new WebError(400, 'El enlace no contiene un identificador de playlist válido.');
  }
  if (!/^[A-Za-z0-9_-]{2,120}$/.test(listParam)) {
    throw new WebError(400, 'El identificador de la playlist no tiene un formato válido.');
  }
  if (['WL', 'LL', 'LM'].includes(listParam.toUpperCase())) {
    throw new WebError(403, 'Esta playlist («Ver más tarde» o «Me gusta») es privada de tu cuenta de YouTube.');
  }
  if (url.pathname !== '/playlist' && url.pathname !== '/watch' && host !== 'youtu.be') {
    throw new WebError(400, 'Usa un enlace directo de playlist (/playlist?list=… o /watch?v=…&list=…).');
  }

  const platform: ImportPlatform = isYouTubeMusic ? 'youtube_music' : 'youtube';
  // Extract via standard www.youtube.com/playlist?list=... so yt-dlp's youtube:tab extractor resolves cleanly
  const canonicalUrl = `https://www.youtube.com/playlist?list=${listParam}`;
  const sourceUrl = isYouTubeMusic
    ? `https://music.youtube.com/playlist?list=${listParam}`
    : canonicalUrl;

  return {
    platform,
    playlistId: listParam,
    canonicalUrl,
    sourceUrl,
  };
}

function mapExtractorError(error: unknown, signal: AbortSignal): WebError {
  if (signal.aborted) {
    return new WebError(409, 'La consulta de la playlist fue cancelada.');
  }
  if (error instanceof WebError) return error;
  const code = classifyMusicError(error);
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  if (code === 'PRIVATE_CONTENT' || /private|sign in|log in|members-only/i.test(rawMessage)) {
    return new WebError(403, 'La playlist es privada o requiere iniciar sesión. Cambia su visibilidad a Pública o No listada.');
  }
  if (code === 'UNAVAILABLE_VIDEO' || /does not exist|not exist|not found|unavailable/i.test(rawMessage)) {
    return new WebError(404, 'La playlist no existe o no está disponible públicamente.');
  }
  if (code === 'NETWORK_TIMEOUT') {
    return Object.assign(
      new WebError(504, 'La consulta de la playlist superó el tiempo de espera. Inténtalo de nuevo.'),
      { errorCode: 'PLAYLIST_IMPORT_TIMEOUT' },
    );
  }
  if (code === 'MUSIC_BUSY' || code === 'SOURCE_RATE_LIMITED') {
    return new WebError(429, 'El extractor está ocupado con otras consultas. Espera unos segundos e inténtalo de nuevo.');
  }
  return new WebError(502, 'No se pudo obtener la playlist desde la plataforma de origen.');
}

export class YouTubePlaylistImportAdapter implements PlaylistImportAdapter {
  readonly platform: ImportPlatform;
  private readonly executeYtDlp: YtDlpExecutor;
  private readonly pageSize: number;
  private readonly maxTracks: number;

  constructor(
    platform: 'youtube' | 'youtube_music',
    executeYtDlp: YtDlpExecutor,
    pageSize = DEFAULT_IMPORT_PAGE_SIZE,
    maxTracks = DEFAULT_IMPORT_MAX_TRACKS,
  ) {
    this.platform = platform;
    this.executeYtDlp = executeYtDlp;
    this.pageSize = Math.max(1, Math.min(200, pageSize));
    this.maxTracks = Math.max(1, Math.min(DEFAULT_IMPORT_MAX_TRACKS, maxTracks));
  }

  canHandle(parsed: ParsedPlaylistUrl): boolean {
    return parsed.platform === this.platform;
  }

  async resolvePlaylist(parsed: ParsedPlaylistUrl, signal: AbortSignal): Promise<ImportedPlaylistPreview> {
    signal.throwIfAborted();
    let title = '';
    let author: string | null = null;
    let playlistCover: string | null = null;
    let reportedTotal = 0;
    let omittedCount = 0;
    let rawFetchedCount = 0;
    let truncated = false;
    const tracks: ImportedPlaylistTrack[] = [];

    for (let start = 1; start <= this.maxTracks; start += this.pageSize) {
      signal.throwIfAborted();
      const end = Math.min(start + this.pageSize - 1, this.maxTracks);
      let raw: unknown;
      try {
        raw = await this.executeYtDlp(
          parsed.canonicalUrl,
          {
            flatPlaylist: true,
            playlistStart: start,
            playlistEnd: end,
          },
          signal,
        );
      } catch (error) {
        throw mapExtractorError(error, signal);
      }
      signal.throwIfAborted();

      if (!raw || typeof raw !== 'object') {
        throw new WebError(502, 'El extractor devolvió una respuesta inválida para la playlist.');
      }
      const info = raw as RawYtDlpPlaylist;
      if (typeof info.availability === 'string' && ['private', 'needs_auth'].includes(info.availability.toLowerCase())) {
        throw new WebError(403, 'La playlist es privada o requiere iniciar sesión.');
      }

      if (!title) {
        title = cleanText(info.title, 100);
      }
      if (!author) {
        const candidateAuthor = cleanArtist(info.uploader) || cleanArtist(info.channel);
        if (candidateAuthor) author = candidateAuthor;
      }
      if (!playlistCover) {
        playlistCover = pickThumbnail(info.thumbnail, info.thumbnails);
      }
      if (typeof info.playlist_count === 'number' && Number.isFinite(info.playlist_count) && info.playlist_count > 0) {
        reportedTotal = Math.max(reportedTotal, Math.round(info.playlist_count));
      }

      const entries = Array.isArray(info.entries) ? (info.entries as RawYtDlpEntry[]) : [];
      if (entries.length === 0) {
        break;
      }

      for (let i = 0; i < entries.length; i++) {
        // Yield every 50 entries so large playlists never block the Node event loop
        if (i > 0 && i % 50 === 0) {
          await new Promise<void>(resolve => setImmediate(resolve));
          signal.throwIfAborted();
        }
        rawFetchedCount += 1;
        const normalized = normalizeEntryTrack(entries[i]!, parsed.platform, tracks.length);
        if (normalized) {
          tracks.push(normalized);
        } else {
          omittedCount += 1;
        }
      }

      const expectedSliceCount = end - start + 1;
      const knownTotalReached = reportedTotal > 0 && end >= reportedTotal;
      if (entries.length < expectedSliceCount || knownTotalReached) {
        break;
      }
      if (end >= this.maxTracks && (reportedTotal > this.maxTracks || entries.length === expectedSliceCount)) {
        truncated = true;
        break;
      }
    }

    if (rawFetchedCount === 0) {
      throw new WebError(422, 'La playlist está vacía.');
    }
    if (tracks.length === 0) {
      throw new WebError(422, 'La playlist no contiene canciones públicas disponibles para importar.');
    }

    const totalCount = Math.max(reportedTotal, rawFetchedCount);
    if (reportedTotal > this.maxTracks) {
      truncated = true;
    }

    return {
      platform: parsed.platform,
      playlistId: parsed.playlistId,
      sourceUrl: parsed.sourceUrl,
      title: title || `Playlist de ${parsed.platform === 'youtube_music' ? 'YouTube Music' : 'YouTube'}`,
      author,
      thumbnail: playlistCover ?? tracks[0]?.thumbnail ?? null,
      totalCount,
      importedCount: tracks.length,
      omittedCount,
      truncated,
      tracks,
    };
  }
}

export class SpotifyPlaylistImportStubAdapter implements PlaylistImportAdapter {
  readonly platform: ImportPlatform = 'spotify';

  canHandle(parsed: ParsedPlaylistUrl): boolean {
    return parsed.platform === 'spotify';
  }

  async resolvePlaylist(_parsed: ParsedPlaylistUrl, _signal: AbortSignal): Promise<ImportedPlaylistPreview> {
    throw Object.assign(
      new WebError(
        501,
        'La importación de playlists de Spotify estará disponible próximamente. Por ahora puedes importar playlists públicas de YouTube y YouTube Music.',
      ),
      { errorCode: 'SPOTIFY_IMPORT_UNSUPPORTED' },
    );
  }
}

export function createPlaylistImportService(options: PlaylistImportServiceOptions = {}): PlaylistImportService {
  const executeYtDlp = options.runYtDlp ?? ((input, flags, signal) => runYtDlp(input, flags, signal, 'interactive'));
  const pageSize = options.pageSize ?? DEFAULT_IMPORT_PAGE_SIZE;
  const maxTracks = options.maxTracks ?? DEFAULT_IMPORT_MAX_TRACKS;
  const adapters: PlaylistImportAdapter[] = options.adapters ?? [
    new YouTubePlaylistImportAdapter('youtube', executeYtDlp, pageSize, maxTracks),
    new YouTubePlaylistImportAdapter('youtube_music', executeYtDlp, pageSize, maxTracks),
    new SpotifyPlaylistImportStubAdapter(),
  ];

  return {
    parseUrl(rawUrl: unknown): ParsedPlaylistUrl {
      return parsePlaylistImportUrl(rawUrl);
    },
    async previewPlaylist(rawUrl: unknown, signal: AbortSignal): Promise<ImportedPlaylistPreview> {
      const parsed = parsePlaylistImportUrl(rawUrl);
      const adapter = adapters.find(candidate => candidate.canHandle(parsed));
      if (!adapter) {
        throw new WebError(400, 'No hay un adaptador disponible para esta plataforma.');
      }
      return adapter.resolvePlaylist(parsed, signal);
    },
  };
}
