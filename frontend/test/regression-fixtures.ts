import type { PlaybackSnapshot, Playlist, Session, Track } from '../src/lib/api';

export const session: Session = { user: { id: 'member-a', username: 'Alex', avatar: null }, csrfToken: 'csrf-fixture' };

export function track(id = 'track-a', overrides: Partial<Track> = {}): Track {
  return { id, title: `Canción ${id}`, artist: 'Artista', url: `https://www.youtube.com/watch?v=${id}`, duration: 120, thumbnail: null, source: 'youtube', ...overrides };
}

export function snapshot(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return { guildId: 'guild-a', status: 'playing', current: track(), queue: [track('track-b'), track('track-c')], currentTime: 30, volume: 65, repeat: 0, voice: { id: 'voice-a', name: 'Lounge', members: 4 }, health: {}, incidents: [], ...overrides };
}

export function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return { id: 'playlist-a', name: 'Noches sin prisa', tracks: [track(), track('track-b')], ...overrides };
}
