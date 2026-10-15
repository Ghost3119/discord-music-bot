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
}
export interface MusicAction {
  action: 'play' | 'pause' | 'resume' | 'skip' | 'stop' | 'volume' | 'shuffle' | 'repeat' | 'remove' | 'move';
  query?: string;
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
}
