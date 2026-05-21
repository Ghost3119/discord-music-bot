import { ExtractorPlugin, Playlist, ResolveOptions, Song, SongInfo, PlaylistInfo } from 'distube';
import { json } from '@distube/yt-dlp';

type YtDlpJsonFlags = NonNullable<Parameters<typeof json>[1]>;

export type SearchSource = 'youtube' | 'soundcloud';

export interface PlaybackMetadata {
  searchSource: SearchSource;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface YtDlpThumbnail {
  url?: string;
}

interface YtDlpInfo {
  id?: string | number;
  title?: string;
  fulltitle?: string;
  url?: string;
  webpage_url?: string;
  original_url?: string;
  extractor?: string;
  is_live?: boolean;
  duration?: number | null;
  thumbnail?: string;
  thumbnails?: YtDlpThumbnail[];
  uploader?: string;
  uploader_url?: string;
  view_count?: number;
  like_count?: number;
  dislike_count?: number;
  repost_count?: number;
  age_limit?: number;
  entries?: YtDlpInfo[];
}

const URL_PATTERN = /^https?:\/\//i;
const SEARCH_PREFIXES: Record<SearchSource, string> = {
  youtube: 'ytsearch1:',
  soundcloud: 'scsearch1:',
};
const YTDLP_SEARCH_PATTERN = /^(?:ytsearch|scsearch)\d*:/i;
const SEARCH_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const STREAM_CACHE_TTL_MS = 25 * 60 * 1000;
const SEARCH_CACHE_MAX_ITEMS = 500;
const STREAM_CACHE_MAX_ITEMS = 200;
const PLAYLIST_WARM_CONCURRENCY = 2;
export const PLAYLIST_SEARCH_WARM_LIMIT = 25;

class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly maxItems: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.deleteExpired();
    this.entries.set(key, {
      expiresAt: Date.now() + this.ttlMs,
      value,
    });
    this.trim();
  }

  private deleteExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private trim(): void {
    while (this.entries.size > this.maxItems) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) return;
      this.entries.delete(oldestKey);
    }
  }
}

function isSearchSource(value: unknown): value is SearchSource {
  return value === 'youtube' || value === 'soundcloud';
}

function getSearchSource(metadata: unknown): SearchSource {
  if (typeof metadata !== 'object' || metadata === null) return 'youtube';
  const candidate = metadata as { searchSource?: unknown };
  return isSearchSource(candidate.searchSource) ? candidate.searchSource : 'youtube';
}

function toSearchQuery(query: string, source: SearchSource): string {
  const trimmedQuery = query.trim();
  return YTDLP_SEARCH_PATTERN.test(trimmedQuery) ? trimmedQuery : `${SEARCH_PREFIXES[source]}${trimmedQuery}`;
}

function normalizeSearchCacheKey(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeUrlCacheKey(url: string): string {
  return url.trim();
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function toPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function getBestThumbnail(info: YtDlpInfo): string | undefined {
  if (info.thumbnail) return info.thumbnail;
  return info.thumbnails?.find((thumbnail) => typeof thumbnail.url === 'string')?.url;
}

function hasEntries(info: YtDlpInfo): info is YtDlpInfo & { entries: YtDlpInfo[] } {
  return Array.isArray(info.entries);
}

function getPlayableUrl(info: YtDlpInfo): string | undefined {
  return info.webpage_url ?? info.original_url ?? info.url;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item !== undefined) {
        await worker(item);
      }
    }
  });

  await Promise.all(workers);
}

export class YtDlpSearchPlugin extends ExtractorPlugin {
  private readonly searchCache = new TtlCache<YtDlpInfo>(SEARCH_CACHE_MAX_ITEMS, SEARCH_CACHE_TTL_MS);
  private readonly streamUrlCache = new TtlCache<string>(STREAM_CACHE_MAX_ITEMS, STREAM_CACHE_TTL_MS);
  private readonly pendingSearches = new Map<string, Promise<YtDlpInfo | null>>();
  private readonly pendingStreamUrls = new Map<string, Promise<string>>();

  override validate(url: string): boolean {
    return URL_PATTERN.test(url);
  }

  override async resolve<T>(url: string, options: ResolveOptions<T>): Promise<Song<T> | Playlist<T>> {
    const info = await this.fetchInfo(url);

    if (hasEntries(info)) {
      return this.createPlaylist(info, options);
    }

    return this.createSong(info, options);
  }

  override async searchSong<T>(query: string, options: ResolveOptions<T>): Promise<Song<T> | null> {
    const result = await this.getSearchResult(query, options.metadata);

    return result ? this.createSong(result, options) : null;
  }

  override async getStreamURL<T>(song: Song<T>): Promise<string> {
    if (!song.url) {
      throw new Error('Cannot resolve a stream URL for a song without a source URL.');
    }

    const cacheKey = normalizeUrlCacheKey(song.url);
    const cachedStreamUrl = this.streamUrlCache.get(cacheKey);
    if (cachedStreamUrl) return cachedStreamUrl;

    const pendingStreamUrl = this.pendingStreamUrls.get(cacheKey);
    if (pendingStreamUrl) return pendingStreamUrl;

    const streamUrlPromise = this.fetchStreamUrl(song.url).finally(() => {
      this.pendingStreamUrls.delete(cacheKey);
    });
    this.pendingStreamUrls.set(cacheKey, streamUrlPromise);

    const streamUrl = await streamUrlPromise;
    this.streamUrlCache.set(cacheKey, streamUrl);
    return streamUrl;
  }

