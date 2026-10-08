import { Queue, Song } from 'distube';
import { classifyMusicError } from './errors';
import { YtDlpSearchPlugin } from './ytDlpSearchPlugin';

const RECOVERABLE = new Set(['FFMPEG_EXITED', 'ERR_STREAM_PREMATURE_CLOSE', 'NETWORK_ERROR', 'NETWORK_TIMEOUT', 'SOURCE_UNAVAILABLE', 'SOURCE_BLOCKED']);

export class PlaybackRecovery {
  private readonly attempts = new WeakMap<Song, number>();
  private readonly started = new WeakMap<Queue, Song>();

  markStarted(queue: Queue, song: Song): void {
    this.started.set(queue, song);
  }

  retry(queue: Queue, song: Song | undefined, error: unknown, plugin: YtDlpSearchPlugin | undefined): number {
    if (!song || !plugin || queue.stopped || !RECOVERABLE.has(classifyMusicError(error))) return 0;
    const playable = song.stream.playFromSource ? song : song.stream.song;
    if (!playable || playable.plugin !== plugin) return 0;
    const attempt = (this.attempts.get(song) ?? 0) + 1;
    if (attempt > 2) return 0;
    this.attempts.set(song, attempt);
    const position = queue.currentTime;
    if (this.started.get(queue) === song && Number.isFinite(position) && position > 1 && position < song.duration - 2) {
      queue._beginTime = Math.max(0, position - 1);
    }
    plugin.invalidateStream(song, attempt * 1_000);
    // DisTube shifted the failed song already. Reinsert before it decides to stop.
    if (!queue.songs.includes(song)) queue.songs.unshift(song);
    return attempt;
  }
}
