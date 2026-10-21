/** Public dashboard contract. Never include stream URLs, tokens or Discord internals. */
export interface Track {
  id: string;
  url: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string | null;
  source: string;
  album?: string;
}
export type WebAccessMode = 'allowlist' | 'guild_members';
export type WebRole = 'member' | 'voice' | 'admin';
export interface GuildPermissions {
  role: WebRole;
  isMember: boolean;
  inVoiceChannel: boolean;
  canControl: boolean;
  isAdmin: boolean;
  canRead: boolean;
  canManageLibrary: boolean;
  canViewDiagnostics: boolean;
  canManageConfig: boolean;
}
export interface GuildSummary { id: string; name: string; icon: string | null }
export interface PlaybackSnapshot {
  guildId: string;
  status: 'idle' | 'playing' | 'paused' | 'recovering' | 'blocked';
  current: Track | null;
  queue: Track[];
  currentTime: number;
  /** Authoritative playback instance; changes even when the same song repeats. */
  playbackId?: string | null;
  /** Server epoch milliseconds, informational; never compare to browser performance.now(). */
  sampledAt?: number;
  /** Monotonic within this bridge lifetime. */
  sequence?: number;
  snapshotEpoch?: string;
  volume: number;
  repeat: number;
  autoplay?: boolean;
  voice: { id: string; name: string; members: number } | null;
  health: Record<string, unknown>;
  incidents: Array<{ code: string; message: string; at: string }>;
  permissions?: GuildPermissions;
}
export interface MusicAction {
  action: 'play' | 'pause' | 'resume' | 'skip' | 'stop' | 'volume' | 'shuffle' | 'repeat' | 'remove' | 'move' | 'autoplay' | 'recommend';
  enabled?: boolean;
  amount?: number;
  query?: string;
  track?: Omit<Track, 'id'>;
  volume?: number;
  mode?: number;
  index?: number;
  from?: number;
  to?: number;
}
export interface MusicBridge {
  listGuilds(userId: string): Promise<GuildSummary[]>;
  assertGuildAccess(userId: string, guildId: string): Promise<void>;
  getState(userId: string, guildId: string): Promise<PlaybackSnapshot>;
  control(userId: string, guildId: string, action: MusicAction, signal?: AbortSignal): Promise<void | MusicControlResult>;
  getPermissions?(userId: string, guildId: string): Promise<GuildPermissions>;
  invalidateMembership?(userId?: string, guildId?: string): void;
}
export interface MusicControlResult { autoplay?: boolean; recommendationsAdded?: number }

export type ImportPlatform = 'youtube' | 'youtube_music' | 'spotify';

export interface ImportedPlaylistTrack {
  url: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string | null;
  source: string;
  sourceId: string;
  platform: ImportPlatform;
  position: number;
}

export interface ImportedPlaylistPreview {
  platform: ImportPlatform;
  playlistId: string;
  sourceUrl: string;
  title: string;
  author: string | null;
  thumbnail: string | null;
  totalCount: number;
  importedCount: number;
  omittedCount: number;
  truncated: boolean;
  tracks: ImportedPlaylistTrack[];
}

export type MusicSearchPlatform = 'all' | 'youtube_music' | 'youtube' | 'soundcloud';
export type MusicSearchProviderId = 'youtube_music' | 'youtube' | 'soundcloud';

export interface MusicSearchTrack {
  id: string;
  url: string;
  title: string;
  artist: string;
  channel: string | null;
  duration: number;
  thumbnail: string | null;
  source: 'youtube' | 'soundcloud';
  sourceId: string;
  platform: MusicSearchProviderId;
}

export interface MusicSearchProviderStatus {
  platform: MusicSearchProviderId;
  ok: boolean;
  count: number;
  error?: string;
}

export interface MusicSearchResponse {
  query: string;
  platform: MusicSearchPlatform;
  results: MusicSearchTrack[];
  providers: MusicSearchProviderStatus[];
  partial: boolean;
}
