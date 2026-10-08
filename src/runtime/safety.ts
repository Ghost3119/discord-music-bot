/** EventEmitter does not await async listeners. Catch both throws and rejections here. */
export function guardedEvent<Args extends unknown[]>(
  context: string,
  handler: (...args: Args) => unknown,
): (...args: Args) => void {
  return (...args) => {
    try {
      void Promise.resolve(handler(...args)).catch((error: unknown) => {
        console.error(`[${context}]`, error);
      });
    } catch (error) {
      console.error(`[${context}]`, error);
    }
  };
}

export function installProcessHandlers(shutdown: (code: number) => void): () => void {
  let failed = false;
  const fatal = (error: unknown) => {
    console.error('[Fatal] Reiniciando el proceso para recuperar un estado limpio:', error);
    if (failed) return;
    failed = true;
    shutdown(1);
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);
  return () => {
    process.off('uncaughtException', fatal);
    process.off('unhandledRejection', fatal);
  };
}
