import type {
  MusicSearchPlatform,
  MusicSearchProviderId,
  MusicSearchProviderStatus,
  MusicSearchResponse,
  MusicSearchTrack,
} from './contracts';
import { WebError } from './database';
import { publicTrackUrl, sanitizeThumbnailUrl } from './validation';
import { runYtDlp, type YtDlpFlags } from '../music/ytDlpRunner';
import { classifyMusicError } from '../music/errors';
import { youtubeThumbnail } from '../music/artwork';

export type {
  MusicSearchPlatform,
  MusicSearchProviderId,
  MusicSearchProviderStatus,
  MusicSearchResponse,
  MusicSearchTrack,
} from './contracts';

export type YtDlpSearchExecutor = (
  input: string,
  flags?: YtDlpFlags,
  signal?: AbortSignal,
) => Promise<unknown>;

export interface MusicSearchProvider {
  readonly platform: MusicSearchProviderId;
  search(query: string, limit: number, signal: AbortSignal): Promise<MusicSearchTrack[]>;
}

export interface MusicSearchQueryInput {
  query: unknown;
  platform?: unknown;
  limit?: unknown;
}

export interface ValidatedMusicSearchQuery {
  query: string;
  platform: MusicSearchPlatform;
  limit: number;
}

export interface MusicSearchService {
  validateQuery(input: MusicSearchQueryInput): ValidatedMusicSearchQuery;
  search(input: MusicSearchQueryInput, signal: AbortSignal): Promise<MusicSearchResponse>;
}

export interface MusicSearchServiceOptions {
  runYtDlp?: YtDlpSearchExecutor;
  fetch?: typeof fetch;
  providers?: MusicSearchProvider[];
  providerTimeoutMs?: number;
  cacheTtlMs?: number;
  maxConcurrentSearches?: number;
}

export const DEFAULT_SEARCH_LIMIT = 8;
export const DEFAULT_ALL_PROVIDER_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 15;
export const MAX_QUERY_LENGTH = 200;

interface RawSearchThumb {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

interface RawSearchEntry {
  _type?: unknown;
  id?: unknown;
  title?: unknown;
  fulltitle?: unknown;
  track?: unknown;
  url?: unknown;
  webpage_url?: unknown;
  original_url?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  thumbnails?: unknown;
  uploader?: unknown;
  channel?: unknown;
  artist?: unknown;
  artists?: unknown;
  creators?: unknown;
  availability?: unknown;
  is_live?: unknown;
  live_status?: unknown;
  ie_key?: unknown;
  extractor?: unknown;
}

interface RawSearchContainer {
  entries?: unknown;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

class SimpleTtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly maxItems: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    const now = Date.now();
    for (const [k, item] of this.store) {
      if (item.expiresAt <= now) this.store.delete(k);
    }
    this.store.set(key, { expiresAt: now + this.ttlMs, value });
    while (this.store.size > this.maxItems) {
      const oldest = this.store.keys().next().value;
      if (!oldest) break;
      this.store.delete(oldest);
    }
  }
}

function cleanText(value: unknown, max = 300): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function cleanArtistName(value: unknown): string {
  const raw = cleanText(value, 300);
  if (!raw) return '';
  return raw.replace(/\s*-\s*Topic$/i, '').trim();
}

function firstArrayString(value: unknown): string {
  if (!Array.isArray(value)) return '';
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
      const name = ((item as { name: string }).name).trim();
      if (name) return name;
    }
  }
  return '';
}

function inferArtistFromTitle(title: string): string {
  const match = /^([^—–-]{2,80}?)\s+[-–—]\s+(.{2,})$/u.exec(title);
  if (!match?.[1]) return '';
  return cleanArtistName(match[1]);
}

export function pickBestThumbnail(rawThumb: unknown, rawThumbs: unknown): string | null {
  let bestFromList: string | null = null;
  let bestScore = -1;
  if (Array.isArray(rawThumbs)) {
    for (const item of rawThumbs) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as RawSearchThumb;
      const safe = sanitizeThumbnailUrl(candidate.url);
      if (!safe) continue;
      const width = typeof candidate.width === 'number' && Number.isFinite(candidate.width) ? candidate.width : 0;
      const height = typeof candidate.height === 'number' && Number.isFinite(candidate.height) ? candidate.height : 0;
      // Prefer sized artwork (e.g. 500x500 or 480x360) over unsized original files
      const area = width > 0 && height > 0 ? Math.min(width * height, 1_000_000) : 1;
      if (area >= bestScore) {
        bestScore = area;
        bestFromList = safe;
      }
    }
  }
  const direct = sanitizeThumbnailUrl(rawThumb);
  if (bestScore > 1 && bestFromList) return bestFromList;
  return direct ?? bestFromList;
}

