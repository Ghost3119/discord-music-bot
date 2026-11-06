import type { Track } from '../../../src/web/contracts';

export type {
  Track,
  PlaybackSnapshot,
  GuildSummary,
  MusicAction,
  ImportPlatform,
  ImportedPlaylistTrack,
  ImportedPlaylistPreview,
  MusicSearchPlatform,
  MusicSearchProviderId,
  MusicSearchTrack,
  MusicSearchProviderStatus,
  MusicSearchResponse,
  MusicSearchSuggestionsResponse,
} from '../../../src/web/contracts';
export interface Session { user: { id: string; username: string; avatar: string | null }; csrfToken: string }
export interface Playlist { id: string; name: string; tracks: Track[] }
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; }
}
let sessionCsrf: string | undefined;
export async function api<T>(path: string, options: RequestInit = {}, csrfToken?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('content-type', 'application/json');
  if (csrfToken || sessionCsrf) headers.set('x-csrf-token', csrfToken ?? sessionCsrf!);
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (response.status === 401 || path.startsWith('/auth/logout') && response.ok) sessionCsrf = undefined;
  if (path === '/api/session' && response.ok && typeof data?.csrfToken === 'string') sessionCsrf = data.csrfToken;
  if (!response.ok) throw new ApiError(data?.message || data?.error || 'No se pudo completar la solicitud. Inténtalo de nuevo.', response.status);
  return data as T;
}
export function trackMetadata(track: Track) {
  return { url: track.url, title: track.title, artist: track.artist, duration: track.duration, thumbnail: track.thumbnail, source: track.source };
}
