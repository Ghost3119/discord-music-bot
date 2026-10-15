import { Client, Guild, GuildMember, VoiceBasedChannel } from 'discord.js';
import { Queue, Song } from 'distube';
import type { MusicAction, MusicBridge, PlaybackSnapshot, Track } from '../web/contracts';
import { HistoryStore, publicMusicUrl } from './history';
import { getPlaybackHealth } from './playbackHealth';
import { getPlaybackState } from './playbackState';
import { getAudioPreloader } from './audioPreloader';
import { editQueue, setQueueSetting } from './queueActions';
import { checkpointQueue } from './queueChanges';
import { getPlayerPanels } from './playerPanel';
import { controlError, installQueueControlGuard, musicSessionVersion, withMusicAccess } from './controlAccess';
import { requestPlayback } from './playbackRequest';

const denied = () => controlError('GUILD_ACCESS_DENIED', 'No tienes acceso a este servidor.');
const boundedText = (input: unknown, max = 200): string => typeof input === 'string' ? input.slice(0, max) : '';
const safeCode = (input: unknown): string => typeof input === 'string' && /^[A-Z0-9_]{1,64}$/.test(input) ? input : 'PLAYBACK_ERROR';
function artwork(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2000) return null;
  try {
    const url = new URL(input);
    const allowed = ['ytimg.com', 'scdn.co', 'sndcdn.com', 'mzstatic.com'];
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      allowed.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return url.href;
  } catch { /* Artwork is optional; signed media URLs are never exposed. */ }
  return null;
}
function track(song: Song): Track {
  return { id: /^[\w-]{1,128}$/.test(song.id) ? song.id : '', url: publicMusicUrl(song.url) ?? '',
    title: boundedText(song.name) || 'Canción sin título', artist: boundedText(song.uploader?.name),
    duration: Number.isFinite(song.duration) ? Math.max(0, song.duration) : 0, thumbnail: artwork(song.thumbnail),
    source: /^[\w-]{1,60}$/.test(song.source) ? song.source : 'unknown' };
}
function permissions(client: Client, voice: VoiceBasedChannel): void {
  const access = client.user ? voice.permissionsFor(client.user.id) : null;
  if (!access || !['ViewChannel', 'Connect', 'Speak'].every(flag => access.has(flag as 'ViewChannel' | 'Connect' | 'Speak'))) {
    throw controlError('VOICE_PERMISSIONS', 'El bot necesita permisos para ver, conectar y hablar en el canal de voz.');
  }
}
function voiceFor(client: Client, member: GuildMember, queue?: Queue): VoiceBasedChannel {
  const voice = member.voice.channel;
  if (!voice || queue && voice.id !== queue.voiceChannel?.id) {
    throw controlError('CONTROL_CHANNEL_REQUIRED', queue ? 'Debes estar en el mismo canal de voz que el bot.' : 'Debes estar en un canal de voz.');
  }
  permissions(client, voice);
  return voice;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw controlError('INVALID_ACTION', 'Parámetro de control no válido.');
  }
  return value;
}
function webQuery(input: string | undefined): string {
  const query = input?.trim();
  if (!query || query.length > 1000) throw controlError('INVALID_ACTION', 'Escribe una búsqueda o enlace válido.');
  if (!/^[a-z][a-z\d+.-]*:/i.test(query)) return query;
  try {
    const url = new URL(query), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Invalid origin');
    const supported = ['youtube.com', 'www.youtube.com', 'music.youtube.com'].includes(host)
      ? url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') ?? '') || url.pathname === '/playlist' && /^[\w-]{1,100}$/.test(url.searchParams.get('list') ?? '') || /^\/(?:shorts|live)\/[\w-]{11}$/.test(url.pathname)
      : host === 'youtu.be' ? /^\/[\w-]{11}$/.test(url.pathname)
        : ['soundcloud.com', 'www.soundcloud.com'].includes(host) ? /^\/[\w-]+\/(?:[\w-]+|sets\/[\w-]+)\/?$/.test(url.pathname)
          : host === 'open.spotify.com' ? /^\/(?:intl-[a-z]{2}\/)?(?:track|album|playlist)\/[a-zA-Z0-9]+$/.test(url.pathname)
            : host === 'music.apple.com' && /^\/[a-z]{2}\/(?:album|song|playlist)\/[\w%./-]+$/.test(url.pathname);
    if (!supported) throw new Error('Unsupported music link');
    for (const key of [...url.searchParams.keys()]) if (!['v', 'list', 'i'].includes(key)) url.searchParams.delete(key);
    url.hash = '';
    return url.href;
  } catch { throw controlError('INVALID_ACTION', 'Usa una búsqueda o un enlace público de YouTube, SoundCloud, Spotify o Apple Music.'); }
}

