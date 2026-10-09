'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { inspect } = require('node:util');

function redact(value) {
  return String(value)
    .replace(/https?:\/\/[^\s<>"']+/gi, '[enlace oculto]')
    .replace(/\b(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[cabecera oculta]')
    .replace(/((?:token|secret|password|client_secret)\s*['"]?\s*[:=]\s*)(?:'[^']*'|"[^"]*"|[^\s,}]+)/gi, '$1[oculto]')
    .replace(/\b(?:Bot|Bearer)\s+[\w.\-/+=]{20,}/gi, '[credencial oculta]')
    .slice(0, 8_000);
}

function createLogger(options = {}) {
  const setting = (key, fallback, maximum) => { const value = Number(process.env[key]); return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback; };
  const directory = options.directory || path.resolve(__dirname, '../logs');
  const name = options.name || 'bot';
  const file = path.join(directory, `${name}.jsonl`);
  const maxBytes = options.maxBytes ?? setting('LOG_MAX_BYTES', 10 * 1024 * 1024, 100 * 1024 * 1024);
  const backups = options.backups ?? setting('LOG_BACKUPS', 5, 20);
  const maxPending = options.maxPending ?? 500;
  const report = options.report || console.error.bind(console);
  const queue = [];
  let running, bytes, retryAt = 0, closed = false, dropped = 0;
  async function drain() {
    try {
      await fs.mkdir(directory, { recursive: true });
      if (bytes === undefined) bytes = await fs.stat(file).then(s => s.size, e => { if (e.code === 'ENOENT') return 0; throw e; });
      while (queue.length) {
        const line = queue.shift();
        const size = Buffer.byteLength(line);
        if (bytes + size > maxBytes) {
          for (let i = backups; i >= 1; i--) {
            const source = i === 1 ? file : `${file}.${i - 1}`;
            await fs.rm(`${file}.${i}`, { force: true });
            await fs.rename(source, `${file}.${i}`).catch(e => { if (e.code !== 'ENOENT') throw e; });
          }
          bytes = 0;
        }
        await fs.appendFile(file, line, { mode: 0o600 });
        bytes += size;
      }
    } catch (error) {
      dropped += queue.length; queue.length = 0; bytes = undefined;
      retryAt = Date.now() + 60_000;
      report('[Logs] No se pudo escribir; continúa la salida por consola:', redact(error.message));
    } finally { running = undefined; }
  }
  function write(level, args) {
    if (closed || Date.now() < retryAt || queue.length >= maxPending) { dropped++; return; }
    const message = redact(args.map(value => typeof value === 'string' ? value : inspect(value, { depth: 3, maxArrayLength: 15, maxStringLength: 2000, getters: false })).join(' '));
    queue.push(JSON.stringify({ time: new Date().toISOString(), level, message }) + '\n');
    if (!running) running = drain();
  }
  async function flush(timeout = 750) {
    if (!running) return;
    let timer;
    await Promise.race([running, new Promise(resolve => { timer = setTimeout(resolve, timeout); timer.unref(); })]);
    clearTimeout(timer);
  }
  return { write, flush, close: async () => { closed = true; await flush(); }, stats: () => ({ pending: queue.length, dropped }) };
}

function installConsole(options) {
  const original = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(level => [level, console[level]]));
  const logger = createLogger({ ...options, report: original.error.bind(console) });
  for (const level of Object.keys(original)) console[level] = (...args) => {
    const safe = args.map(value => redact(typeof value === 'string' ? value : inspect(value, { depth: 3, maxArrayLength: 15, maxStringLength: 2000, getters: false })));
    original[level].apply(console, safe);
    logger.write(level, safe);
  };
  return { ...logger, restore: () => { Object.assign(console, original); } };
}
module.exports = { createLogger, installConsole, redact };