  override getRelatedSongs(): Song[] {
    return [];
  }

  async warmSearchCache(queries: string[], metadata: unknown): Promise<void> {
    const uniqueQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(
      0,
      PLAYLIST_SEARCH_WARM_LIMIT,
    );

    await runWithConcurrency(uniqueQueries, PLAYLIST_WARM_CONCURRENCY, async (query) => {
      try {
        await this.getSearchResult(query, metadata);
      } catch (error) {
        console.warn(`No se pudo precachear "${query}":`, error);
      }
    });
  }

  private async fetchStreamUrl(url: string): Promise<string> {
    const info = await this.fetchInfo(url, { format: 'ba/ba*' });
    const streamUrl = toStringValue(info.url);

    if (!streamUrl) {
      throw new Error(`yt-dlp did not return a playable stream URL for ${url}.`);
    }

    return streamUrl;
  }

  private async getSearchResult(query: string, metadata: unknown): Promise<YtDlpInfo | null> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return null;

    const searchQuery = toSearchQuery(trimmedQuery, getSearchSource(metadata));
    const cacheKey = normalizeSearchCacheKey(searchQuery);
    const cachedResult = this.searchCache.get(cacheKey);
    if (cachedResult) return cachedResult;

    const pendingSearch = this.pendingSearches.get(cacheKey);
    if (pendingSearch) return pendingSearch;

    const searchPromise = this.fetchSearchResult(searchQuery).finally(() => {
      this.pendingSearches.delete(cacheKey);
    });
    this.pendingSearches.set(cacheKey, searchPromise);

    const result = await searchPromise;
    if (result) {
      this.searchCache.set(cacheKey, result);
    }

    return result;
  }

  private async fetchSearchResult(searchQuery: string): Promise<YtDlpInfo | null> {
    const info = await this.fetchInfo(searchQuery);
    return hasEntries(info) ? info.entries.find((entry) => getPlayableUrl(entry)) ?? null : info;
  }

  private async fetchInfo(input: string, extraFlags: YtDlpJsonFlags = {}): Promise<YtDlpInfo> {
    const flags: YtDlpJsonFlags = {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: true,
      skipDownload: true,
      simulate: true,
      ...extraFlags,
    };

    return (await json(input, flags)) as unknown as YtDlpInfo;
  }

  private createPlaylist<T>(info: YtDlpInfo & { entries: YtDlpInfo[] }, options: ResolveOptions<T>): Playlist<T> {
    const songs: Song[] = info.entries
      .filter((entry) => getPlayableUrl(entry))
      .map((entry) => this.createSong(entry, options));

    const playlistInfo: PlaylistInfo = {
      source: info.extractor ?? 'yt-dlp',
      songs,
    };

    const id = toStringValue(info.id);
    const name = toStringValue(info.title);
    const url = getPlayableUrl(info);
    const thumbnail = getBestThumbnail(info);

    if (id) playlistInfo.id = id;
    if (name) playlistInfo.name = name;
    if (url) playlistInfo.url = url;
    if (thumbnail) playlistInfo.thumbnail = thumbnail;

    return new Playlist<T>(playlistInfo, options);
  }

  private createSong<T>(info: YtDlpInfo, options: ResolveOptions<T>): Song<T> {
    const id = toStringValue(info.id) ?? getPlayableUrl(info) ?? toStringValue(info.title) ?? 'yt-dlp-result';
    const source = info.extractor ?? 'yt-dlp';
    const songInfo: SongInfo = {
      plugin: this,
      source,
      playFromSource: true,
      id,
    };

    const name = toStringValue(info.title) ?? toStringValue(info.fulltitle);
    const url = getPlayableUrl(info);
    const thumbnail = getBestThumbnail(info);
    const duration = toPositiveNumber(info.duration);
    const views = toPositiveNumber(info.view_count);
    const likes = toPositiveNumber(info.like_count);
    const dislikes = toPositiveNumber(info.dislike_count);
    const reposts = toPositiveNumber(info.repost_count);

    if (name) songInfo.name = name;
    if (url) songInfo.url = url;
    if (thumbnail) songInfo.thumbnail = thumbnail;
    if (typeof info.is_live === 'boolean') songInfo.isLive = info.is_live;
    if (duration !== undefined) songInfo.duration = duration;
    if (views !== undefined) songInfo.views = views;
    if (likes !== undefined) songInfo.likes = likes;
    if (dislikes !== undefined) songInfo.dislikes = dislikes;
    if (reposts !== undefined) songInfo.reposts = reposts;
    if (typeof info.age_limit === 'number') songInfo.ageRestricted = info.age_limit >= 18;

    const uploaderName = toStringValue(info.uploader);
    const uploaderUrl = toStringValue(info.uploader_url);
    if (uploaderName || uploaderUrl) {
      songInfo.uploader = {};
      if (uploaderName) songInfo.uploader.name = uploaderName;
      if (uploaderUrl) songInfo.uploader.url = uploaderUrl;
    }

    return new Song<T>(songInfo, options);
  }
}