/** User IDs originate in the server session. Membership and voice permissions always come from Discord. */
export function createMusicBridge(client: Client, history?: HistoryStore): MusicBridge {
  const distube = client.distube;
  // Playlist loading shares one cancellation signal across tracks. Preserve its first playback session.
  const groupedSessions = new WeakMap<AbortSignal, Map<string, { queue: Queue | undefined; version: number }>>();
  async function membership(userId: string, guildId: string): Promise<{ guild: Guild; member: GuildMember }> {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw denied();
    const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
    if (!member || member.user.bot || !client.guilds.cache.has(guildId)) throw denied();
    return { guild, member };
  }
  return {
    async listGuilds(userId) {
      const result = [];
      for (const guild of client.guilds.cache.values()) {
        try {
          await membership(userId, guild.id);
          result.push({ id: guild.id, name: guild.name, icon: guild.iconURL({ size: 64 }) });
        } catch (error) {
          if ((error as { errorCode?: string }).errorCode !== 'GUILD_ACCESS_DENIED') throw error;
        }
      }
      return result;
    },
    async assertGuildAccess(userId, guildId) { await membership(userId, guildId); },
    async getState(userId, guildId): Promise<PlaybackSnapshot> {
      await membership(userId, guildId);
      const queue = distube.getQueue(guildId), state = queue ? getPlaybackState(queue) : undefined;
      const health = getPlaybackHealth(distube), now = health?.now() ?? Date.now();
      const incidents = (history ?? health?.history)?.list(guildId).filter(item => item.result === 'failed').slice(0, 10)
        .map(item => ({ code: safeCode(item.code), message: 'La reproducción encontró un error; consulta el código de diagnóstico.', at: new Date(item.time).toISOString() })) ?? [];
      if (state?.lastError && !incidents.some(item => item.code === state.lastError?.code && item.at === new Date(state.lastError.time).toISOString())) {
        incidents.unshift({ code: safeCode(state.lastError.code), message: 'La reproducción está recuperando un error reciente.', at: new Date(state.lastError.time).toISOString() });
      }
      return { guildId, status: !queue || queue.stopped ? 'idle' : state?.blocked ? 'blocked' : state && ['recovering', 'alternative'].includes(state.mode) ? 'recovering' : queue.paused ? 'paused' : 'playing',
        current: queue?.songs[0] ? track(queue.songs[0]) : null, queue: queue?.songs.slice(1, 501).map(track) ?? [],
        currentTime: queue && Number.isFinite(queue.currentTime) ? Math.max(0, queue.currentTime) : 0,
        volume: queue?.volume ?? 50, repeat: queue?.repeatMode ?? 0,
        voice: queue?.voiceChannel ? { id: queue.voiceChannel.id, name: boundedText(queue.voiceChannel.name, 100), members: queue.voiceChannel.members.size } : null,
        health: { connected: client.isReady(), ping: Math.max(0, Math.round(client.ws.ping)),
          voiceConnected: Boolean(queue?.voiceChannel && !queue.voice.isDisconnected), mode: state?.mode ?? 'idle',
          attempts: state?.attempt ?? 0, recentFailures: state?.failures.filter(time => now - time < 300_000).length ?? 0,
          lastProgressAt: state?.lastProgress ? new Date(state.lastProgress).toISOString() : null,
          monitor: health?.monitor ?? false, breaker: health?.breaker ?? false,
          ...(getAudioPreloader(distube) ? { preload: getAudioPreloader(distube)!.metrics } : {}) }, incidents: incidents.slice(0, 10) };
    },
    async control(userId: string, guildId: string, action: MusicAction, signal?: AbortSignal): Promise<void> {
      signal?.throwIfAborted();
      const { member } = await membership(userId, guildId), queue = distube.getQueue(guildId);
      const voice = voiceFor(client, member, queue);
      const authorize = async () => {
        signal?.throwIfAborted();
        const { member: current } = await membership(userId, guildId);
        signal?.throwIfAborted();
        if (voiceFor(client, current, queue).id !== voice.id) throw controlError('CONTROL_CHANNEL_REQUIRED', 'Tu canal de voz cambió mientras esperaba.');
      };
      if (action.action === 'play') {
        const expected = signal ? groupedSessions.get(signal)?.get(guildId) : undefined;
        if (expected && (expected.queue !== queue || expected.version !== musicSessionVersion(distube, guildId))) {
          throw controlError('SESSION_CHANGED', 'La sesión cambió durante la carga de la playlist.');
        }
        const query = webQuery(action.query);
        await requestPlayback(distube, { guildId, member, voiceChannel: voice, query, searchSource: 'youtube', authorize, ...(signal ? { signal } : {}) });
        const current = distube.getQueue(guildId);
        if (signal) {
          let sessions = groupedSessions.get(signal);
          if (!sessions) { sessions = new Map(); groupedSessions.set(signal, sessions); }
          sessions.set(guildId, { queue: current, version: musicSessionVersion(distube, guildId) });
        }
        if (current) { checkpointQueue(distube, current); await getPlayerPanels(distube)?.refresh(current); }
        return;
      }
      if (!queue) throw controlError('NO_QUEUE', 'No hay música reproduciéndose.');
      const wasBlocked = Boolean(getPlaybackState(queue)?.blocked);
      installQueueControlGuard(queue);
      const check = async () => {
        if (distube.getQueue(guildId) !== queue || queue.stopped || getPlaybackState(queue)?.closing && action.action !== 'stop') throw controlError('SESSION_CHANGED', 'La sesión terminó mientras esperaba.');
        await authorize();
        if (distube.getQueue(guildId) !== queue || queue.stopped || getPlaybackState(queue)?.closing && action.action !== 'stop') throw controlError('SESSION_CHANGED', 'La sesión terminó mientras esperaba.');
        if (getPlaybackState(queue)?.blocked && (action.action === 'skip' || action.action === 'resume' && !wasBlocked)) throw controlError('QUEUE_BLOCKED', 'La cola está pausada por fallos. Usa Reintentar o Detener.');
      };
      await withMusicAccess(distube, check, async () => {
        switch (action.action) {
          case 'pause': await queue.pause(); break;
          case 'resume': await queue.resume(); break;
          case 'skip': await queue.skip(); break;
          case 'stop': await queue.stop(); break;
          case 'shuffle': await editQueue(distube, queue, { type: 'shuffle' }); break;
          case 'remove': await editQueue(distube, queue, { type: 'remove', position: integer(action.index, 1, 500) }); break;
          case 'move': await editQueue(distube, queue, { type: 'move', from: integer(action.from, 1, 500), to: integer(action.to, 1, 500) }); break;
          case 'volume':
          case 'repeat':
            await setQueueSetting(distube, queue, action.action, action.action === 'volume' ? integer(action.volume, 0, 100) : integer(action.mode, 0, 2));
            break;
          default: throw controlError('INVALID_ACTION', 'Control de música no válido.');
        }
      });
      if (!queue.stopped && distube.getQueue(guildId) === queue) { checkpointQueue(distube, queue); await getPlayerPanels(distube)?.refresh(queue); }
    },
  };
}