function isUnavailableEntry(entry: RawSearchEntry, title: string): boolean {
  const lower = title.toLowerCase();
  if (
    !lower ||
    lower === '[private video]' ||
    lower === '[deleted video]' ||
    lower === 'private video' ||
    lower === 'deleted video' ||
    lower === '[unavailable video]'
  ) {
    return true;
  }
  if (entry.is_live === true || entry.live_status === 'is_live') {
    return true;
  }
  if (typeof entry.availability === 'string') {
    const avail = entry.availability.toLowerCase();
    if (['private', 'needs_auth', 'subscriber_only', 'premium_only'].includes(avail)) {
      return true;
    }
  }
  return false;
}

export function normalizeSearchEntry(
  entry: RawSearchEntry,
  platform: MusicSearchProviderId,
): MusicSearchTrack | null {
  if (!entry || typeof entry !== 'object') return null;

  const rawTitle = cleanText(
    platform === 'soundcloud'
      ? (entry.title ?? entry.track ?? entry.fulltitle)
      : (entry.title ?? entry.fulltitle ?? entry.track),
    300,
  );
  if (isUnavailableEntry(entry, rawTitle)) return null;

  const rawId =
    typeof entry.id === 'string'
      ? entry.id.trim()
      : typeof entry.id === 'number'
        ? String(entry.id)
        : '';

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

  if (!normalizedUrl && platform !== 'soundcloud') {
    if (/^[\w-]{11}$/.test(rawId)) {
      normalizedUrl = { url: `https://www.youtube.com/watch?v=${rawId}`, source: 'youtube' };
    } else if (/^[\w-]{11}$/.test(candidateUrl)) {
      normalizedUrl = { url: `https://www.youtube.com/watch?v=${candidateUrl}`, source: 'youtube' };
    }
  }

  if (!normalizedUrl) return null;
  if (platform === 'soundcloud' && normalizedUrl.source !== 'soundcloud') return null;
  if (platform !== 'soundcloud' && normalizedUrl.source !== 'youtube') return null;

  const source = normalizedUrl.source as 'youtube' | 'soundcloud';
  const videoId = source === 'youtube' ? (new URL(normalizedUrl.url).searchParams.get('v') ?? rawId) : '';
  const sourceId =
    source === 'youtube' && /^[\w-]{11}$/.test(videoId)
      ? videoId
      : rawId || normalizedUrl.url;

  const rawChannel = cleanText(entry.channel ?? entry.uploader, 300) || null;
  const explicitArtist =
    cleanArtistName(entry.artist) ||
    cleanArtistName(firstArrayString(entry.artists)) ||
    cleanArtistName(firstArrayString(entry.creators)) ||
    cleanArtistName(entry.uploader) ||
    cleanArtistName(entry.channel);

  const artist = explicitArtist || inferArtistFromTitle(rawTitle) || 'Artista desconocido';
  const duration =
    typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration > 0
      ? Math.min(604_800, Math.round(entry.duration))
      : 0;

  const thumbnail =
    pickBestThumbnail(entry.thumbnail, entry.thumbnails) ??
    (source === 'youtube' ? (youtubeThumbnail('youtube', sourceId, normalizedUrl.url) ?? null) : null);

  return {
    id: `${platform}:${sourceId}`,
    url: normalizedUrl.url,
    title: rawTitle,
    artist,
    channel: rawChannel,
    duration,
    thumbnail,
    source,
    sourceId,
    platform,
  };
}

function extractEntries(raw: unknown): RawSearchEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const container = raw as RawSearchContainer;
  if (Array.isArray(container.entries)) {
    return container.entries.filter((item): item is RawSearchEntry => Boolean(item && typeof item === 'object'));
  }
  return [raw as RawSearchEntry];
}

async function runBoundedConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const count = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: count }, async () => {
      while (index < items.length) {
        const current = items[index++];
        if (current !== undefined) await worker(current);
      }
    }),
  );
}

