import { GuildMember, GuildTextBasedChannel, VoiceBasedChannel } from 'discord.js';
import { DisTube, DisTubeError, isURL, PlayOptions, Song } from 'distube';
import { resolveAppleMusic } from '../utils/appleMusic';
import { PlaybackMetadata, SearchSource, YtDlpSearchPlugin } from './ytDlpSearchPlugin';
import { getPlaybackState } from './playbackState';
import { controlError, installQueueControlGuard, musicSessionIsCreating, musicSessionVersion, withMusicAccess, withoutMusicAccess } from './controlAccess';

export interface PlaybackRequest {
  guildId: string; member: GuildMember; voiceChannel: VoiceBasedChannel; query: string; searchSource: SearchSource;
  textChannel?: GuildTextBasedChannel;
  authorize: () => Promise<void> | void;
  searching?: (displayQuery: string) => Promise<void>;
  signal?: AbortSignal;
}

/** Shared Discord/web entry point: one search pipeline and the existing DisTube playback/recovery engine. */
export async function requestPlayback(distube: DisTube, request: PlaybackRequest): Promise<void> {
  const { guildId, member, voiceChannel, query, searchSource, signal } = request;
  const initialQueue = distube.getQueue(guildId), revision = initialQueue ? getPlaybackState(initialQueue)?.revision : undefined;
  let ownedQueue = initialQueue;
  let version = musicSessionVersion(distube, guildId);
  const validate = async () => {
    signal?.throwIfAborted();
    await request.authorize();
    signal?.throwIfAborted();
    const current = distube.getQueue(guildId);
    if (musicSessionVersion(distube, guildId) !== version || current !== ownedQueue || ownedQueue?.stopped || (ownedQueue && getPlaybackState(ownedQueue)?.closing) ||
      initialQueue && getPlaybackState(initialQueue)?.revision !== revision || member.voice.channel?.id !== voiceChannel.id) {
      throw controlError('SESSION_CHANGED', 'La sesión, la cola o tu canal de voz cambió mientras buscaba. Vuelve a intentarlo.');
    }
  };
  signal?.throwIfAborted();
  await request.authorize();
  const resolved = await resolveAppleMusic(query);
  signal?.throwIfAborted();
  await request.searching?.(resolved.isAppleMusic && resolved.artist && resolved.title ? `${resolved.artist} - ${resolved.title}` : query);
  const options: PlayOptions<PlaybackMetadata> = { member, metadata: { searchSource }, ...(request.textChannel ? { textChannel: request.textChannel } : {}) };
  let input: string | Song<PlaybackMetadata> = resolved.query;
  if (!isURL(input)) {
    const plugin = distube.plugins.find((item): item is YtDlpSearchPlugin => item instanceof YtDlpSearchPlugin);
    if (!plugin) throw new DisTubeError('NO_EXTRACTOR_PLUGIN');
    const song = await plugin.searchSong(input, options, signal);
    if (!song) throw new DisTubeError('CANNOT_RESOLVE_SONG', input);
    input = song;
  }
  // Before playback begins no replacement queue may be adopted, even if it uses the same voice channel.
  if (distube.getQueue(guildId) !== initialQueue || musicSessionVersion(distube, guildId) !== version) throw controlError('SESSION_CHANGED', 'La sesión cambió mientras buscaba. Vuelve a intentarlo.');
  if (initialQueue) installQueueControlGuard(initialQueue);
  try {
    await withMusicAccess(distube, validate, () => distube.play<PlaybackMetadata>(voiceChannel, input, options), queue => {
      if (initialQueue || ownedQueue) throw controlError('SESSION_CHANGED', 'La sesión cambió mientras esperaba.');
      ownedQueue = queue;
      version = musicSessionVersion(distube, guildId);
    });
  } catch (error) {
    const created = !initialQueue ? ownedQueue : undefined;
    if (created && !created.stopped && !created.songs.length && distube.getQueue(guildId) === created) {
      await withoutMusicAccess(async () => {
        await created._taskQueue.queuing();
        try {
          if (!created.stopped && !created.songs.length && distube.getQueue(guildId) === created) {
            created.remove();
            if (distube.voices.get(guildId) === created.voice) created.voice.leave();
          }
        } finally { created._taskQueue.resolve(); }
      });
    } else {
      // DisTube's play-finally may already have removed an empty failed queue. Leave only if no successor is creating or active.
      if (created?.stopped && !distube.getQueue(guildId) && !musicSessionIsCreating(distube, guildId) && distube.voices.get(guildId) === created.voice) created.voice.leave();
    }
    throw error;
  }
}
