import { DisTube, Queue } from 'distube';
const checkpoints = new WeakMap<DisTube, (queue: Queue) => void>();
export function registerCheckpoint(distube: DisTube, capture: (queue: Queue) => void): () => void {
  checkpoints.set(distube, capture);
  return () => { if (checkpoints.get(distube) === capture) checkpoints.delete(distube); };
}
export function checkpointQueue(distube: DisTube, queue: Queue): void { checkpoints.get(distube)?.(queue); }