const oembedArtistCache = new SimpleTtlCache<{ artist: string; channel: string | null; thumbnail: string | null }>(
  400,
  30 * 60 * 1000,
);

async function enrichYouTubeMusicEntries(
  tracks: MusicSearchTrack[],
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<MusicSearchTrack[]> {
  const needsEnrichment = tracks.filter(
    (track) => !track.artist || track.artist === 'Artista desconocido',
  );
  if (!needsEnrichment.length) return tracks;

  await runBoundedConcurrency(needsEnrichment, 4, async (track) => {
    if (signal.aborted) return;
    const cached = oembedArtistCache.get(track.sourceId);
    if (cached) {
      if (cached.artist) track.artist = cached.artist;
      if (cached.channel && !track.channel) track.channel = cached.channel;
      if (cached.thumbnail && !track.thumbnail) track.thumbnail = cached.thumbnail;
      return;
    }
    try {
      const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(track.url)}&format=json`;
      const response = await fetchImpl(endpoint, {
        signal: AbortSignal.any([AbortSignal.timeout(2_500), signal]),
      });
      if (!response.ok) return;
      const data = (await response.json()) as Record<string, unknown>;
      const rawAuthor = cleanText(data['author_name'], 300);
      const cleanedArtist = cleanArtistName(rawAuthor);
      const safeThumb = sanitizeThumbnailUrl(data['thumbnail_url']);
      if (cleanedArtist) {
        oembedArtistCache.set(track.sourceId, {
          artist: cleanedArtist,
          channel: rawAuthor || null,
          thumbnail: safeThumb,
        });
        track.artist = cleanedArtist;
        if (!track.channel && rawAuthor) track.channel = rawAuthor;
        if (!track.thumbnail && safeThumb) track.thumbnail = safeThumb;
      }
    } catch {
      // Never fail a search when optional oEmbed artist enrichment times out or is unavailable.
    }
  });

  return tracks;
}

function deduplicateTracks(tracks: MusicSearchTrack[], limit: number): MusicSearchTrack[] {
  const byKey = new Map<string, MusicSearchTrack>();
  for (const track of tracks) {
    const key = `${track.source}:${track.sourceId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...track });
      if (byKey.size >= limit) break;
      continue;
    }
    if (existing.duration === 0 && track.duration > 0) existing.duration = track.duration;
    if (existing.artist === 'Artista desconocido' && track.artist !== 'Artista desconocido') {
      existing.artist = track.artist;
    }
    if (!existing.channel && track.channel) existing.channel = track.channel;
    if (!existing.thumbnail && track.thumbnail) existing.thumbnail = track.thumbnail;
  }
  return [...byKey.values()].slice(0, limit);
}

export class YouTubeMusicSearchProvider implements MusicSearchProvider {
  readonly platform: MusicSearchProviderId = 'youtube_music';

  constructor(
    private readonly executeYtDlp: YtDlpSearchExecutor,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, limit: number, signal: AbortSignal): Promise<MusicSearchTrack[]> {
    signal.throwIfAborted();
    const searchUrl = `https://music.youtube.com/search?${new URLSearchParams({ q: query })}#songs`;
    const flags: YtDlpFlags = {
      dumpSingleJson: true,
      flatPlaylist: true,
      playlistEnd: limit,
      noWarnings: true,
      preferFreeFormats: true,
      skipDownload: true,
      simulate: true,
      jsRuntimes: `node:${process.execPath}`,
    };

    const raw = await this.executeYtDlp(searchUrl, flags, signal);
    signal.throwIfAborted();

    let tracks = extractEntries(raw)
      .map((entry) => normalizeSearchEntry(entry, 'youtube_music'))
      .filter((item): item is MusicSearchTrack => item !== null);

    tracks = deduplicateTracks(tracks, limit);
    if (tracks.length > 0) {
      await enrichYouTubeMusicEntries(tracks, this.fetchImpl, signal);
    }
    return tracks;
  }
}

export class YouTubeSearchProvider implements MusicSearchProvider {
  readonly platform: MusicSearchProviderId = 'youtube';

  constructor(private readonly executeYtDlp: YtDlpSearchExecutor) {}

