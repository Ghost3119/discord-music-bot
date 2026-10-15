export class AbandonedOperation extends Error {
  constructor() { super('La sesión cambió durante la operación.'); this.name = 'AbandonedOperation'; }
}

/** Logout invalidates ongoing continuations without waiting for extraction or playlist loading. */
export function createOperationScope() {
  let generation = 0;
  return {
    invalidate() { generation++; },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const expected = generation;
      let value: T;
      try { value = await operation(); }
      catch (error) { if (generation !== expected) throw new AbandonedOperation(); throw error; }
      if (generation !== expected) throw new AbandonedOperation();
      return value;
    },
  };
}
