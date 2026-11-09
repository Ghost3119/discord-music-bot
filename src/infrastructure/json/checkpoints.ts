import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SavedQueue, QueueCheckpointStore } from '../../domain/persistence/checkpoints';
import { sanitizeThumbnailUrl } from '../../music/artwork';
import { isPublicPlaybackUrl } from '../../music/mediaPolicy';
function publicThumbnail(value: unknown): string | undefined { return sanitizeThumbnailUrl(value) ?? undefined; }
export function isSavedQueue(value: unknown): value is SavedQueue {
  if (typeof value !== 'object' || value === null) return false;
  const queue = value as SavedQueue;
  const id = (value: unknown) => typeof value === 'string' && /^\d{15,22}$/.test(value);
  return id(queue.guildId) && id(queue.voiceChannelId) && (queue.textChannelId === undefined || id(queue.textChannelId)) &&
    (queue.blocked === undefined || typeof queue.blocked === 'boolean') &&
    (queue.probe === undefined || typeof queue.probe === 'boolean') &&
    (queue.failures === undefined || Array.isArray(queue.failures) && queue.failures.length <= 3 &&
      queue.failures.every(time => Number.isFinite(time) && time >= 0)) &&
    Number.isFinite(queue.position) && queue.position >= 0 && Number.isFinite(queue.volume) && queue.volume >= 0 && queue.volume <= 200 &&
    typeof queue.paused === 'boolean' && typeof queue.autoplay === 'boolean' && [0, 1, 2].includes(queue.repeatMode) &&
    Number.isFinite(queue.updatedAt) && Array.isArray(queue.songs) && queue.songs.length > 0 && queue.songs.length <= 500 &&
    queue.songs.every((song) => song && typeof song.id === 'string' && typeof song.source === 'string' &&
      (song.thumbnail === undefined || publicThumbnail(song.thumbnail) === song.thumbnail) &&
      typeof song.name === 'string' && song.name.length <= 500 && typeof song.uploader === 'string' && song.uploader.length <= 500 &&
      isPublicPlaybackUrl(song.url) &&
      song.url.length <= 2_000 && Number.isFinite(song.duration) && song.duration >= 0 &&
      typeof song.ageRestricted === 'boolean' && typeof song.playFromSource === 'boolean' &&
      ['youtube', 'soundcloud'].includes(song.searchSource));
}

export function createJsonQueueCheckpointStore(path: string): QueueCheckpointStore {
  const read = (): SavedQueue[] => {
    if (!existsSync(path)) return [];
    if (statSync(path).size > 5_000_000) throw new Error('El archivo de colas supera el tamaño máximo');
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(data)) throw new Error('Formato de colas inválido');
    return data.slice(0, 100).filter(isSavedQueue).filter(item => Date.now() - item.updatedAt < 24 * 60 * 60 * 1_000);
  };
  const write = (queues: SavedQueue[]): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(queues), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  };
  return { read, write, delete(guildId) { write(read().filter(queue => queue.guildId !== guildId)); } };
}