  async search(query: string, limit: number, signal: AbortSignal): Promise<MusicSearchTrack[]> {
    signal.throwIfAborted();
    const flags: YtDlpFlags = {
      dumpSingleJson: true,
      flatPlaylist: true,
      playlistEnd: limit,
      noWarnings: true,
      preferFreeFormats: true,
      skipDownload: true,
      simulate: true,
      jsRuntimes: `node:${process.execPath}`,
    };
    const raw = await this.executeYtDlp(`ytsearch${limit}:${query}`, flags, signal);
    signal.throwIfAborted();
    const tracks = extractEntries(raw)
      .map((entry) => normalizeSearchEntry(entry, 'youtube'))
      .filter((item): item is MusicSearchTrack => item !== null);
    return deduplicateTracks(tracks, limit);
  }
}

export class SoundCloudSearchProvider implements MusicSearchProvider {
  readonly platform: MusicSearchProviderId = 'soundcloud';

  constructor(private readonly executeYtDlp: YtDlpSearchExecutor) {}

  async search(query: string, limit: number, signal: AbortSignal): Promise<MusicSearchTrack[]> {
    signal.throwIfAborted();
    const flags: YtDlpFlags = {
      dumpSingleJson: true,
      flatPlaylist: true,
      playlistEnd: limit,
      noWarnings: true,
      preferFreeFormats: true,
      skipDownload: true,
      simulate: true,
      jsRuntimes: `node:${process.execPath}`,
    };
    const raw = await this.executeYtDlp(`scsearch${limit}:${query}`, flags, signal);
    signal.throwIfAborted();
    const tracks = extractEntries(raw)
      .map((entry) => normalizeSearchEntry(entry, 'soundcloud'))
      .filter((item): item is MusicSearchTrack => item !== null);
    return deduplicateTracks(tracks, limit);
  }
}

export function validateMusicSearchQuery(input: MusicSearchQueryInput): ValidatedMusicSearchQuery {
  if (typeof input.query !== 'string') {
    throw new WebError(400, 'Introduce una canción o artista para buscar.');
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.query)) {
    throw new WebError(400, 'La consulta contiene caracteres no válidos.');
  }
  const trimmed = input.query.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    throw new WebError(400, 'Introduce una canción o artista para buscar.');
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new WebError(400, `La consulta no puede superar los ${MAX_QUERY_LENGTH} caracteres.`);
  }
  if (
    /(?:^|\s)(?:https?|ftp|file|data|javascript|ws|wss):\/\/|^[a-z][a-z0-9+.-]*:\/\/|^\/\//i.test(trimmed) ||
    /^(?:www\.|music\.youtube\.com\/|youtube\.com\/|youtu\.be\/|soundcloud\.com\/|open\.spotify\.com\/)/i.test(trimmed)
  ) {
    throw new WebError(400, 'Escribe el nombre de una canción o artista en lugar de un enlace.');
  }

  const sanitizedQuery = trimmed.replace(/^(?:ytsearch|scsearch)\d*:\s*/i, '').trim();
  if (!sanitizedQuery) {
    throw new WebError(400, 'Introduce una canción o artista para buscar.');
  }

  const rawPlatform = input.platform === undefined || input.platform === '' ? 'all' : input.platform;
  if (
    rawPlatform !== 'all' &&
    rawPlatform !== 'youtube_music' &&
    rawPlatform !== 'youtube' &&
    rawPlatform !== 'soundcloud'
  ) {
    throw new WebError(400, 'Plataforma de búsqueda no válida.');
  }

  let limit = rawPlatform === 'all' ? DEFAULT_ALL_PROVIDER_LIMIT : DEFAULT_SEARCH_LIMIT;
  if (input.limit !== undefined && input.limit !== '') {
    const parsed = typeof input.limit === 'string' ? Number(input.limit) : input.limit;
    if (
      typeof parsed !== 'number' ||
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_SEARCH_LIMIT
    ) {
      throw new WebError(400, `El límite de resultados debe estar entre 1 y ${MAX_SEARCH_LIMIT}.`);
    }
    limit = parsed;
  }

  return {
    query: sanitizedQuery,
    platform: rawPlatform,
    limit,
  };
}

function describeProviderFailure(error: unknown): string {
  const code = classifyMusicError(error);
  if (code === 'NETWORK_TIMEOUT') return 'Tiempo de espera agotado en el proveedor.';
  if (code === 'MUSIC_BUSY' || code === 'SOURCE_RATE_LIMITED') {
    return 'Proveedor temporalmente saturado.';
  }
  if (code === 'SOURCE_BLOCKED') return 'Proveedor temporalmente restringido.';
  return 'No se pudo consultar este proveedor.';
}

