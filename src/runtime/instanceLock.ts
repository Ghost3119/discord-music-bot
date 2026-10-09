import { createHash } from 'node:crypto';
import { createServer } from 'node:net';

export class InstanceLockError extends Error {
  constructor(readonly code: 'INSTANCE_ALREADY_RUNNING' | 'INSTANCE_LOCK_FAILED') {
    super(code === 'INSTANCE_ALREADY_RUNNING'
      ? 'Ya hay una instancia de este bot en el equipo. No se inició otra conexión a Discord.'
      : 'No se pudo reservar la instancia del bot; se canceló el inicio para evitar duplicados.');
    this.name = 'InstanceLockError';
  }
}

/** The OS releases the reservation even if the process crashes or is killed. */
export async function acquireInstanceLock(applicationId: string): Promise<() => Promise<void>> {
  if (!applicationId) throw new InstanceLockError('INSTANCE_LOCK_FAILED');
  const key = createHash('sha256').update(applicationId).digest('hex');
  const address = process.platform === 'win32'
    ? { path: `\\\\.\\pipe\\discord-music-bot-${key}` }
    : { host: '127.0.0.1', port: 30_000 + parseInt(key.slice(0, 8), 16) % 30_000 };
  // This is only an OS reservation, never a control or diagnostic endpoint.
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    const failed = (error: NodeJS.ErrnoException) => reject(new InstanceLockError(
      error.code === 'EADDRINUSE' ? 'INSTANCE_ALREADY_RUNNING' : 'INSTANCE_LOCK_FAILED'));
    server.once('error', failed);
    server.listen({ ...address, exclusive: true }, () => {
      server.off('error', failed);
      server.on('error', error => console.error('[Instancia] Error de reserva:', error.message));
      resolve();
    });
  });
  let closing: Promise<void> | undefined;
  return () => closing ??= new Promise<void>(resolve => server.close(() => resolve()));
}
