import { ExtractorPlugin, Playlist, ResolveOptions, Song, SongInfo, PlaylistInfo } from 'distube';
import { setTimeout as delay } from 'node:timers/promises';
import { runYtDlp, YtDlpFlags, ExtractionPriority } from './ytDlpRunner';
import { classifyMusicError } from './errors';

// The wrapper's types predate yt-dlp's JavaScript runtime option.
type YtDlpJsonFlags = YtDlpFlags;

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
  _type?: string;
  id?: string | number;
  title?: string;
  fulltitle?: string;
  url?: string;
  webpage_url?: string;
  original_url?: string;
  extractor?: string;
  ie_key?: string;
  is_live?: boolean;
  live_status?: string | null;
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

interface PendingRequest<T> {
  promise: Promise<T>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
}

const URL_PATTERN = /^https?:\/\//i;
const SEARCH_PREFIXES: Record<SearchSource, string> = {
  youtube: 'ytsearch5:',
  soundcloud: 'scsearch5:',
};
const YTDLP_SEARCH_PATTERN = /^(?:ytsearch|scsearch)\d*:/i;
const SEARCH_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const STREAM_CACHE_TTL_MS = 25 * 60 * 1000;
const MIX_CACHE_TTL_MS = 30 * 60 * 1000;
const SEARCH_CACHE_MAX_ITEMS = 500;
const STREAM_CACHE_MAX_ITEMS = 200;
const MIX_CACHE_MAX_ITEMS = 100;
const MIX_CANDIDATE_LIMIT = 60;
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

  delete(key: string): void {
    this.entries.delete(key);
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

function searchTokens(value: string): string[] {
  const ignored = new Set(['la', 'las', 'los', 'el', 'de', 'del', 'en', 'y', 'the', 'of', 'and', 'a', 'official', 'audio', 'video', 'lyrics']);
  return (value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => !ignored.has(word));
}

function matchesSearchQuery(query: string, result: YtDlpInfo): boolean {
  const wanted = searchTokens(query);
  const words = searchTokens(`${result.title ?? ''} ${result.uploader ?? ''}`);
  return wanted.length === 0 || wanted.filter((word) => words.includes(word)).length / wanted.length >= 0.8;
}

function recoveryQuery(name: string): string {
  return name.replace(/\b(?:official(?: music)? video|official audio|lyric(?:s| video)|visualizer|HD|4K)\b/gi, ' ')
    .replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

function compatibleAlternative(query: string, requested: Song, reference: Song, info: YtDlpInfo): boolean {
  if (!matchesSearchQuery(query, info) || info.is_live || (info.age_limit ?? 0) >= 18) return false;
  // Metadata providers know the artist separately. A long matching title must
  // not hide an artist mismatch when looking for a different upload.
  if (!requested.stream.playFromSource && requested.uploader?.name && !matchesSearchQuery(requested.uploader.name, info)) return false;
  if (!matchesSearchQuery(recoveryQuery(requested.name ?? ''), info)) return false;
  const originalWords = searchTokens(query);
  const candidateWords = searchTokens(info.title ?? '');
  const variants = ['remix', 'live', 'cover', 'karaoke', 'nightcore', 'sped', 'slowed', 'instrumental'];
  if (variants.some(word => candidateWords.includes(word) && !originalWords.includes(word))) return false;
  const duration = requested.duration || reference.duration;
  if (duration > 0 && (!info.duration || Math.abs(info.duration - duration) > Math.max(15, Math.min(45, duration * 0.15)))) return false;
  return true;
}

export function rankSearchCandidates<T extends { title?: string; uploader?: string; duration?: number | null }>(query: string, candidates: T[]): T[] {
  const wanted = searchTokens(query);
  const variants = ['remix', 'live', 'cover', 'karaoke', 'nightcore', 'sped', 'slowed'];
  const score = (candidate: T) => {
    const words = searchTokens(`${candidate.title ?? ''} ${candidate.uploader ?? ''}`);
    const overlap = wanted.filter((word) => words.includes(word)).length / Math.max(wanted.length, 1);
    const penalty = variants.some((word) => words.includes(word) && !wanted.includes(word)) ? 0.4 : 0;
    return overlap - penalty;
  };
  return candidates.map((candidate, index) => ({ candidate, index, score: score(candidate) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(({ candidate }) => candidate);
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
  private readonly mixCache = new TtlCache<YtDlpInfo[]>(MIX_CACHE_MAX_ITEMS, MIX_CACHE_TTL_MS);
  private readonly pendingSearches = new Map<string, PendingRequest<YtDlpInfo | null>>();
  private readonly pendingStreamUrls = new Map<string, PendingRequest<string>>();
  private readonly pendingMixes = new Map<string, Promise<YtDlpInfo[]>>();
  private readonly refreshAfter = new WeakMap<Song, number>();
  private readonly sourceCooldowns = new Map<SearchSource, { until: number; error: unknown }>();

  override validate(url: string): boolean {
    return URL_PATTERN.test(url);
  }

  override async resolve<T>(url: string, options: ResolveOptions<T>): Promise<Song<T> | Playlist<T>> {
    const info = await this.fetchInfo(url, { playlistEnd: 500, flatPlaylist: true });

    if (hasEntries(info)) {
      return this.createPlaylist(info, options);
    }

    return this.createSong(info, options);
  }

  override async searchSong<T>(query: string, options: ResolveOptions<T>, signal?: AbortSignal, priority: ExtractionPriority = 'interactive'): Promise<Song<T> | null> {
    const result = await this.getSearchResult(query, options.metadata, priority, signal);

    return result ? this.createSong(result, options) : null;
  }

  override async getStreamURL<T>(song: Song<T>, signal?: AbortSignal, priority: ExtractionPriority = 'interactive'): Promise<string> {
    signal?.throwIfAborted();
    const refreshAfter = this.refreshAfter.get(song);
    if (refreshAfter) {
      this.refreshAfter.delete(song);
      const remaining = Math.max(0, refreshAfter - Date.now());
      if (remaining > 0) await delay(remaining, undefined, { signal });
    }
    signal?.throwIfAborted();
    if (!song.url) {
      throw new Error('Cannot resolve a stream URL for a song without a source URL.');
    }

    const cacheKey = normalizeUrlCacheKey(song.url);
    const cachedStreamUrl = this.streamUrlCache.get(cacheKey);
    if (cachedStreamUrl) return cachedStreamUrl;

    let pending = this.pendingStreamUrls.get(cacheKey);
    if (!pending) {
      const controller = new AbortController();
      const request: PendingRequest<string> = { controller, consumers: 0, settled: false,
        promise: this.fetchStreamUrl(song.url, controller.signal, priority).then(streamUrl => {
          controller.signal.throwIfAborted();
          this.streamUrlCache.set(cacheKey, streamUrl);
          return streamUrl;
        }).finally(() => {
          request.settled = true;
          if (this.pendingStreamUrls.get(cacheKey) === request) this.pendingStreamUrls.delete(cacheKey);
        }),
      };
      this.pendingStreamUrls.set(cacheKey, request);
      pending = request;
    }
    return this.consumeRequest(this.pendingStreamUrls, cacheKey, pending, signal);
  }

  private consumeRequest<T>(requests: Map<string, PendingRequest<T>>, cacheKey: string, request: PendingRequest<T>, signal?: AbortSignal): Promise<T> {
    request.consumers += 1;
    return new Promise((resolve, reject) => {
      let finished = false;
      const release = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener('abort', abort);
        request.consumers -= 1;
        if (!request.settled && !request.consumers) {
          if (requests.get(cacheKey) === request) requests.delete(cacheKey);
          request.controller.abort();
        }
        return true;
      };
      const abort = () => { if (release()) reject(signal?.reason); };
      signal?.addEventListener('abort', abort, { once: true });
      request.promise.then(value => { if (release()) resolve(value); }, error => { if (release()) reject(error); });
      if (signal?.aborted) abort();
    });
  }

  override async getRelatedSongs(song: Song): Promise<Song[]> {
    return this.getRecommendations(song);
  }

  invalidateStream(song: Song, retryDelayMs = 500): void {
    const playable = song.stream.playFromSource ? song : song.stream.song;
    if (!playable) return;
    if (playable.url) this.streamUrlCache.delete(normalizeUrlCacheKey(playable.url));
    if (playable.stream.playFromSource) delete playable.stream.url;
    this.refreshAfter.set(playable, Date.now() + retryDelayMs);
  }

  async searchCandidates(query: string, limit = 5, source: SearchSource = 'youtube'): Promise<Song[]> {
    const budget = AbortSignal.timeout(90_000);
    let lastError: unknown;
    for (const attempt of this.searchAttempts(toSearchQuery(query, source), limit)) {
      const cooldown = this.sourceCooldowns.get(attempt.source);
      if (cooldown && cooldown.until > Date.now()) { lastError = cooldown.error; continue; }
      try {
        const info = await this.fetchInfo(attempt.input, { flatPlaylist: true, playlistEnd: limit }, budget);
        const entries = (hasEntries(info) ? info.entries : [info]).filter((entry) => entry && getPlayableUrl(entry));
        if (entries.length) return rankSearchCandidates(query, entries).slice(0, limit).map((entry) => this.createSong(
          { ...entry, extractor: attempt.source }, { metadata: { searchSource: attempt.source } },
        ));
      } catch (error) {
        this.noteSourceError(attempt.source, error);
        lastError = error;
        if (budget.aborted || ['YTDLP_NOT_FOUND', 'MUSIC_BUSY'].includes(classifyMusicError(error))) throw error;
      }
    }
    if (lastError) throw lastError;
    return [];
  }

  async findAlternative(song: Song, signal?: AbortSignal, priority: ExtractionPriority = 'interactive'): Promise<Song | null> {
    if (!song.name || song.isLive) return null;
    const reference = song.stream.playFromSource ? song : song.stream.song ?? song;
    if (reference.isLive) return null;
    const query = recoveryQuery(`${song.name} ${!song.stream.playFromSource ? song.uploader?.name ?? '' : ''}`);
    if (!query) return null;
    const budget = AbortSignal.any([AbortSignal.timeout(45_000), ...(signal ? [signal] : [])]);
    const preferred: SearchSource = reference.source.toLowerCase().includes('soundcloud') ? 'youtube' : 'soundcloud';
    let hydrated = 0;
    const seen = new Set<string>();
    for (const attempt of this.searchAttempts(toSearchQuery(query, preferred))) {
      budget.throwIfAborted();
      const cooldown = this.sourceCooldowns.get(attempt.source);
      if (cooldown && cooldown.until > Date.now()) continue;
      try {
        const info = await this.fetchInfo(attempt.input, { flatPlaylist: true, playlistEnd: 5 }, budget, priority);
        const entries = rankSearchCandidates(query, (hasEntries(info) ? info.entries : [info]).filter(entry => entry && getPlayableUrl(entry)));
        for (const entry of entries.slice(0, 3)) {
          const url = getPlayableUrl(entry)!;
          const key = `${attempt.source}:${entry.id ?? url}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const sameSource = attempt.source === (reference.source.includes('soundcloud') ? 'soundcloud' : 'youtube');
          if (url === reference.url || (String(entry.id) === reference.id && sameSource)) continue;
          if (hydrated++ >= 6) return null;
          try {
            const result = await this.fetchInfo(url, { format: 'ba/ba*', noPlaylist: true }, budget, priority);
            const canonical = getPlayableUrl(result);
            if (!canonical || canonical === reference.url || hasEntries(result) || !result.url || result.url === canonical) continue;
            if (String(result.id) === reference.id && sameSource) continue;
            if (!compatibleAlternative(query, song, reference, result)) continue;
            const candidate = this.createSong({ ...result, extractor: result.extractor ?? attempt.source }, {
              metadata: song.metadata, ...(song.member ? { member: song.member } : {}),
            });
            if (!candidate.stream.playFromSource) continue;
            budget.throwIfAborted();
            candidate.stream.url = result.url;
            if (song.playlist) candidate.playlist = song.playlist;
            this.streamUrlCache.set(normalizeUrlCacheKey(canonical), result.url);
            budget.throwIfAborted();
            return candidate;
          } catch (error) {
            budget.throwIfAborted();
            this.noteSourceError(attempt.source, error);
            if (['YTDLP_NOT_FOUND', 'MUSIC_BUSY'].includes(classifyMusicError(error))) throw error;
            if (['SOURCE_BLOCKED', 'SOURCE_RATE_LIMITED'].includes(classifyMusicError(error))) break;
          }
        }
      } catch (error) {
        budget.throwIfAborted();
        this.noteSourceError(attempt.source, error);
        if (['YTDLP_NOT_FOUND', 'MUSIC_BUSY'].includes(classifyMusicError(error))) throw error;
      }
    }
    return null;
  }

  private searchAttempts(searchQuery: string, limit = 5): { input: string; source: SearchSource }[] {
    const match = /^(ytsearch|scsearch)\d*:(.*)$/is.exec(searchQuery);
    const query = match?.[2] ?? searchQuery;
    const youtube: { input: string; source: SearchSource }[] = [
      { input: `ytsearch${limit}:${query}`, source: 'youtube' },
      { input: `https://music.youtube.com/search?${new URLSearchParams({ q: query })}#songs`, source: 'youtube' },
    ];
    const soundcloud = { input: `scsearch${limit}:${query}`, source: 'soundcloud' as const };
    return match?.[1]?.toLowerCase() === 'scsearch' ? [soundcloud, ...youtube] : [...youtube, soundcloud];
  }

  private noteSourceError(source: SearchSource, error: unknown): void {
    if (['SOURCE_RATE_LIMITED', 'SOURCE_BLOCKED'].includes(classifyMusicError(error))) {
      this.sourceCooldowns.set(source, { until: Date.now() + 60_000, error });
    }
  }

  async getRecommendations(seed: Song): Promise<Song[]> {
    const videoId = await this.getYouTubeVideoId(seed);
    if (!videoId) return [];

    const entries = await this.getMixEntries(videoId);
    const seen = new Set<string>([videoId]);
    return entries.flatMap((entry) => {
      const id = toStringValue(entry.id);
      if (!id || !/^[\w-]{11}$/.test(id) || seen.has(id)) return [];
      seen.add(id);

      const info: YtDlpInfo = {
        ...entry,
        id,
        extractor: 'youtube',
        webpage_url: `https://www.youtube.com/watch?v=${id}`,
      };
      const options: ResolveOptions<PlaybackMetadata> = { metadata: { searchSource: 'youtube' } };
      if (seed.member) options.member = seed.member;
      return [this.createSong(info, options)];
    });
  }

  async warmSearchCache(queries: string[], metadata: unknown): Promise<void> {
    const uniqueQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(
      0,
      PLAYLIST_SEARCH_WARM_LIMIT,
    );

    await runWithConcurrency(uniqueQueries, PLAYLIST_WARM_CONCURRENCY, async (query) => {
      try {
        await this.getSearchResult(query, metadata, 'background');
      } catch (error) {
        console.warn(`No se pudo precachear "${query}":`, error);
      }
    });
  }

  private async fetchStreamUrl(url: string, signal: AbortSignal, priority: ExtractionPriority): Promise<string> {
    const info = await this.fetchInfo(url, { format: 'ba/ba*', noPlaylist: true }, signal, priority);
    const streamUrl = toStringValue(info.url);

    if (!streamUrl) {
      throw new Error(`yt-dlp did not return a playable stream URL for ${url}.`);
    }

    return streamUrl;
  }

  private async getYouTubeVideoId(song: Song): Promise<string | null> {
    if (!song.stream.playFromSource && song.stream.song) {
      return this.getYouTubeVideoId(song.stream.song);
    }

    if (song.source.toLowerCase().includes('youtube') && /^[\w-]{11}$/.test(song.id)) {
      return song.id;
    }

    const query = [song.name, song.uploader.name].filter(Boolean).join(' ');
    if (!query) return null;

    const result = await this.getSearchResult(query, { searchSource: 'youtube' });
    const id = result && toStringValue(result.id);
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }

  private async getMixEntries(videoId: string): Promise<YtDlpInfo[]> {
    const cached = this.mixCache.get(videoId);
    if (cached) return cached;

    const pending = this.pendingMixes.get(videoId);
    if (pending) return pending;

    const promise = this.fetchInfo(
      `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`,
      { flatPlaylist: true, playlistEnd: MIX_CANDIDATE_LIMIT },
    ).then((info) => {
      const entries = hasEntries(info) ? info.entries : [];
      if (entries.length > 0) this.mixCache.set(videoId, entries);
      return entries;
    }).finally(() => {
      this.pendingMixes.delete(videoId);
    });

    this.pendingMixes.set(videoId, promise);
    return promise;
  }

  private async getSearchResult(query: string, metadata: unknown, priority: ExtractionPriority = 'interactive', signal?: AbortSignal): Promise<YtDlpInfo | null> {
    signal?.throwIfAborted();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return null;

    const searchQuery = toSearchQuery(trimmedQuery, getSearchSource(metadata));
    const cacheKey = normalizeSearchCacheKey(searchQuery);
    const cachedResult = this.searchCache.get(cacheKey);
    if (cachedResult) return cachedResult;

    let request = this.pendingSearches.get(cacheKey);
    if (!request) {
      const controller = new AbortController();
      const created: PendingRequest<YtDlpInfo | null> = { controller, consumers: 0, settled: false,
        promise: this.fetchSearchResult(searchQuery, priority, controller.signal).then(result => {
          controller.signal.throwIfAborted();
          if (result) this.searchCache.set(cacheKey, result);
          return result;
        }).finally(() => {
          created.settled = true;
          if (this.pendingSearches.get(cacheKey) === created) this.pendingSearches.delete(cacheKey);
        }),
      };
      this.pendingSearches.set(cacheKey, created);
      request = created;
    }
    return this.consumeRequest(this.pendingSearches, cacheKey, request, signal);
  }

  private async fetchSearchResult(searchQuery: string, priority: ExtractionPriority, signal: AbortSignal): Promise<YtDlpInfo | null> {
    const budget = AbortSignal.any([AbortSignal.timeout(90_000), signal]);
    const query = searchQuery.replace(YTDLP_SEARCH_PATTERN, '');
    let lastError: unknown;
    for (const attempt of this.searchAttempts(searchQuery)) {
      const cooldown = this.sourceCooldowns.get(attempt.source);
      if (cooldown && cooldown.until > Date.now()) { lastError = cooldown.error; continue; }
      try {
        const info = await this.fetchInfo(attempt.input, { flatPlaylist: true, playlistEnd: 5 }, budget, priority);
        budget.throwIfAborted();
        const candidates = rankSearchCandidates(query, (hasEntries(info) ? info.entries : [info])
          .filter((entry) => entry && getPlayableUrl(entry)));
        for (const candidate of candidates.slice(0, 5)) {
          try {
            const result = candidate._type === 'url'
              ? await this.fetchInfo(getPlayableUrl(candidate)!, { format: 'ba/ba*', noPlaylist: true }, budget, priority)
              : candidate;
            budget.throwIfAborted();
            const canonical = getPlayableUrl(result);
            if (!canonical || hasEntries(result)) continue;
            if (candidate._type === 'url' && !matchesSearchQuery(query, result)) continue;
            if (result.url && result.url !== canonical) this.streamUrlCache.set(normalizeUrlCacheKey(canonical), result.url);
            return { ...result, extractor: result.extractor ?? attempt.source };
          } catch (error) {
            lastError = error;
            this.noteSourceError(attempt.source, error);
            if (budget.aborted || ['YTDLP_NOT_FOUND', 'MUSIC_BUSY'].includes(classifyMusicError(error))) throw error;
            if (['SOURCE_BLOCKED', 'SOURCE_RATE_LIMITED'].includes(classifyMusicError(error))) break;
          }
        }
      } catch (error) {
        lastError = error;
        this.noteSourceError(attempt.source, error);
        if (budget.aborted || ['YTDLP_NOT_FOUND', 'MUSIC_BUSY'].includes(classifyMusicError(error))) throw error;
      }
    }
    if (lastError) throw lastError;
    return null;
  }

  private async fetchInfo(input: string, extraFlags: YtDlpJsonFlags = {}, signal?: AbortSignal, priority: ExtractionPriority = 'interactive'): Promise<YtDlpInfo> {
    const flags: YtDlpJsonFlags = {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: true,
      skipDownload: true,
      simulate: true,
      jsRuntimes: `node:${process.execPath}`,
      ...extraFlags,
    };

    return await runYtDlp(input, flags, signal, priority) as YtDlpInfo;
  }

  private createPlaylist<T>(info: YtDlpInfo & { entries: YtDlpInfo[] }, options: ResolveOptions<T>): Playlist<T> {
    const songs: Song[] = info.entries
      .filter((entry) => getPlayableUrl(entry))
      .map((entry) => this.createSong({ ...entry, extractor: entry.extractor ?? entry.ie_key?.toLowerCase() ?? info.extractor ?? 'yt-dlp' }, options));

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
    else if (info.live_status) songInfo.isLive = info.live_status === 'is_live';
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
