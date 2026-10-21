import { Disc3, ListMusic } from 'lucide-react';
import { Artwork } from '../../components/artwork';
import type { Playlist, Track } from '../../lib/api';
import { cn } from '../../lib/utils';

export interface PlaylistArtworkProps {
  playlist: Pick<Playlist, 'id' | 'name' | 'tracks'>;
  colorIndex?: number;
  className?: string;
}

/**
 * Selects up to 4 tracks with distinct non-empty thumbnails from a playlist.
 * Does not mutate or reorder the playlist's real track list.
 */
export function selectPlaylistCoverTracks(tracks: readonly Track[]): Track[] {
  const unique: Track[] = [];
  const seenThumbnails = new Set<string>();
  for (let i = 0; i < tracks.length && unique.length < 4; i++) {
    const item = tracks[i]!;
    const thumb = item.thumbnail?.trim();
    if (!thumb || seenThumbnails.has(thumb)) continue;
    seenThumbnails.add(thumb);
    unique.push(item);
  }
  return unique;
}

export function PlaylistArtwork({ playlist, colorIndex = 0, className }: PlaylistArtworkProps) {
  const coverTracks = selectPlaylistCoverTracks(playlist.tracks);
  const count = coverTracks.length;
  const isEmpty = playlist.tracks.length === 0;
  const colorClass = `playlist-color-${Math.abs(colorIndex) % 4}`;

  if (isEmpty) {
    return (
      <div
        className={cn('playlist-artwork playlist-artwork-empty', colorClass, className)}
        aria-hidden="true"
      >
        <div className="playlist-artwork-empty-ring" />
        <Disc3 size={46} strokeWidth={1.15} className="playlist-artwork-icon" />
      </div>
    );
  }

  if (count === 0) {
    return (
      <div
        className={cn('playlist-artwork playlist-artwork-fallback', colorClass, className)}
        aria-hidden="true"
      >
        <div className="playlist-artwork-orbits">
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
        </div>
        <ListMusic size={50} strokeWidth={1.15} className="playlist-artwork-icon" />
      </div>
    );
  }

  if (count === 1) {
    return (
      <div className={cn('playlist-artwork playlist-artwork-single', colorClass, className)} aria-hidden="true">
        <Artwork track={coverTracks[0]} className="playlist-cover-img playlist-artwork-cell" decorative />
      </div>
    );
  }

  if (count === 2) {
    return (
      <div className={cn('playlist-artwork playlist-artwork-duo', colorClass, className)} aria-hidden="true">
        <Artwork track={coverTracks[0]} className="playlist-artwork-cell playlist-cell-left" decorative />
        <Artwork track={coverTracks[1]} className="playlist-artwork-cell playlist-cell-right" decorative />
      </div>
    );
  }

  if (count === 3) {
    return (
      <div className={cn('playlist-artwork playlist-artwork-trio', colorClass, className)} aria-hidden="true">
        <Artwork track={coverTracks[0]} className="playlist-artwork-cell playlist-cell-hero" decorative />
        <Artwork track={coverTracks[1]} className="playlist-artwork-cell playlist-cell-top-right" decorative />
        <Artwork track={coverTracks[2]} className="playlist-artwork-cell playlist-cell-bottom-right" decorative />
      </div>
    );
  }

  return (
    <div className={cn('playlist-artwork playlist-artwork-quad', colorClass, className)} aria-hidden="true">
      {coverTracks.slice(0, 4).map((item, idx) => (
        <Artwork
          key={`${item.id}-${idx}`}
          track={item}
          className={`playlist-artwork-cell playlist-cell-${idx + 1}`}
          decorative
        />
      ))}
    </div>
  );
}
