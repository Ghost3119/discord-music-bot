import type { Playlist, Track } from '../../lib/api';
import { duration } from '../../lib/utils';

export type LibraryLayoutMode = 'grid' | 'list';
export type LibrarySortOrder = 'recent' | 'name-asc' | 'name-desc' | 'tracks-desc' | 'tracks-asc';

const LAYOUT_STORAGE_KEY = 'sonora:library-layout';
const SORT_STORAGE_KEY = 'sonora:library-sort';

export function readStoredLayoutMode(): LibraryLayoutMode {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'grid';
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return raw === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function writeStoredLayoutMode(mode: LibraryLayoutMode): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, mode);
  } catch {
    // Ignore storage quota or privacy restrictions
  }
}

export function readStoredSortOrder(): LibrarySortOrder {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'recent';
    const raw = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (
      raw === 'recent' ||
      raw === 'name-asc' ||
      raw === 'name-desc' ||
      raw === 'tracks-desc' ||
      raw === 'tracks-asc'
    ) {
      return raw;
    }
    return 'recent';
  } catch {
    return 'recent';
  }
}

export function writeStoredSortOrder(sort: LibrarySortOrder): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(SORT_STORAGE_KEY, sort);
  } catch {
    // Ignore storage quota or privacy restrictions
  }
}

export function normalizeLibraryText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PlaylistDurationSummary {
  knownSeconds: number;
  knownTrackCount: number;
  unknownTrackCount: number;
  label: string;
}

export function summarizePlaylistDuration(tracks: readonly Track[]): PlaylistDurationSummary {
  let knownSeconds = 0;
  let knownTrackCount = 0;
  let unknownTrackCount = 0;

  for (let i = 0; i < tracks.length; i++) {
    const d = tracks[i]!.duration;
    if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
      knownSeconds += d;
      knownTrackCount += 1;
    } else {
      unknownTrackCount += 1;
    }
  }

  if (tracks.length === 0) {
    return { knownSeconds: 0, knownTrackCount: 0, unknownTrackCount: 0, label: '0:00' };
  }

  if (knownTrackCount === 0) {
    return {
      knownSeconds: 0,
      knownTrackCount: 0,
      unknownTrackCount,
      label: 'Duración pendiente',
    };
  }

  const formatted = duration(knownSeconds);
  if (unknownTrackCount > 0) {
    return {
      knownSeconds,
      knownTrackCount,
      unknownTrackCount,
      label: `${formatted} + ${unknownTrackCount} sin duración`,
    };
  }

  return {
    knownSeconds,
    knownTrackCount,
    unknownTrackCount: 0,
    label: formatted,
  };
}

const SOURCE_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  apple_music: 'Apple Music',
};

export function summarizePlaylistSources(tracks: readonly Track[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const raw = tracks[i]!.source?.toLowerCase().trim() || '';
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    labels.push(SOURCE_LABELS[raw] || tracks[i]!.source);
  }
  return labels;
}

export interface FilteredPlaylistEntry {
  playlist: Playlist;
  originalIndex: number;
  matchedByName: boolean;
  matchingTracks: Track[];
}

export function filterAndSortPlaylists(
  playlists: readonly Playlist[],
  rawQuery: string,
  sortOrder: LibrarySortOrder,
): FilteredPlaylistEntry[] {
  const query = normalizeLibraryText(rawQuery);

  const matched: FilteredPlaylistEntry[] = [];
  for (let i = 0; i < playlists.length; i++) {
    const item = playlists[i]!;
    if (!query) {
      matched.push({
        playlist: item,
        originalIndex: i,
        matchedByName: true,
        matchingTracks: [],
      });
      continue;
    }

    const matchedByName = normalizeLibraryText(item.name).includes(query);
    const matchingTracks = item.tracks.filter(
      (track) =>
        normalizeLibraryText(track.title).includes(query) ||
        normalizeLibraryText(track.artist).includes(query),
    );

    if (matchedByName || matchingTracks.length > 0) {
      matched.push({
        playlist: item,
        originalIndex: i,
        matchedByName,
        matchingTracks,
      });
    }
  }

  if (sortOrder === 'recent') {
    return matched;
  }

  return [...matched].sort((a, b) => {
    if (sortOrder === 'name-asc') {
      return (
        a.playlist.name.localeCompare(b.playlist.name, 'es', { sensitivity: 'base' }) ||
        a.originalIndex - b.originalIndex
      );
    }
    if (sortOrder === 'name-desc') {
      return (
        b.playlist.name.localeCompare(a.playlist.name, 'es', { sensitivity: 'base' }) ||
        a.originalIndex - b.originalIndex
      );
    }
    if (sortOrder === 'tracks-desc') {
      return b.playlist.tracks.length - a.playlist.tracks.length || a.originalIndex - b.originalIndex;
    }
    if (sortOrder === 'tracks-asc') {
      return a.playlist.tracks.length - b.playlist.tracks.length || a.originalIndex - b.originalIndex;
    }
    return a.originalIndex - b.originalIndex;
  });
}
