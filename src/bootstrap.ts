import 'dotenv/config';
import { guardedEvent, installProcessHandlers } from './runtime/safety';
import { installLogs } from './runtime/logger';
const logs = installLogs();

let stopBot: (() => Promise<void>) | undefined;
let stopping = false;
function shutdown(code: number): void {
  if (stopping) {
    if (code !== 0) process.exit(code);
    return;
  }
  stopping = true;
  // Shutdown cannot wait indefinitely for Discord or another dependency.
  setTimeout(() => process.exit(code), 5_000).unref();
  void Promise.resolve().then(() => stopBot?.()).catch(error => console.error('Error durante el cierre:', error))
    .finally(() => { void logs.close().finally(() => process.exit(code)); });
}

installProcessHandlers(shutdown);
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('disconnect', () => shutdown(0));
process.on('message', (message: unknown) => {
  if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'shutdown') shutdown(0);
});

// IPC callbacks absorb parent disconnects; a failed heartbeat is not a bot failure.
const heartbeat = setInterval(() => {
  if (process.connected) process.send?.({ type: 'heartbeat' }, () => {});
}, 10_000);
heartbeat.unref();

void import('./index').then(({ client, queueRecovery, startBot, stopEmptyVoice, stopPlayerPanels, history }) => {
  stopBot = async () => {
    stopEmptyVoice();
    stopPlayerPanels();
    queueRecovery.stop();
    await Promise.allSettled([history.flush(), client.destroy()]);
  };
  return startBot();
}).catch(guardedEvent('Inicio del bot', (error: unknown) => {
  console.error(error);
  // Configuration failures should be fixed, rather than retried forever.
  const message = error instanceof Error ? error.message : String(error);
  shutdown(/Variable de entorno requerida|invalid token|TokenInvalid|disallowed intents/i.test(message) ? 78 : 1);
}));
