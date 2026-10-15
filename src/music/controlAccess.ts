import { AsyncLocalStorage } from 'node:async_hooks';
import { DisTube, Queue } from 'distube';

export const controlError = (errorCode: string, message: string) => Object.assign(new Error(message), { errorCode });
interface Access { active: boolean; check: (queue?: Queue) => Promise<void> | void; created?: (queue: Queue) => void; }
const access = new AsyncLocalStorage<Access>();
const guardedQueues = new WeakSet<Queue>();
const guardedResolvers = new WeakSet<DisTube>();
const creatingGuilds = new WeakMap<DisTube, Set<string>>();
export function musicSessionIsCreating(distube: DisTube, guildId: string): boolean { return creatingGuilds.get(distube)?.has(guildId) ?? false; }
const sessionVersions = new WeakMap<DisTube, Map<string, number>>();
export function musicSessionVersion(distube: DisTube, guildId: string): number { return sessionVersions.get(distube)?.get(guildId) ?? 0; }
export function musicSessionChanged(distube: DisTube, guildId: string): void {
  let versions = sessionVersions.get(distube);
  if (!versions) { versions = new Map(); sessionVersions.set(distube, versions); }
  versions.set(guildId, musicSessionVersion(distube, guildId) + 1);
}
/** Background recovery and event observers must never inherit a user's authorization scope. */
export function withoutMusicAccess<T>(operation: () => T): T { return access.exit(operation); }

/** Revalidate inside DisTube's own lock, without acquiring a second lock around native operations. */
export function installQueueControlGuard(queue: Queue): void {
  if (guardedQueues.has(queue) || !queue._taskQueue) return;
  guardedQueues.add(queue);
  const remove = queue.remove;
  if (typeof remove === 'function') queue.remove = () => {
    const current = queue.distube?.getQueue(queue.id);
    // Native play-finally removes by guild ID. A late old request must never delete its successor.
    if (current && current !== queue) return;
    remove.call(queue);
  };
  const tasks = queue._taskQueue, queuing = tasks.queuing;
  tasks.queuing = async (...args) => {
    const context = access.getStore();
    await queuing.apply(tasks, args);
    try { if (context?.active) await context.check(queue); }
    catch (error) { tasks.resolve(); throw error; }
  };
}

/** URL extraction also awaits while holding the native lock; check again before the resolved item is enqueued. */
export function installResolverControlGuard(distube: DisTube): void {
  if (guardedResolvers.has(distube) || !distube.handler?.resolve) return;
  guardedResolvers.add(distube);
  const resolve = distube.handler.resolve;
  distube.handler.resolve = (async (...args: Parameters<typeof resolve>) => {
    const context = access.getStore();
    const result = await resolve.apply(distube.handler, args);
    if (context?.active) await context.check();
    return result;
  }) as typeof resolve;
  // Native autoplay skip awaits a provider while already holding the queue lock.
  // Revalidate before the provider result can reach _addRelatedSong's synchronous enqueue/splice.
  for (const plugin of distube.plugins) {
    const related = plugin.getRelatedSongs;
    if (typeof related !== 'function') continue;
    plugin.getRelatedSongs = async (...args) => {
      const context = access.getStore();
      const result = await related.apply(plugin, args);
      if (context?.active) await context.check();
      return result;
    };
  }
  const create = distube.queues?.create;
  if (create) {
    const creating = new Set<string>();
    creatingGuilds.set(distube, creating);
    distube.queues.create = async (...args) => {
      const guildId = args[0].guildId, context = access.getStore();
      if (creating.has(guildId)) throw controlError('SESSION_CHANGED', 'Otra solicitud está creando una sesión de música.');
      creating.add(guildId);
      try {
        if (context?.active) await context.check();
        const queue = await create.apply(distube.queues, args);
        installQueueControlGuard(queue);
        if (context?.active) context.created?.(queue);
        return queue;
      } finally { creating.delete(guildId); }
    };
  }
}

export async function withMusicAccess<T>(distube: DisTube, check: Access['check'], operation: () => Promise<T>, created?: Access['created']): Promise<T> {
  installResolverControlGuard(distube);
  const context: Access = { active: true, check, ...(created ? { created } : {}) };
  await check();
  return access.run(context, async () => {
    try { return await operation(); }
    finally { context.active = false; }
  });
}
