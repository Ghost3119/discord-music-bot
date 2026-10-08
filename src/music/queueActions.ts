import { DisTube, Queue } from 'distube';
import { getPlayerPanels } from './playerPanel';
import { checkpointQueue } from './queueChanges';
import { markQueueEdited } from './playbackState';

export type QueueAction = { type: 'shuffle' | 'clear' } | { type: 'remove'; position: number } | { type: 'move'; from: number; to: number };
const actionError = (errorCode: string, message: string) => Object.assign(new Error(message), { errorCode });
export async function editQueue(distube: DisTube, queue: Queue, action: QueueAction, authorized: () => boolean = () => true): Promise<string> {
  await queue._taskQueue.queuing();
  let result: string;
  try {
    if (queue.stopped || distube.getQueue(queue.id) !== queue) throw actionError('SESSION_CHANGED', 'La sesión terminó mientras esperaba.');
    if (!authorized()) throw actionError('CONTROL_CHANNEL_REQUIRED', 'Debes seguir en el canal de voz del bot.');
    const valid = (position: number) => Number.isInteger(position) && position >= 1 && position < queue.songs.length;
    switch (action.type) {
      case 'clear': {
        const count = queue.songs.splice(1).length;
        result = `🧹 Retiradas ${count} canciones pendientes. La canción actual continúa${queue.autoplay ? '; la radio sigue activada' : ''}.`;
        break;
      }
      case 'remove': {
        if (!valid(action.position)) throw actionError('INVALID_QUEUE_POSITION', 'Posición no válida; la primera canción pendiente es la 1.');
        const [song] = queue.songs.splice(action.position, 1);
        result = `🗑️ Retirada de la cola: ${(song?.name ?? 'Canción sin título').slice(0, 160)}`;
        break;
      }
      case 'move': {
        if (!valid(action.from) || !valid(action.to)) throw actionError('INVALID_QUEUE_POSITION', 'Posiciones no válidas; solo puedes mover canciones pendientes.');
        const [song] = queue.songs.splice(action.from, 1);
        queue.songs.splice(action.to, 0, song!);
        result = `↕️ Movida de la posición ${action.from} a la ${action.to}: ${(song?.name ?? 'Canción sin título').slice(0, 160)}`;
        break;
      }
      case 'shuffle':
        for (let i = queue.songs.length - 1; i > 1; i--) {
          const j = 1 + Math.floor(Math.random() * i);
          [queue.songs[i], queue.songs[j]] = [queue.songs[j]!, queue.songs[i]!];
        }
        result = '🔀 Canciones pendientes mezcladas.';
        break;
    }
    markQueueEdited(queue); checkpointQueue(distube, queue);
  } finally { queue._taskQueue.resolve(); }
  await getPlayerPanels(distube)?.refresh(queue);
  return result;
}
