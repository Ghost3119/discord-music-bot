import type { Client } from 'discord.js';
import type { HistoryStore } from '../music/history';
import { classifyMusicError } from '../music/errors';

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
    report: error => {

      console.error('[Web] Código de fallo de arranque:', classifyMusicError(error));
      console.error('[Web] Panel no disponible. Revisa la configuración WEB_* y la disponibilidad del puerto; el audio continúa.');
      if (process.connected) process.send?.({ type: 'webStartupFailed' }, () => {});
    },
    open: async () => {
      const [{ readWebConfig }, { createWebServer }, { createMusicBridge }, { openWebDatabase }, { createSqliteRepositories }] = await Promise.all([
        import('../web/config'), import('../web/server'), import('../music/webBridge'),
        import('../infrastructure/sqlite/database'), import('../infrastructure/sqlite/repositories'),
      ]);
      const config = readWebConfig();
      const bridge = createMusicBridge(client, history, {
        ...(config.accessMode ? { accessMode: config.accessMode } : {}),
        ...(config.allowedGuildIds?.length ? { allowedGuildIds: config.allowedGuildIds } : {}),
        ...(config.adminUserIds ? { adminUserIds: config.adminUserIds } : {}),
        ...(config.membershipCacheTtlMs !== undefined ? { membershipCacheTtlMs: config.membershipCacheTtlMs } : {}),
      });
      const repositories = createSqliteRepositories(openWebDatabase(config.databasePath));
      let app: Awaited<ReturnType<typeof createWebServer>> | undefined;
      try {
        app = await createWebServer({ config, bridge, repositories });
        await app.listen({ host: config.host, port: config.port });
        console.log(`[Web] Panel disponible en ${config.origin}`);
        if (process.connected) process.send?.({ type: 'webReady' }, () => {});
        const server = app;
        return { async close(): Promise<void> {
          try { await server.close(); }
          finally { await repositories.close(); }
        } };
      } catch (error) {
        try { await app?.close(); }
        finally { await repositories.close(); }
        throw error;
      }
    },
  });
}