function mapFatalSearchError(errors: unknown[], signal: AbortSignal): WebError {
  if (signal.aborted) {
    return new WebError(409, 'La búsqueda fue cancelada.');
  }
  const codes = errors.map((err) => classifyMusicError(err));
  if (codes.includes('NETWORK_TIMEOUT')) {
    return Object.assign(
      new WebError(504, 'La búsqueda superó el tiempo de espera. Inténtalo de nuevo.'),
      { errorCode: 'MUSIC_SEARCH_TIMEOUT' },
    );
  }
  if (codes.includes('MUSIC_BUSY') || codes.includes('SOURCE_RATE_LIMITED')) {
    return new WebError(429, 'El buscador está ocupado con otras consultas. Espera unos segundos.');
  }
  return new WebError(502, 'No se pudo completar la búsqueda en este momento. Inténtalo de nuevo.');
}

function interleaveProviderTracks(
  lists: MusicSearchTrack[][],
  maxTotal: number,
): MusicSearchTrack[] {
  const interleaved: MusicSearchTrack[] = [];
  const maxLen = lists.reduce((max, list) => Math.max(max, list.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      const item = list[i];
      if (item) interleaved.push(item);
    }
  }
  return deduplicateTracks(interleaved, maxTotal);
}

interface PendingSearch {
  promise: Promise<MusicSearchResponse>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
}

