import { Client, Events, VoiceState } from 'discord.js';
import { DisTube, Events as MusicEvents, Queue } from 'distube';
import { guardedEvent } from '../runtime/safety';

/** DisTube 5 has no 'empty' event; observe actual Discord voice state changes. */
export function registerEmptyVoice(client: Client, distube: DisTube, timeoutMs = 60_000): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const clear = (guildId: string) => {
    const timer = timers.get(guildId);
    if (timer) clearTimeout(timer);
    timers.delete(guildId);
  };
  const onVoice = guardedEvent('Canal de voz vacío', (_oldState: VoiceState, state: VoiceState) => {
    const queue = distube.getQueue(state.guild.id);
    if (!queue) return;
    const channel = queue.voiceChannel;
    if (!channel || channel.members.some((member) => !member.user.bot)) {
      clear(queue.id);
      return;
    }
    if (timers.has(queue.id)) return;
    timers.set(queue.id, setTimeout(guardedEvent('Desconectar canal vacío', async () => {
      clear(queue.id);
      if (distube.getQueue(queue.id) !== queue || queue.voiceChannel?.members.some((member) => !member.user.bot)) return;
      await queue.stop();
      await queue.textChannel?.send('🔇 Canal vacío por 1 minuto — desconectando.');
    }), timeoutMs));
  });
  const onDelete = (queue: Queue) => clear(queue.id);
  client.on(Events.VoiceStateUpdate, onVoice);
  distube.on(MusicEvents.DELETE_QUEUE, onDelete);
  return () => {
    for (const guildId of timers.keys()) clear(guildId);
    client.off(Events.VoiceStateUpdate, onVoice);
    distube.off(MusicEvents.DELETE_QUEUE, onDelete);
  };
}
