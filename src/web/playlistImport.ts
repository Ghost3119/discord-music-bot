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

export interface PlaylistImportCsvInput {
  csv: unknown;
  name?: unknown;
  sourceName?: unknown;
}

export interface SpotifyPlaylistImportAdapterOptions {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string | (() => Promise<string | null> | string | null);
  fetchImpl?: typeof fetch;
  pageSize?: number;
  maxTracks?: number;
}

export interface PlaylistImportService {
  parseUrl(rawUrl: unknown): ParsedPlaylistUrl;
  previewPlaylist(rawUrl: unknown, signal: AbortSignal): Promise<ImportedPlaylistPreview>;
  previewCsv(input: PlaylistImportCsvInput, maxTracks?: number): ImportedPlaylistPreview;
}

export type YtDlpExecutor = (input: string, flags?: YtDlpFlags, signal?: AbortSignal) => Promise<unknown>;

export interface PlaylistImportServiceOptions {
  runYtDlp?: YtDlpExecutor;
  adapters?: PlaylistImportAdapter[];
  spotify?: SpotifyPlaylistImportAdapterOptions;
  pageSize?: number;
  maxTracks?: number;
}

export const DEFAULT_IMPORT_PAGE_SIZE = 100;
export const DEFAULT_IMPORT_MAX_TRACKS = 500;
export const MAX_IMPORT_CSV_BYTES = 262_144;
const MAX_TRACK_DURATION_SECONDS = 604_800;

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

interface SpotifyImageObject {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

interface SpotifyArtistObject {
  name?: unknown;
}

interface SpotifyTrackObject {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  is_local?: unknown;
  duration_ms?: unknown;
  artists?: unknown;
  album?: {
    name?: unknown;
    images?: unknown;
  } | null;
}

interface SpotifyPlaylistItemObject {
  is_local?: unknown;
  track?: SpotifyTrackObject | null;
  item?: SpotifyTrackObject | null;
}

interface SpotifyPlaylistResponse {
  id?: unknown;
  name?: unknown;
  owner?: { display_name?: unknown } | null;
  images?: unknown;
  tracks?: {
    total?: unknown;
    items?: unknown;
    next?: unknown;
  } | null;
}

function pickSpotifyImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  let bestUrl: string | null = null;
  let bestArea = -1;
  for (const raw of images) {
    if (!raw || typeof raw !== 'object') continue;
    const img = raw as SpotifyImageObject;
    const safe = sanitizeThumbnailUrl(img.url);
    if (!safe) continue;
    const w = typeof img.width === 'number' && Number.isFinite(img.width) ? img.width : 0;
    const h = typeof img.height === 'number' && Number.isFinite(img.height) ? img.height : 0;
    const area = w * h;
    if (area >= bestArea) {
      bestArea = area;
      bestUrl = safe;
    }
  }
  return bestUrl;
}

function mapSpotifyHttpError(status: number): WebError {
  if (status === 401) {
    return Object.assign(
      new WebError(
        401,
        'Tu sesión de Spotify expiró o no está conectada. Vuelve a autorizar Spotify o importa la playlist mediante CSV.',
      ),
      { errorCode: 'SPOTIFY_NOT_CONNECTED' },
    );
  }
  if (status === 403) {
    return Object.assign(
      new WebError(
        403,
        'Spotify denegó el acceso a esta playlist (permisos insuficientes o límite de 5 usuarios en Development Mode). Usa la pestaña «Archivo CSV».',
      ),
      { errorCode: 'SPOTIFY_INSUFFICIENT_PERMISSIONS' },
    );
  }
  if (status === 404) {
    return Object.assign(
      new WebError(
        404,
        'La playlist de Spotify no es accesible (puede ser privada, editorial/algorítmica o restringida por Spotify en Development Mode). Usa la pestaña «Archivo CSV».',
      ),
      { errorCode: 'SPOTIFY_PLAYLIST_INACCESSIBLE' },
    );
  }
  if (status === 429) {
    return Object.assign(
      new WebError(
        429,
        'Spotify aplicó un límite de solicitudes (Rate Limit). Espera unos segundos o importa la playlist mediante CSV.',
      ),
      { errorCode: 'SPOTIFY_RATE_LIMITED' },
    );
  }
  return Object.assign(
    new WebError(
      502,
      'No se pudo consultar la API de Spotify en este momento. Inténtalo de nuevo o usa la importación por CSV.',
    ),
    { errorCode: 'SPOTIFY_UPSTREAM_ERROR' },
  );
}

