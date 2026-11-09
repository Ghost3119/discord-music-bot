import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { publicMusicUrl, type HistoryEntry, type HistoryStorage } from '../../domain/persistence/history';

export function createJsonHistoryStorage(path: string): HistoryStorage {
  return {
    read() {
      if (!existsSync(path)) return [];
      if (statSync(path).size > 3_000_000) throw new Error('Historial demasiado grande');
      const input: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!Array.isArray(input)) throw new Error('Formato de historial inválido');
      const entries = input.slice(0, 2000).filter((e): e is HistoryEntry => Boolean(e && typeof e === 'object' &&
        /^[a-f0-9]{16}$/.test(e.id) && /^\d{15,22}$/.test(e.guildId) && typeof e.title === 'string' && e.title.length <= 200 &&
        typeof e.source === 'string' && e.source.length <= 60 && Number.isFinite(e.time) && e.time <= Date.now() &&
        ['completed', 'skipped', 'failed'].includes(e.result) && typeof e.code === 'string' && /^[A-Z0-9_]{0,64}$/.test(e.code) &&
        typeof e.reference === 'string' && /^[a-f0-9]{0,16}$/.test(e.reference) &&
        (!e.url || publicMusicUrl(e.url) === e.url) && ['youtube', 'soundcloud'].includes(e.searchSource) &&
        (!e.alternative || typeof e.alternative === 'string' && e.alternative.length <= 200)));
      return entries;
    },
    async write(entries) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.tmp`, JSON.stringify(entries), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    },
  };
}
