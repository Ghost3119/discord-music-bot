/** Public dashboard contract. Never include stream URLs, tokens or Discord internals. */
export interface Track {
  id: string;
  url: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string | null;
  source: string;
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
  volume: number;
  repeat: number;
  voice: { id: string; name: string; members: number } | null;
  health: Record<string, unknown>;
  incidents: Array<{ code: string; message: string; at: string }>;
  permissions?: GuildPermissions;
}
export interface MusicAction {
  action: 'play' | 'pause' | 'resume' | 'skip' | 'stop' | 'volume' | 'shuffle' | 'repeat' | 'remove' | 'move';
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
  control(userId: string, guildId: string, action: MusicAction, signal?: AbortSignal): Promise<void>;
  getPermissions?(userId: string, guildId: string): Promise<GuildPermissions>;
  invalidateMembership?(userId?: string, guildId?: string): void;
}
