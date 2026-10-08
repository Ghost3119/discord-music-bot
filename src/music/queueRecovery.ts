import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Client, ChannelType } from 'discord.js';
import { DisTube, Events, Playlist, Queue, Song, SongInfo } from 'distube';
import { guardedEvent } from '../runtime/safety';

interface SavedSong {
  id: string;
  source: string;
  url: string;
  name: string;
  uploader: string;
  duration: number;
  ageRestricted: boolean;
  playFromSource: boolean;
  searchSource: 'youtube' | 'soundcloud';
}

interface SavedQueue {
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

function isSavedQueue(value: unknown): value is SavedQueue {
  if (typeof value !== 'object' || value === null) return false;
  const queue = value as SavedQueue;
  const id = (value: unknown) => typeof value === 'string' && /^\d{15,22}$/.test(value);
  return id(queue.guildId) && id(queue.voiceChannelId) && (queue.textChannelId === undefined || id(queue.textChannelId)) &&
    Number.isFinite(queue.position) && queue.position >= 0 && Number.isFinite(queue.volume) && queue.volume >= 0 && queue.volume <= 200 &&
    typeof queue.paused === 'boolean' && typeof queue.autoplay === 'boolean' && [0, 1, 2].includes(queue.repeatMode) &&
    Number.isFinite(queue.updatedAt) && Array.isArray(queue.songs) && queue.songs.length > 0 && queue.songs.length <= 500 &&
    queue.songs.every((song) => song && typeof song.id === 'string' && typeof song.source === 'string' &&
      typeof song.name === 'string' && song.name.length <= 500 && typeof song.uploader === 'string' && song.uploader.length <= 500 &&
      typeof song.url === 'string' && /^https?:\/\//i.test(song.url) &&
      song.url.length <= 2_000 && Number.isFinite(song.duration) && song.duration >= 0 &&
      typeof song.ageRestricted === 'boolean' && typeof song.playFromSource === 'boolean' &&
      ['youtube', 'soundcloud'].includes(song.searchSource));
}

export class QueueRecovery {
  private readonly saved = new Map<string, SavedQueue>();
  private readonly restoring = new Set<string>();
  private suspended = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly client: Client, private readonly distube: DisTube, private readonly path = resolve('data/queues.json')) {
    this.load();
    distube.on(Events.INIT_QUEUE, guardedEvent('Restaurar ajustes de la cola', (queue) => {
      const snapshot = this.restoring.has(queue.id) ? this.saved.get(queue.id) : undefined;
      if (!snapshot) return;
      queue.setVolume(snapshot.volume);
      queue.setRepeatMode(snapshot.repeatMode);
      if (snapshot.autoplay !== queue.autoplay) queue.toggleAutoplay();
    }));
    for (const event of [Events.PLAY_SONG, Events.ADD_SONG, Events.ADD_LIST, Events.FINISH_SONG] as const) {
      distube.on(event, guardedEvent(`Guardar cola ${event}`, (queue: Queue) => this.capture(queue)));
    }
    distube.on(Events.DELETE_QUEUE, guardedEvent('Eliminar cola guardada', (queue) => {
      if (this.suspended || this.restoring.has(queue.id)) return;
      this.saved.delete(queue.id);
      this.write();
    }));
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
    if (this.suspended || this.restoring.has(queue.id) || queue.stopped || !queue.voiceChannel || !queue.songs.length) return;
    const songs = queue.songs.slice(0, 500).flatMap((song): SavedSong[] => {
      if (!song.url) return [];
      const metadata = song.metadata as { searchSource?: unknown } | null;
      return [{ id: song.id, source: song.source, url: song.url, name: (song.name ?? song.id).slice(0, 500),
        uploader: (song.uploader.name ?? '').slice(0, 500),
        duration: song.duration, ageRestricted: Boolean(song.ageRestricted), playFromSource: song.stream.playFromSource,
        searchSource: metadata?.searchSource === 'soundcloud' ? 'soundcloud' : 'youtube' }];
    });
    if (!songs.length) return;
    this.saved.set(queue.id, {
      guildId: queue.id, voiceChannelId: queue.voiceChannel.id,
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
    clearInterval(this.timer);
    this.captureAll();
    // Discord teardown emits DELETE_QUEUE. Keep the checkpoint for the next boot.
    this.suspended = true;
  }

  async restore(): Promise<void> {
    for (const snapshot of [...this.saved.values()]) {
      if (this.suspended || this.distube.getQueue(snapshot.guildId)) continue;
      this.restoring.add(snapshot.guildId);
      try {
        const voice = await this.client.channels.fetch(snapshot.voiceChannelId);
        if (!voice || voice.type !== ChannelType.GuildVoice || voice.guildId !== snapshot.guildId ||
          !voice.members.some((member) => !member.user.bot) || !voice.joinable || !voice.speakable) {
          this.saved.delete(snapshot.guildId);
          continue;
        }
        const text = snapshot.textChannelId ? await this.client.channels.fetch(snapshot.textChannelId).catch(() => null) : null;
        const songs: Song[] = [];
        for (const saved of snapshot.songs) {
          const plugin = await this.distube.handler._getPluginFromURL(saved.url);
          if (!plugin) continue;
          // Metadata-only platforms must retain their info-extractor semantics.
          if (!saved.playFromSource && plugin.type !== 'info-extractor') continue;
          const info: SongInfo = { plugin, source: saved.source, id: saved.id, name: saved.name,
            url: saved.url, uploader: { name: saved.uploader }, duration: saved.duration, ageRestricted: saved.ageRestricted, playFromSource: saved.playFromSource };
          songs.push(new Song(info, { metadata: { searchSource: saved.searchSource } }));
        }
        const first = songs[0];
        if (!first) {
          this.saved.delete(snapshot.guildId);
          continue;
        }
        // Add all songs before starting so an unavailable first track can be skipped.
        const playlist = new Playlist({ source: 'recovery', songs });
        await this.distube.play(voice, playlist, {
          metadata: { searchSource: snapshot.songs[0]?.searchSource ?? 'youtube' },
          ...(text?.isTextBased() && 'guildId' in text && text.guildId === snapshot.guildId ? { textChannel: text } : {}),
        });
        const queue = this.distube.getQueue(snapshot.guildId);
        if (!queue || queue.stopped) continue;
        queue.setVolume(snapshot.volume);
        queue.setRepeatMode(snapshot.repeatMode);
        if (snapshot.autoplay !== queue.autoplay) queue.toggleAutoplay();
        if (queue.songs[0] === first && snapshot.position > 0 && first.duration > snapshot.position + 5) await queue.seek(snapshot.position);
        if (snapshot.paused && !queue.paused) queue.pause();
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
