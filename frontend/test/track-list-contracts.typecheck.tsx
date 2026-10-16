import { TrackItem, TrackList, type TrackActions } from '../src/components/queue/TrackList';
import type { Playlist, Track } from '../src/lib/api';

// Compiled by the frontend build; these examples are never executed.
export function verifyTrackOwnership(track: Track, owner: Playlist, actions: TrackActions) {
  const tracks = [track];
  const item = { track, index: 0, length: 1, actions };

  void (<TrackList tracks={tracks} context="playlist" owner={owner} actions={actions} />);
  void (<TrackList tracks={tracks} context="queue" actions={actions} />);
  void (<TrackList tracks={tracks} context="favorites" actions={actions} />);
  void (<TrackItem {...item} context="playlist" owner={owner} />);
  void (<TrackItem {...item} context="queue" />);
  void (<TrackItem {...item} context="favorites" />);

  // @ts-expect-error Playlist actions must have their owning playlist.
  void (<TrackList tracks={tracks} context="playlist" actions={actions} />);
  // @ts-expect-error Queue actions must not receive a playlist owner.
  void (<TrackList tracks={tracks} context="queue" owner={owner} actions={actions} />);
  // @ts-expect-error Favorites actions must not receive a playlist owner.
  void (<TrackList tracks={tracks} context="favorites" owner={owner} actions={actions} />);
  // @ts-expect-error Playlist row actions must have their owning playlist.
  void (<TrackItem {...item} context="playlist" />);
  // @ts-expect-error Queue row actions must not receive a playlist owner.
  void (<TrackItem {...item} context="queue" owner={owner} />);
  // @ts-expect-error Favorites row actions must not receive a playlist owner.
  void (<TrackItem {...item} context="favorites" owner={owner} />);
}
