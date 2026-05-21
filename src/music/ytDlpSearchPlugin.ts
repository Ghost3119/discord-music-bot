import { ExtractorPlugin, Playlist, ResolveOptions, Song, SongInfo, PlaylistInfo } from 'distube';
import { json } from '@distube/yt-dlp';

type YtDlpJsonFlags = NonNullable<Parameters<typeof json>[1]>;

export type SearchSource = 'youtube' | 'soundcloud';

export interface PlaybackMetadata {
  searchSource: SearchSource;
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

function isSearchSource(value: unknown): value is SearchSource {
  return value === 'youtube' || value === 'soundcloud';
}

function getSearchSource(metadata: unknown): SearchSource {
  if (typeof metadata !== 'object' || metadata === null) return 'youtube';
  const candidate = metadata as { searchSource?: unknown };
  return isSearchSource(candidate.searchSource) ? candidate.searchSource : 'youtube';
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

export class YtDlpSearchPlugin extends ExtractorPlugin {
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
    const searchSource = getSearchSource(options.metadata);
    const searchQuery = YTDLP_SEARCH_PATTERN.test(query) ? query : `${SEARCH_PREFIXES[searchSource]}${query}`;
    const info = await this.fetchInfo(searchQuery);
    const result = hasEntries(info) ? info.entries.find((entry) => getPlayableUrl(entry)) : info;

    return result ? this.createSong(result, options) : null;
  }

  override async getStreamURL<T>(song: Song<T>): Promise<string> {
    if (!song.url) {
      throw new Error('Cannot resolve a stream URL for a song without a source URL.');
    }

    const info = await this.fetchInfo(song.url, { format: 'ba/ba*' });
    const streamUrl = toStringValue(info.url);

    if (!streamUrl) {
      throw new Error(`yt-dlp did not return a playable stream URL for ${song.url}.`);
    }

    return streamUrl;
  }

  override getRelatedSongs(): Song[] {
    return [];
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
