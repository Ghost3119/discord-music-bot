interface Logger { flush(timeout?: number): Promise<void>; close(): Promise<void>; restore(): void; }
const { installConsole } = require('../../scripts/logger.cjs') as { installConsole(options: { name: string; maxBytes: number; backups: number }): Logger };
export function installLogs(name: 'bot' | 'deploy' = 'bot'): Logger {
  const number = (key: string, fallback: number, maximum: number) => {
    const value = Number(process.env[key]);
    return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback;
  };
  return installConsole({ name, maxBytes: number('LOG_MAX_BYTES', 10 * 1024 * 1024, 100 * 1024 * 1024), backups: number('LOG_BACKUPS', 5, 20) });
}
