import { randomUUID } from 'node:crypto';
import { Events, type DisTube, type Queue, type Song } from 'distube';

interface Instance { song: Song; id: string }
const trackers = new WeakMap<DisTube, WeakMap<Queue, Instance>>();

/** Read-only observer: no queue mutation, timer or interference with playback/recovery. */
export function playbackIdentity(distube: DisTube, queue: Queue | undefined): string | null {
  let instances = trackers.get(distube);
  if (!instances) {
    instances = new WeakMap();
    trackers.set(distube, instances);
    distube.on(Events.PLAY_SONG, (playingQueue, song) => {
      instances!.set(playingQueue, { song, id: randomUUID() });
    });
  }
  const song = queue?.songs[0];
  if (!queue || queue.stopped || !song) return null;
  let instance = instances.get(queue);
  if (!instance || instance.song !== song) {
    instance = { song, id: randomUUID() };
    instances.set(queue, instance);
  }
  return instance.id;
}
