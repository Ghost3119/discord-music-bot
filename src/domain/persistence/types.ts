export interface WebUser { id: string; username: string; avatar: string | null }
export interface WebSession { user: WebUser; tokenHash: string; csrfHash: string; expiresAt: number }

/** Persisted track shape; independent of the structurally compatible HTTP contract. */
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
export interface SavedPlaylist { id: string; name: string; tracks: Track[] }
export type TrackMetadata = Omit<Track, 'id'>;
