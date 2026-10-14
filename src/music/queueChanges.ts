import { DisTube, Queue } from 'distube';
const checkpoints = new WeakMap<DisTube, (queue: Queue) => void>();
const observers = new WeakMap<DisTube, Set<(queue: Queue) => void>>();
export function observeQueueChanges(distube: DisTube, listener: (queue: Queue) => void): () => void {
  let listeners = observers.get(distube);
  if (!listeners) { listeners = new Set(); observers.set(distube, listeners); }
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) observers.delete(distube); };
}
export function registerCheckpoint(distube: DisTube, capture: (queue: Queue) => void): () => void {
  checkpoints.set(distube, capture);
  return () => { if (checkpoints.get(distube) === capture) checkpoints.delete(distube); };
}
export function checkpointQueue(distube: DisTube, queue: Queue): void {
  checkpoints.get(distube)?.(queue);
  for (const listener of observers.get(distube) ?? []) listener(queue);
}
