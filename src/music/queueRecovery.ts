import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Client, ChannelType } from 'discord.js';
import { DisTube, Events, Playlist, Queue, Song, SongInfo } from 'distube';
import { guardedEvent } from '../runtime/safety';
import { getPlaybackState } from './playbackState';
import { getPlaybackHealth } from './playbackHealth';
import { registerCheckpoint } from './queueChanges';
import { youtubeThumbnail } from './artwork';

interface SavedSong {
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

interface SavedQueue {
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

interface RestoreAttempt {
  snapshot: SavedQueue;
  initializing: boolean;
  cancelled: boolean;
  queue?: Queue;
}

function publicThumbnail(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2_000) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return url.href;
  } catch { /* Artwork is optional; never persist a signed or unusable image URL. */ }
  return undefined;
}

function isSavedQueue(value: unknown): value is SavedQueue {
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
      typeof song.url === 'string' && /^https?:\/\//i.test(song.url) &&
      song.url.length <= 2_000 && Number.isFinite(song.duration) && song.duration >= 0 &&
      typeof song.ageRestricted === 'boolean' && typeof song.playFromSource === 'boolean' &&
      ['youtube', 'soundcloud'].includes(song.searchSource));
}

export class QueueRecovery {
  private readonly saved = new Map<string, SavedQueue>();
  private readonly restoring = new Map<string, RestoreAttempt>();
  private pendingRestore: Promise<void> | undefined;
  private suspended = false;
  private readonly detach: (() => void)[] = [];
  private readonly unregister: () => void;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly client: Client, private readonly distube: DisTube, private readonly path = resolve('data/queues.json')) {
    this.unregister = registerCheckpoint(distube, queue => this.capture(queue));
    this.load();
    const on = (event: Events.INIT_QUEUE | Events.PLAY_SONG | Events.ADD_SONG | Events.ADD_LIST | Events.FINISH_SONG | Events.DELETE_QUEUE,
      context: string, handler: (queue: Queue) => void) => {
      const listener = guardedEvent(context, handler);
      distube.on(event, listener);
      this.detach.push(() => distube.off(event, listener));
    };
    on(Events.INIT_QUEUE, 'Restaurar ajustes de la cola', (queue) => {
      const attempt = this.restoring.get(queue.id);
      if (this.suspended || !attempt) return;
      if (!attempt.initializing || attempt.queue) {
        if (queue !== attempt.queue) attempt.cancelled = true;
        return;
      }
      attempt.queue = queue;
      attempt.initializing = false;
      const { snapshot } = attempt;
      getPlaybackHealth(distube)?.restoreRecoveryState(queue, snapshot);
      queue.setVolume(snapshot.volume);
      if (queue.repeatMode !== snapshot.repeatMode) queue.setRepeatMode(snapshot.repeatMode);
      if (snapshot.autoplay !== queue.autoplay) queue.toggleAutoplay();
    });
    for (const event of [Events.PLAY_SONG, Events.ADD_SONG, Events.ADD_LIST, Events.FINISH_SONG] as const) {
      on(event, `Guardar cola ${event}`, queue => this.capture(queue));
    }
    on(Events.DELETE_QUEUE, 'Eliminar cola guardada', (queue) => {
      if (this.suspended) return;
      const current = distube.getQueue(queue.id);
      if (current && current !== queue) return;
      const attempt = this.restoring.get(queue.id);
      if (attempt?.queue === queue) {
        // Keep a checkpoint after an automatic startup failure, but an explicit
        // stop marks the session closing before waiting for the queue lock.
        if (!getPlaybackState(queue)?.closing) return;
        attempt.cancelled = true;
      }
      this.saved.delete(queue.id);
      this.write();
    });
    this.timer = setInterval(guardedEvent('Guardar progreso de colas', () => this.captureAll()), 10_000);
    this.timer.unref();
  }

  private load(): void {
    try {
      if (!existsSync(this.path)) return;
      if (statSync(this.path).size > 5_000_000) throw new Error('El archivo de colas supera el tamaño máximo');
      const data: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!Array.isArray(data)) throw new Error('Formato de colas inválido');
      for (const item of data.slice(0, 100)) {
        if (isSavedQueue(item) && Date.now() - item.updatedAt < 24 * 60 * 60 * 1_000) this.saved.set(item.guildId, item);
      }
    } catch (error) {
      console.error('No se pudieron leer las colas guardadas; el bot seguirá disponible:', error);
    }
  }

  private write(): void {
    if (this.suspended) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(`${this.path}.tmp`, JSON.stringify([...this.saved.values()]), { mode: 0o600 });
      renameSync(`${this.path}.tmp`, this.path);
    } catch (error) {
      console.error('No se pudo guardar la cola; la reproducción continúa:', error);
    }
  }

  private capture(queue: Queue): void {
    if (this.suspended || this.restoring.get(queue.id)?.queue === queue || queue.stopped || !queue.voiceChannel || !queue.songs.length) return;
    if (this.distube.getQueue(queue.id) !== queue) return;
    const songs = queue.songs.slice(0, 500).flatMap((song): SavedSong[] => {
      if (!song.url) return [];
      const metadata = song.metadata as { searchSource?: unknown } | null;
      const thumbnail = publicThumbnail(song.thumbnail) ?? publicThumbnail(youtubeThumbnail(song.source, song.id, song.url));
      return [{ id: song.id, source: song.source, url: song.url, name: (song.name ?? song.id).slice(0, 500),
        ...(thumbnail ? { thumbnail } : {}),
        uploader: (song.uploader.name ?? '').slice(0, 500),
        duration: song.duration, ageRestricted: Boolean(song.ageRestricted), playFromSource: song.stream.playFromSource,
        searchSource: metadata?.searchSource === 'soundcloud' ? 'soundcloud' : 'youtube' }];
    });
    if (!songs.length) return;
    const state = getPlaybackState(queue), now = getPlaybackHealth(this.distube)?.now() ?? Date.now();
    this.saved.set(queue.id, {
      guildId: queue.id, voiceChannelId: queue.voiceChannel.id,
      blocked: Boolean(state?.blocked), probe: Boolean(state?.probe),
      failures: (state?.failures ?? []).filter(time => time <= now && now - time < 300_000).slice(-3),
      ...(queue.textChannel ? { textChannelId: queue.textChannel.id } : {}),
      songs, position: queue.currentTime, volume: queue.volume, paused: queue.paused,
      autoplay: queue.autoplay, repeatMode: queue.repeatMode, updatedAt: Date.now(),
    });
    this.write();
  }

  private captureAll(): void {
    for (const queue of this.distube.queues.collection.values()) this.capture(queue);
  }

  stop(): void {
    if (this.suspended) return;
    this.unregister();
    clearInterval(this.timer);
    this.captureAll();
    // Discord teardown emits DELETE_QUEUE. Keep the checkpoint for the next boot.
    this.suspended = true;
    for (const detach of this.detach.splice(0)) detach();
  }

  restore(): Promise<void> {
    if (!this.pendingRestore) this.pendingRestore = this.restoreSaved().finally(() => { this.pendingRestore = undefined; });
    return this.pendingRestore;
  }

  private async restoreSaved(): Promise<void> {
    for (const snapshot of [...this.saved.values()]) {
      if (this.suspended || this.distube.getQueue(snapshot.guildId)) continue;
      const attempt: RestoreAttempt = { snapshot, initializing: false, cancelled: false };
      this.restoring.set(snapshot.guildId, attempt);
      const cancelled = () => this.suspended || attempt.cancelled || Boolean(this.distube.getQueue(snapshot.guildId));
      try {
        const voice = await this.client.channels.fetch(snapshot.voiceChannelId);
        if (cancelled()) continue;
        if (!voice || voice.type !== ChannelType.GuildVoice || voice.guildId !== snapshot.guildId ||
          !voice.members.some((member) => !member.user.bot) || !voice.joinable || !voice.speakable) {
          this.saved.delete(snapshot.guildId);
          continue;
        }
        const text = snapshot.textChannelId ? await this.client.channels.fetch(snapshot.textChannelId).catch(() => null) : null;
        if (cancelled()) continue;
        const songs: Song[] = [];
        for (const saved of snapshot.songs) {
          const plugin = await this.distube.handler._getPluginFromURL(saved.url);
          if (cancelled()) break;
          if (!plugin) continue;
          // Metadata-only platforms must retain their info-extractor semantics.
          if (!saved.playFromSource && plugin.type !== 'info-extractor') continue;
          const thumbnail = saved.thumbnail || youtubeThumbnail(saved.source, saved.id, saved.url);
          const info: SongInfo = { plugin, source: saved.source, id: saved.id, name: saved.name,
            ...(thumbnail ? { thumbnail } : {}),
            url: saved.url, uploader: { name: saved.uploader }, duration: saved.duration, ageRestricted: saved.ageRestricted, playFromSource: saved.playFromSource };
          songs.push(new Song(info, { metadata: { searchSource: saved.searchSource } }));
        }
        if (cancelled()) continue;
        const first = songs[0];
        if (!first) {
          this.saved.delete(snapshot.guildId);
          continue;
        }
        // Add all songs before starting so an unavailable first track can be skipped.
        const playlist = new Playlist({ source: 'recovery', songs });
        attempt.initializing = true;
        await this.distube.play(voice, playlist, {
          metadata: { searchSource: snapshot.songs[0]?.searchSource ?? 'youtube' },
          ...(text?.isTextBased() && 'guildId' in text && text.guildId === snapshot.guildId ? { textChannel: text } : {}),
        });
        attempt.initializing = false;
        const queue = this.distube.getQueue(snapshot.guildId);
        if (this.suspended || attempt.cancelled || !queue || queue.stopped || queue !== attempt.queue) continue;
        // INIT_QUEUE already applied settings before playback. Reapplying them
        // here would undo user changes made while stream extraction was pending.
        if (!snapshot.blocked && queue.songs[0] === first && snapshot.position > 0 && first.duration > snapshot.position + 5) await queue.seek(snapshot.position);
        if (this.suspended || queue.stopped || this.distube.getQueue(snapshot.guildId) !== queue) continue;
        if (snapshot.paused && !queue.paused) await queue.pause();
        console.log(`✅ Cola recuperada para ${snapshot.guildId}: ${queue.songs.length} canciones`);
      } catch (error) {
        console.error(`No se pudo recuperar la cola de ${snapshot.guildId}; el bot sigue disponible:`, error);
      } finally {
        this.restoring.delete(snapshot.guildId);
      }
    }
    this.captureAll();
    this.write();
  }
}
