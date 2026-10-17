import type { GuildMember } from 'discord.js';
import type { DisTube, Queue, Song } from 'distube';
import { getPlaybackState, markQueueEdited } from './playbackState';
import { controlError } from './controlAccess';
import type { YtDlpSearchPlugin } from './ytDlpSearchPlugin';

export const MAX_RECOMMENDATIONS = 20;
export function selectRecommendations(candidates: Song[], excluded: Song[], amount: number): Song[] {
  const seenIds = new Set(excluded.map(song => song.id));
  const seenUrls = new Set(excluded.map(song => song.url).filter((url): url is string => Boolean(url)));
  const selected: Song[] = [];
  for (const song of candidates) {
    if (seenIds.has(song.id) || song.url && seenUrls.has(song.url)) continue;
    selected.push(song); seenIds.add(song.id); if (song.url) seenUrls.add(song.url);
    if (selected.length >= amount) break;
  }
  return selected;
}
const pending = new WeakSet<Queue>();
/** The Discord YouTube Mix algorithm, shared with the web transport. Network work never holds the audio lock. */
export async function recommendForQueue(distube: DisTube, queue: Queue, plugin: YtDlpSearchPlugin, member: GuildMember, amount = 5, signal?: AbortSignal, authorize?: () => Promise<void>, reportFailures = false): Promise<number> {
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_RECOMMENDATIONS) throw controlError('INVALID_ACTION', 'Cantidad de recomendaciones no válida.');
  if (pending.has(queue)) throw controlError('MUSIC_BUSY', 'Ya se están buscando recomendaciones para esta cola.');
  if (!queue.songs[0]) throw controlError('NO_QUEUE', 'Primero reproduce una canción.');
  const original = [...queue.songs], revision = getPlaybackState(queue)?.revision;
  const check = async () => {
    signal?.throwIfAborted();
    await authorize?.();
    signal?.throwIfAborted();
    if (distube.getQueue(queue.id) !== queue || queue.stopped || getPlaybackState(queue)?.closing || getPlaybackState(queue)?.revision !== revision
      || queue.songs.length !== original.length || original.some((song,index) => queue.songs[index] !== song)) throw controlError('SESSION_CHANGED', 'La cola terminó o cambió mientras buscaba recomendaciones.');
    if (member.voice.channel?.id !== queue.voiceChannel?.id) throw controlError('CONTROL_CHANNEL_REQUIRED', 'Debes seguir en el canal de voz del bot.');
  };
  pending.add(queue);
  try {
    await check();
    const seeds = [original[0]!, original.at(-1)!].filter((song,index,songs) => songs.findIndex(item => item.id === song.id) === index);
    const candidates: Song[] = [];
    let completedLookups = 0;
    for (const seed of seeds) {
      try { candidates.push(...await plugin.getRecommendations(seed, signal)); completedLookups++; }
      catch (error) { signal?.throwIfAborted(); console.warn('No se pudo consultar YouTube Mix para una semilla de la cola.'); }
      await check();
      if (selectRecommendations(candidates, [...queue.songs, ...queue.previousSongs], amount).length >= amount) break;
    }
    if (!completedLookups && reportFailures) throw controlError('RECOMMEND_UNAVAILABLE', 'No se pudo consultar YouTube Mix ahora.');
    await queue._taskQueue?.queuing();
    try {
      await check();
      const selected = selectRecommendations(candidates, [...queue.songs, ...queue.previousSongs], amount);
      if (selected.length) {
        for (const song of selected) song.member = member;
        queue.addToQueue(selected); markQueueEdited(queue);
      }
      return selected.length;
    } finally { queue._taskQueue?.resolve(); }
  } finally { pending.delete(queue); }
}

/** Uses DisTube's actual flag; web desired-state requests are idempotent. */
export function updateRadio(queue: Queue, enabled?: boolean): boolean {
  return enabled === undefined || queue.autoplay !== enabled ? queue.toggleAutoplay() : queue.autoplay;
}
