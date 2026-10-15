import type { Client } from 'discord.js';
import type { HistoryStore } from '../music/history';

interface Closeable { close(): Promise<unknown> }
interface LifecycleOptions {
  enabled: () => boolean;
  open: () => Promise<Closeable>;
  report: (error: unknown) => void;
}

/** A web startup/listen failure must not take down audio or leak a late server. */
export function createWebLifecycle(options: LifecycleOptions): { start(): Promise<void>; stop(): Promise<void> } {
  let opening: Promise<void> | undefined;
  let server: Closeable | undefined;
  let stopped = false;
  const close = async (): Promise<void> => {
    const current = server;
    server = undefined;
    if (current) await current.close().catch(options.report);
  };
  return {
    start(): Promise<void> {
      if (stopped || !options.enabled()) return Promise.resolve();
      opening ??= (async () => {
        try {
          server = await options.open();
          if (stopped) await close();
        } catch (error) { options.report(error); }
      })();
      return opening;
    },
    async stop(): Promise<void> {
      stopped = true;
      await opening;
      await close();
    },
  };
}

export function createWebDashboard(client: Client, history: HistoryStore): ReturnType<typeof createWebLifecycle> {
  return createWebLifecycle({
    enabled: () => process.env['WEB_ENABLED'] === 'true',
    report: () => console.error('[Web] Panel no disponible. Revisa la configuración WEB_* y la disponibilidad del puerto; el audio continúa.'),
    open: async () => {
      const [{ readWebConfig }, { createWebServer }, { createMusicBridge }] = await Promise.all([
        import('../web/config'), import('../web/server'), import('../music/webBridge'),
      ]);
      const config = readWebConfig();
      const app = await createWebServer({ config, bridge: createMusicBridge(client, history) });
      try {
        await app.listen({ host: config.host, port: config.port });
        console.log(`[Web] Panel disponible en ${config.origin}`);
        return app;
      } catch (error) {
        await app.close();
        throw error;
      }
    },
  });
}