export function createMusicSearchService(
  options: MusicSearchServiceOptions = {},
): MusicSearchService {
  const executeYtDlp: YtDlpSearchExecutor =
    options.runYtDlp ?? ((input, flags, signal) => runYtDlp(input, flags, signal, 'interactive'));
  const fetchImpl = options.fetch ?? fetch;
  const providerTimeoutMs = options.providerTimeoutMs ?? 15_000;
  const maxConcurrent = options.maxConcurrentSearches ?? 6;
  const cache = new SimpleTtlCache<MusicSearchResponse>(200, options.cacheTtlMs ?? 5 * 60 * 1000);
  const pendingSearches = new Map<string, PendingSearch>();

  const defaultProviders: MusicSearchProvider[] = [
    new YouTubeMusicSearchProvider(executeYtDlp, fetchImpl),
    new YouTubeSearchProvider(executeYtDlp),
    new SoundCloudSearchProvider(executeYtDlp),
  ];
  const providerMap = new Map<MusicSearchProviderId, MusicSearchProvider>();
  for (const provider of options.providers ?? defaultProviders) {
    providerMap.set(provider.platform, provider);
  }

  let activeCount = 0;
  const waitQueue: Array<{ resolve: () => void; reject: (err: unknown) => void; signal: AbortSignal }> = [];

  function acquireSlot(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (activeCount < maxConcurrent) {
      activeCount++;
      let released = false;
      return Promise.resolve(() => {
        if (released) return;
        released = true;
        activeCount--;
        const next = waitQueue.shift();
        next?.resolve();
      });
    }
    if (waitQueue.length >= maxConcurrent * 3) {
      return Promise.reject(
        new WebError(429, 'El buscador está ocupado con otras consultas. Espera unos segundos.'),
      );
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const idx = waitQueue.indexOf(entry);
        if (idx >= 0) waitQueue.splice(idx, 1);
        reject(new WebError(409, 'La búsqueda fue cancelada.'));
      };
      const entry = {
        signal,
        reject,
        resolve: () => {
          signal.removeEventListener('abort', onAbort);
          activeCount++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            activeCount--;
            const next = waitQueue.shift();
            next?.resolve();
          });
        },
      };
      signal.addEventListener('abort', onAbort, { once: true });
      waitQueue.push(entry);
    });
  }

  async function executeSearch(
    validated: ValidatedMusicSearchQuery,
    signal: AbortSignal,
  ): Promise<MusicSearchResponse> {
    const release = await acquireSlot(signal);
    try {
      const targetIds: MusicSearchProviderId[] =
        validated.platform === 'all'
          ? ['youtube_music', 'youtube', 'soundcloud']
          : [validated.platform];

      const selectedProviders = targetIds
        .map((id) => providerMap.get(id))
        .filter((p): p is MusicSearchProvider => Boolean(p));

      if (!selectedProviders.length) {
        throw new WebError(502, 'No hay proveedores de búsqueda disponibles.');
      }

      const perProviderLimit =
        validated.platform === 'all'
          ? Math.min(validated.limit, DEFAULT_ALL_PROVIDER_LIMIT)
          : validated.limit;

      const errors: unknown[] = [];
      const statuses: MusicSearchProviderStatus[] = [];
      const lists: MusicSearchTrack[][] = [];

      await Promise.all(
        selectedProviders.map(async (provider, idx) => {
          let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
          const timeoutController = new AbortController();
          const onParentAbort = () => timeoutController.abort(signal.reason);
          signal.addEventListener('abort', onParentAbort, { once: true });
          timeoutTimer = setTimeout(() => {
            const timeoutError = new Error('Search provider timed out');
            timeoutError.name = 'TimeoutError';
            timeoutController.abort(timeoutError);
          }, providerTimeoutMs);
          timeoutTimer.unref?.();

          try {
            const items = await provider.search(
              validated.query,
              perProviderLimit,
              timeoutController.signal,
            );
            lists[idx] = items;
            statuses[idx] = {
              platform: provider.platform,
              ok: true,
              count: items.length,
            };
          } catch (err) {
            if (signal.aborted) throw err;
            const actualError = timeoutController.signal.aborted
              ? (timeoutController.signal.reason ?? err)
              : err;
            errors.push(actualError);
            lists[idx] = [];
            statuses[idx] = {
              platform: provider.platform,
              ok: false,
              count: 0,
              error: describeProviderFailure(actualError),
            };
          } finally {
            clearTimeout(timeoutTimer);
            signal.removeEventListener('abort', onParentAbort);
          }
        }),
      );

      signal.throwIfAborted();

      const succeededCount = statuses.filter((s) => s?.ok).length;
      if (succeededCount === 0) {
        throw mapFatalSearchError(errors, signal);
      }

      const maxTotal =
        validated.platform === 'all'
          ? Math.min(MAX_SEARCH_LIMIT, perProviderLimit * selectedProviders.length)
          : validated.limit;

      const results =
        selectedProviders.length === 1
          ? (lists[0] ?? []).slice(0, maxTotal)
          : interleaveProviderTracks(lists, maxTotal);

      return {
        query: validated.query,
        platform: validated.platform,
        results,
        providers: statuses,
        partial: errors.length > 0 && succeededCount > 0,
      };
    } finally {
      release();
    }
  }

  return {
    validateQuery: validateMusicSearchQuery,
    async search(input: MusicSearchQueryInput, signal: AbortSignal): Promise<MusicSearchResponse> {
      signal.throwIfAborted();
      const validated = validateMusicSearchQuery(input);
      const cacheKey = `${validated.platform}:${validated.query.toLowerCase()}:${validated.limit}`;

      const cached = cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      let pending = pendingSearches.get(cacheKey);
      if (!pending) {
        const controller = new AbortController();
        const created: PendingSearch = {
          controller,
          consumers: 0,
          settled: false,
          promise: executeSearch(validated, controller.signal)
            .then((response) => {
              controller.signal.throwIfAborted();
              if (!response.partial && response.results.length > 0) {
                cache.set(cacheKey, response);
              }
              return response;
            })
            .finally(() => {
              created.settled = true;
              if (pendingSearches.get(cacheKey) === created) {
                pendingSearches.delete(cacheKey);
              }
            }),
        };
        pendingSearches.set(cacheKey, created);
        pending = created;
      }

      const currentPending = pending;
      currentPending.consumers += 1;

      return await new Promise<MusicSearchResponse>((resolve, reject) => {
        let finished = false;
        const releaseConsumer = () => {
          if (finished) return false;
          finished = true;
          signal.removeEventListener('abort', onAbort);
          currentPending.consumers -= 1;
          if (!currentPending.settled && currentPending.consumers <= 0) {
            if (pendingSearches.get(cacheKey) === currentPending) {
              pendingSearches.delete(cacheKey);
            }
            currentPending.controller.abort();
          }
          return true;
        };
        const onAbort = () => {
          if (releaseConsumer()) {
            reject(new WebError(409, 'La búsqueda fue cancelada.'));
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });
        currentPending.promise.then(
          (value) => {
            if (releaseConsumer()) resolve(value);
          },
          (error) => {
            if (releaseConsumer()) reject(error);
          },
        );
        if (signal.aborted) onAbort();
      });
    },
  };
}