export class SpotifyPlaylistImportAdapter implements PlaylistImportAdapter {
  readonly platform: ImportPlatform = 'spotify';
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly accessTokenProvider?: string | (() => Promise<string | null> | string | null);
  private readonly fetchImpl: typeof fetch;
  private readonly pageSize: number;
  private readonly maxTracks: number;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(options: SpotifyPlaylistImportAdapterOptions = {}) {
    this.clientId = options.clientId?.trim() ?? '';
    this.clientSecret = options.clientSecret?.trim() ?? '';
    if (options.accessToken !== undefined) {
      this.accessTokenProvider = options.accessToken;
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pageSize = Math.max(1, Math.min(100, options.pageSize ?? 100));
    this.maxTracks = Math.max(1, Math.min(DEFAULT_IMPORT_MAX_TRACKS, options.maxTracks ?? DEFAULT_IMPORT_MAX_TRACKS));
  }

  canHandle(parsed: ParsedPlaylistUrl): boolean {
    return parsed.platform === 'spotify';
  }

  isConfigured(): boolean {
    return Boolean(this.accessTokenProvider || (this.clientId && this.clientSecret));
  }

  private async resolveAccessToken(signal: AbortSignal): Promise<string> {
    if (typeof this.accessTokenProvider === 'function') {
      const token = await this.accessTokenProvider();
      if (token && token.trim()) return token.trim();
      throw mapSpotifyHttpError(401);
    }
    if (typeof this.accessTokenProvider === 'string' && this.accessTokenProvider.trim()) {
      return this.accessTokenProvider.trim();
    }
    if (!this.clientId || !this.clientSecret) {
      throw Object.assign(
        new WebError(
          501,
          'La conexión directa con Spotify requiere credenciales OAuth/Premium y autorización en Development Mode. Puedes importar cualquier playlist de Spotify desde la pestaña «Archivo CSV».',
        ),
        { errorCode: 'SPOTIFY_IMPORT_UNSUPPORTED' },
      );
    }
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.token;
    }
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`, 'utf8').toString('base64');
    let res: Response;
    try {
      res = await this.fetchImpl('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw new WebError(409, 'La consulta de la playlist fue cancelada.');
      throw mapSpotifyHttpError(502);
    }
    if (!res.ok) {
      throw mapSpotifyHttpError(res.status);
    }
    const payload = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    const token = typeof payload?.access_token === 'string' ? payload.access_token.trim() : '';
    if (!token) throw mapSpotifyHttpError(401);
    const expiresIn = typeof payload?.expires_in === 'number' && payload.expires_in > 60 ? payload.expires_in : 3600;
    this.cachedToken = { token, expiresAt: Date.now() + (expiresIn - 30) * 1000 };
    return token;
  }

  async resolvePlaylist(parsed: ParsedPlaylistUrl, signal: AbortSignal): Promise<ImportedPlaylistPreview> {
    signal.throwIfAborted();
    const token = await this.resolveAccessToken(signal);
    signal.throwIfAborted();

    const metaUrl = `https://api.spotify.com/v1/playlists/${encodeURIComponent(parsed.playlistId)}`;
    let metaRes: Response;
    try {
      metaRes = await this.fetchImpl(metaUrl, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
    } catch {
      if (signal.aborted) throw new WebError(409, 'La consulta de la playlist fue cancelada.');
      throw mapSpotifyHttpError(502);
    }
    if (!metaRes.ok) {
      throw mapSpotifyHttpError(metaRes.status);
    }

    const meta = (await metaRes.json()) as SpotifyPlaylistResponse;
    const title = cleanText(meta.name, 200) || 'Playlist de Spotify';
    const author = cleanText(meta.owner?.display_name, 120) || null;
    const playlistCover = pickSpotifyImage(meta.images);
    const reportedTotal =
      typeof meta.tracks?.total === 'number' && Number.isFinite(meta.tracks.total) && meta.tracks.total >= 0
        ? Math.round(meta.tracks.total)
        : 0;

    const tracks: ImportedPlaylistTrack[] = [];
    let omittedCount = 0;
    let rawFetchedCount = 0;
    let truncated = false;

    const consumeItems = (items: unknown[]) => {
      for (const rawItem of items) {
        if (tracks.length >= this.maxTracks) {
          truncated = true;
          break;
        }
        rawFetchedCount += 1;
        if (!rawItem || typeof rawItem !== 'object') {
          omittedCount += 1;
          continue;
        }
        const item = rawItem as SpotifyPlaylistItemObject;
        const track = item.track ?? item.item;
        if (item.is_local === true || !track || typeof track !== 'object' || track.is_local === true) {
          omittedCount += 1;
          continue;
        }
        if (typeof track.type === 'string' && track.type !== 'track') {
          omittedCount += 1;
          continue;
        }
        const trackId = typeof track.id === 'string' && /^[A-Za-z0-9]{22}$/.test(track.id.trim()) ? track.id.trim() : '';
        const trackTitle = cleanText(track.name, 300);
        if (!trackId || !trackTitle) {
          omittedCount += 1;
          continue;
        }
        const artistNames = Array.isArray(track.artists)
          ? track.artists
              .map(a => cleanText((a as SpotifyArtistObject | null)?.name, 120))
              .filter(Boolean)
              .join(', ')
          : '';
        const artist = cleanText(artistNames, 300) || 'Artista desconocido';
        const album = cleanText(track.album?.name, 200) || undefined;
        const duration =
          typeof track.duration_ms === 'number' && Number.isFinite(track.duration_ms) && track.duration_ms > 0
            ? Math.min(MAX_TRACK_DURATION_SECONDS, Math.round(track.duration_ms / 1000))
            : 0;
        const thumbnail = pickSpotifyImage(track.album?.images);

        tracks.push({
          url: `https://open.spotify.com/track/${trackId}`,
          title: trackTitle,
          artist,
          ...(album ? { album } : {}),
          duration,
          thumbnail,
          source: 'spotify',
          sourceId: trackId,
          platform: 'spotify',
          position: tracks.length,
        });
      }
    };

    const initialItems = Array.isArray(meta.tracks?.items) ? meta.tracks.items : null;
    let offset = 0;
    if (initialItems) {
      consumeItems(initialItems);
      offset = initialItems.length;
    }

    while (tracks.length < this.maxTracks && (initialItems === null || offset < reportedTotal)) {
      signal.throwIfAborted();
      const limit = Math.min(this.pageSize, this.maxTracks - tracks.length);
      const tracksUrl = `https://api.spotify.com/v1/playlists/${encodeURIComponent(parsed.playlistId)}/tracks?offset=${offset}&limit=${limit}`;
      let pageRes: Response;
      try {
        pageRes = await this.fetchImpl(tracksUrl, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
      } catch {
        if (signal.aborted) throw new WebError(409, 'La consulta de la playlist fue cancelada.');
        throw mapSpotifyHttpError(502);
      }
      if (!pageRes.ok) {
        throw mapSpotifyHttpError(pageRes.status);
      }
      const pageData = (await pageRes.json()) as { items?: unknown; total?: unknown; next?: unknown };
      const pageItems = Array.isArray(pageData.items) ? pageData.items : [];
      if (pageItems.length === 0) break;
      consumeItems(pageItems);
      offset += pageItems.length;
      if (!pageData.next || pageItems.length < limit) break;
    }

    if (tracks.length === 0) {
      throw Object.assign(
        new WebError(
          422,
          omittedCount > 0
            ? 'La playlist de Spotify solo contiene episodios o archivos locales no compatibles.'
            : 'La playlist de Spotify está vacía.',
        ),
        { errorCode: 'PLAYLIST_EMPTY' },
      );
    }

    const totalCount = Math.max(reportedTotal, rawFetchedCount);
    if (reportedTotal > this.maxTracks) {
      truncated = true;
    }

    return {
      platform: 'spotify',
      playlistId: parsed.playlistId,
      sourceUrl: parsed.sourceUrl,
      title,
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

export class SpotifyPlaylistImportStubAdapter extends SpotifyPlaylistImportAdapter {
  constructor() {
    super();
  }
}

function normalizeHeaderKey(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

function detectCsvDelimiter(headerLine: string): ',' | ';' | '\t' {
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;
  let tabs = 0;
  for (let i = 0; i < headerLine.length; i++) {
    const ch = headerLine[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === ',') commas++;
      else if (ch === ';') semicolons++;
      else if (ch === '\t') tabs++;
    }
  }
  if (semicolons > commas && semicolons >= tabs) return ';';
  if (tabs > commas && tabs > semicolons) return '\t';
  return ',';
}

function parseCsvRows(text: string, delimiter: ',' | ';' | '\t'): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (currentField.trim().length === 0) {
        currentField = '';
        inQuotes = true;
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === delimiter) {
      currentRow.push(currentField);
      currentField = '';
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      continue;
    }

    currentField += ch;
  }

  if (inQuotes) {
    throw Object.assign(
      new WebError(400, 'El archivo CSV tiene comillas sin cerrar o un formato malformado.'),
      { errorCode: 'CSV_MALFORMED' },
    );
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

function parseCsvDurationSeconds(raw: string | undefined, isMillisColumn: boolean): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(trimmed)) {
    const parts = trimmed.split(':').map(Number);
    const seconds =
      parts.length === 3
        ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
        : parts[0]! * 60 + parts[1]!;
    return Math.min(MAX_TRACK_DURATION_SECONDS, Math.max(0, seconds));
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const seconds = isMillisColumn || numeric > 10_800 ? Math.round(numeric / 1000) : Math.round(numeric);
  return Math.min(MAX_TRACK_DURATION_SECONDS, Math.max(0, seconds));
}

function resolveCsvTrackOrigin(
  rawOrigin: string,
  artist: string,
  title: string,
  position: number,
): { url: string; source: string; sourceId: string; thumbnail: string | null } | null {
  const candidate = rawOrigin.trim();
  if (!candidate) {
    const searchQuery = `${artist} - ${title}`.slice(0, 300);
    return {
      url: `https://music.youtube.com/search?q=${encodeURIComponent(searchQuery)}`,
      source: 'csv',
      sourceId: `csv-${position + 1}`,
      thumbnail: null,
    };
  }

  const spotifyUriMatch = /^spotify:track:([A-Za-z0-9]{22})$/i.exec(candidate);
  if (spotifyUriMatch?.[1]) {
    const id = spotifyUriMatch[1];
    return {
      url: `https://open.spotify.com/track/${id}`,
      source: 'spotify',
      sourceId: id,
      thumbnail: null,
    };
  }

  if (/^[A-Za-z0-9]{22}$/.test(candidate)) {
    return {
      url: `https://open.spotify.com/track/${candidate}`,
      source: 'spotify',
      sourceId: candidate,
      thumbnail: null,
    };
  }

  if (/^[\w-]{11}$/.test(candidate)) {
    return {
      url: `https://www.youtube.com/watch?v=${candidate}`,
      source: 'youtube',
      sourceId: candidate,
      thumbnail: `https://i.ytimg.com/vi/${candidate}/hqdefault.jpg`,
    };
  }

  try {
    const resolved = publicTrackUrl(candidate);
    if (resolved.source === 'csv') return null;
    const parsed = new URL(resolved.url);
    const sourceId =
      resolved.source === 'youtube'
        ? (parsed.searchParams.get('v') ?? `yt-${position + 1}`)
        : (parsed.pathname.split('/').filter(Boolean).at(-1) ?? `trk-${position + 1}`);
    return {
      url: resolved.url,
      source: resolved.source,
      sourceId,
      thumbnail: resolved.source === 'youtube' ? `https://i.ytimg.com/vi/${sourceId}/hqdefault.jpg` : null,
    };
  } catch {
    return null;
  }
}

const TITLE_HEADERS = new Set([
  'title',
  'titulo',
  'track name',
  'track',
  'song',
  'song name',
  'name',
  'cancion',
  'nombre',
]);
const ARTIST_HEADERS = new Set([
  'artist',
  'artista',
  'artist name(s)',
  'artist names',
  'artist name',
  'artists',
  'artistas',
  'interprete',
]);
const ALBUM_HEADERS = new Set(['album', 'album name', 'nombre del album', 'disco']);
const DURATION_MS_HEADERS = new Set(['duration (ms)', 'duration ms', 'milliseconds', 'duracion (ms)', 'duracion ms']);
const DURATION_SEC_HEADERS = new Set(['duration', 'duracion', 'duration (s)', 'duration s', 'time', 'length']);
const ORIGIN_HEADERS = new Set([
  'url',
  'track url',
  'spotify url',
  'external url',
  'link',
  'enlace',
  'spotify uri',
  'track uri',
  'uri',
  'track id',
  'spotify id',
  'id',
  'source id',
  'youtube id',
  'video id',
]);

export function parsePlaylistImportCsv(
  input: PlaylistImportCsvInput,
  maxTracks = DEFAULT_IMPORT_MAX_TRACKS,
): ImportedPlaylistPreview {
  if (typeof input.csv !== 'string') {
    throw Object.assign(new WebError(400, 'Proporciona el contenido del archivo CSV en texto UTF-8.'), {
      errorCode: 'CSV_INVALID_INPUT',
    });
  }
  const byteLength = Buffer.byteLength(input.csv, 'utf8');
  if (byteLength > MAX_IMPORT_CSV_BYTES) {
    throw Object.assign(
      new WebError(413, 'El archivo CSV supera el tamaño máximo permitido (256 KB).'),
      { errorCode: 'CSV_TOO_LARGE' },
    );
  }
  if (input.csv.includes('\u0000') || input.csv.includes('\uFFFD')) {
    throw Object.assign(
      new WebError(400, 'El archivo CSV contiene caracteres inválidos. Guárdalo con codificación UTF-8.'),
      { errorCode: 'CSV_INVALID_ENCODING' },
    );
  }

  const stripped = input.csv.replace(/^\uFEFF/, '').trim();
  if (!stripped) {
    throw Object.assign(new WebError(400, 'El archivo CSV está vacío.'), {
      errorCode: 'CSV_EMPTY',
    });
  }

  const firstLineEnd = stripped.search(/\r|\n/);
  const firstLine = firstLineEnd === -1 ? stripped : stripped.slice(0, firstLineEnd);
  const delimiter = detectCsvDelimiter(firstLine);
  const rows = parseCsvRows(stripped, delimiter).filter(row => row.some(cell => cell.trim().length > 0));

  if (rows.length < 2) {
    throw Object.assign(
      new WebError(400, 'El CSV debe incluir una fila de encabezados y al menos una canción.'),
      { errorCode: 'CSV_EMPTY' },
    );
  }

  const headerRow = rows[0]!.map(normalizeHeaderKey);
  const titleIdx = headerRow.findIndex(col => TITLE_HEADERS.has(col));
  const artistIdx = headerRow.findIndex(col => ARTIST_HEADERS.has(col));
  if (titleIdx === -1 || artistIdx === -1) {
    throw Object.assign(
      new WebError(
        400,
        'El CSV debe incluir las columnas obligatorias «title» (o «Track Name» / «Título») y «artist» (o «Artist Name(s)» / «Artista»).',
      ),
      { errorCode: 'CSV_MISSING_COLUMNS' },
    );
  }

  const albumIdx = headerRow.findIndex(col => ALBUM_HEADERS.has(col));
  const durationMsIdx = headerRow.findIndex(col => DURATION_MS_HEADERS.has(col));
  const durationSecIdx = headerRow.findIndex(col => DURATION_SEC_HEADERS.has(col));
  const durationIdx = durationMsIdx !== -1 ? durationMsIdx : durationSecIdx;
  const isMillisColumn = durationMsIdx !== -1;

  const originIndices: number[] = [];
  headerRow.forEach((col, index) => {
    if (ORIGIN_HEADERS.has(col)) originIndices.push(index);
  });

  const tracks: ImportedPlaylistTrack[] = [];
  let omittedCount = 0;
  let totalCount = 0;
  let truncated = false;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    totalCount += 1;
    if (tracks.length >= maxTracks) {
      truncated = true;
      continue;
    }

    const title = cleanText(row[titleIdx], 300);
    const rawArtist = cleanText(row[artistIdx], 300).replace(/\s*;\s*/g, ', ');
    if (!title || !rawArtist) {
      omittedCount += 1;
      continue;
    }

    const album = albumIdx >= 0 ? cleanText(row[albumIdx], 200) || undefined : undefined;
    const duration = durationIdx >= 0 ? parseCsvDurationSeconds(row[durationIdx], isMillisColumn) : 0;

    let rawOrigin = '';
    for (const idx of originIndices) {
      const val = row[idx]?.trim();
      if (val) {
        rawOrigin = val;
        break;
      }
    }

    const origin = resolveCsvTrackOrigin(rawOrigin, rawArtist, title, tracks.length);
    if (!origin) {
      omittedCount += 1;
      continue;
    }

    tracks.push({
      url: origin.url,
      title,
      artist: rawArtist,
      ...(album ? { album } : {}),
      duration,
      thumbnail: origin.thumbnail,
      source: origin.source,
      sourceId: origin.sourceId,
      platform: 'csv',
      position: tracks.length,
    });
  }

  if (tracks.length === 0) {
    throw Object.assign(
      new WebError(
        422,
        omittedCount > 0
          ? 'Ninguna fila del CSV contenía una canción válida con título, artista y enlace permitido.'
          : 'El archivo CSV no contiene canciones para importar.',
      ),
      { errorCode: 'CSV_EMPTY' },
    );
  }

  const explicitName = cleanText(input.name, 100);
  const derivedFromFile = cleanText(
    typeof input.sourceName === 'string' ? input.sourceName.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ') : '',
    100,
  );
  const playlistTitle = explicitName || derivedFromFile || 'Playlist importada (CSV)';

  return {
    platform: 'csv',
    playlistId: 'csv-import',
    sourceUrl: 'https://music.youtube.com/search?q=playlist',
    title: playlistTitle,
    author: 'Archivo CSV',
    thumbnail: tracks.find(t => t.thumbnail)?.thumbnail ?? null,
    totalCount,
    importedCount: tracks.length,
    omittedCount,
    truncated,
    tracks,
  };
}

export function createPlaylistImportService(options: PlaylistImportServiceOptions = {}): PlaylistImportService {
  const executeYtDlp = options.runYtDlp ?? ((input, flags, signal) => runYtDlp(input, flags, signal, 'interactive'));
  const pageSize = options.pageSize ?? DEFAULT_IMPORT_PAGE_SIZE;
  const maxTracks = options.maxTracks ?? DEFAULT_IMPORT_MAX_TRACKS;
  const adapters: PlaylistImportAdapter[] = options.adapters ?? [
    new YouTubePlaylistImportAdapter('youtube', executeYtDlp, pageSize, maxTracks),
    new YouTubePlaylistImportAdapter('youtube_music', executeYtDlp, pageSize, maxTracks),
    new SpotifyPlaylistImportAdapter({ pageSize, maxTracks, ...options.spotify }),
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
    previewCsv(input: PlaylistImportCsvInput, limit = maxTracks): ImportedPlaylistPreview {
      return parsePlaylistImportCsv(input, limit);
    },
  };
}
