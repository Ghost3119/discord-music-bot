export interface SavedSong {
  id: string;
  source: string;
  url: string;
  name: string;
  thumbnail?: string;
  uploader: string;
  duration: number;
  ageRestricted: boolean;
  playFromSource: boolean;
  searchSource: 'youtube' | 'soundcloud';
}

export interface SavedQueue {
  blocked?: boolean;
  probe?: boolean;
  failures?: number[];
  guildId: string;
  voiceChannelId: string;
  textChannelId?: string;
  songs: SavedSong[];
  position: number;
  volume: number;
  paused: boolean;
  autoplay: boolean;
  repeatMode: 0 | 1 | 2;
  updatedAt: number;
}

/** Synchronous checkpoints preserve the existing capture/stop ordering. */
export interface QueueCheckpointStore {
  read(): SavedQueue[];
  write(queues: SavedQueue[]): void;
  delete(guildId: string): void;
}
