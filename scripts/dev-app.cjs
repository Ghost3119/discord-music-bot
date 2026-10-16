'use strict';
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

function createDevEnvironment(env) {
  const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'WEB_CLIENT_SECRET', 'WEB_ALLOWED_USER_IDS'];
  const missingKeys = required.filter(key => !env[key]?.trim());
  if (missingKeys.length) throw Object.assign(new Error(`Completa estas variables en .env: ${missingKeys.join(', ')}`), { code: 'CONFIG_REQUIRED', missingKeys });
  const backendPort = Number(env.WEB_PORT || '8080');
  const frontendPort = Number(env.WEB_DEV_PORT || '5173');
  for (const [name, value] of [['WEB_PORT', backendPort], ['WEB_DEV_PORT', frontendPort]]) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} debe ser un puerto entre 1 y 65535.`);
  }
  if (backendPort === frontendPort) throw new Error('WEB_PORT y WEB_DEV_PORT deben ser diferentes.');
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const redirectUri = `${frontendUrl}/auth/discord/callback`;
  const backendEnv = { ...env, WEB_ENABLED: 'true', WEB_HOST: '127.0.0.1', WEB_PORT: String(backendPort), WEB_ORIGIN: frontendUrl, WEB_REDIRECT_URI: redirectUri };
  // Vite receives OS necessities and its proxy target, never bot/OAuth credentials.
  const systemKeys = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM', 'FORCE_COLOR', 'NO_COLOR']);
  const frontendEnv = Object.fromEntries(Object.entries(env).filter(([key]) => systemKeys.has(key.toUpperCase())));
  Object.assign(frontendEnv, { NODE_ENV: 'development', SONORA_BACKEND_URL: backendUrl });
  return { backendEnv, frontendEnv, backendUrl, frontendUrl, redirectUri, backendPort, frontendPort };
}

function assertPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`El puerto ${port} está ocupado o no está disponible. Cierra la terminal anterior de esa app y vuelve a ejecutar npm run dev.`)));
    server.listen({ port, host, exclusive: true }, () => server.close(error => error ? reject(error) : resolve()));
  });
}

/** Offline-testable process coordination. The existing supervisor still owns the bot. */
function startDevProcesses(options) {
  const report = options.report || (() => {});
  const abort = new AbortController();
  let backend;
  let frontend;
  let backendExited = false;
  let backendStopped = false;
  let frontendExited = true;
  let stopping = false;
  let startingFrontend = false;
  let result = 0;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const complete = () => { if (stopping && backendExited && frontendExited) resolveDone(result); };
  const stopBackend = () => {
    if (backend && !backendStopped && !backendExited) { backendStopped = true; backend.stop(); }
  };
  function stop(code = 0) {
    if (stopping) return;
    stopping = true; result = code;
    clearTimeout(startupTimer);
    abort.abort();
    if (frontend && !frontendExited) frontend.kill('SIGTERM');
    stopBackend();
    complete();
  }
  const startupTimer = setTimeout(() => {
    report('El backend o la vista no terminaron de arrancar. Revisa la conexión a Discord y los mensajes anteriores.');
    stop(1);
  }, options.startupTimeoutMs ?? 45_000);
  async function startFrontend() {
    if (stopping || startingFrontend) return;
    startingFrontend = true;
    try {
      frontend = options.launchFrontend();
      frontendExited = false;
      frontend.once('error', () => {
        // A failed spawn also emits close; no credentials or raw subprocess error are logged.
        report('No se pudo iniciar la vista.'); stop(1);
      });
      frontend.once('close', () => {
        frontendExited = true;
        if (!stopping) { report('La vista terminó; cerrando también el bot y el backend.'); stop(1); }
        complete();
      });
      await options.waitForFrontend(options.frontendUrl, { signal: abort.signal });
      if (!stopping) { clearTimeout(startupTimer); options.onReady?.(); }
    } catch {
      if (!stopping) { report('No se pudo preparar la vista; cerrando la aplicación.'); stop(1); }
    }
  }
  try {
    backend = options.launchBackend({
      onMessage(message) {
        if (message?.type === 'webReady') void startFrontend();
        if (message?.type === 'webStartupFailed') { report('El servidor web no pudo arrancar. Revisa la configuración y el puerto del backend.'); stop(1); }
      },
      onExit(code) {
        backendExited = true;
        if (!stopping) { report('El bot y el backend terminaron; cerrando la vista.'); stop(code || 1); }
        complete();
      },
    });
    if (stopping) stopBackend();
  } catch {
    backendExited = true;
    report('No se pudo iniciar el supervisor del bot.'); stop(1);
  }
  return { stop, done };
}

function runNode(root, args, signal, description) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32' });
    const abort = () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === 'win32') {
        // Only the subprocess created here and its descendants are terminated.
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => child.kill('SIGTERM'));
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    const cleanup = () => signal.removeEventListener('abort', abort);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => {
      cleanup();
      if (signal.aborted) { reject(signal.reason); return; }
      code === 0 ? resolve() : reject(new Error(`Falló ${description}. Corrige el error mostrado antes de arrancar.`));
    });
  });
}

function runNpm(root, args, signal) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !fs.existsSync(npmCli)) return Promise.reject(new Error('Inicia la aplicación con npm run dev.'));
  return runNode(root, [npmCli, ...args], signal, `npm ${args.join(' ')}`);
}

async function ensureDependencies(root, signal, install = true) {
  for (const directory of [root, path.join(root, 'frontend')]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    if (names.some(name => !fs.existsSync(path.join(directory, 'node_modules', name, 'package.json')))) {
      if (!install) throw new Error(`Faltan dependencias ${directory === root ? 'del backend' : 'de la vista'}. npm run dev las instalará automáticamente.`);
      console.log(`[App] Instalando dependencias ${directory === root ? 'del backend' : 'de la vista'}…`);
      await runNpm(root, directory === root ? ['ci'] : ['--prefix', 'frontend', 'ci'], signal);
    }
  }
}

async function waitForFrontend(url, { signal }) {
  const deadline = Date.now() + 15_000;
  while (!signal.aborted && Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { signal.throwIfAborted(); }
    await delay(150, undefined, { signal });
  }
  throw new Error('La vista no respondió a tiempo.');
}

async function main() {
  const root = path.resolve(__dirname, '..');
  process.chdir(root);
  const preparation = new AbortController();
  let app;
  const stop = () => { preparation.abort(); app?.stop(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  process.once('disconnect', stop);
  const onMessage = message => { if (message?.type === 'shutdown') stop(); };
  process.on('message', onMessage);
  try {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 22 || major === 22 && minor < 12) throw new Error('La aplicación requiere Node.js 22.12 o superior.');
    try { process.loadEnvFile(path.join(root, '.env')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('No se pudo leer .env. Revisa su formato y permisos.'); }
    const configuration = createDevEnvironment(process.env);
    await ensureDependencies(root, preparation.signal, !process.argv.includes('--check'));
    // Reuse the canonical TypeScript validator before any bot login or port binding.
    require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
    require(path.join(root, 'src/web/config.ts')).readWebConfig(configuration.backendEnv);
    await Promise.all([assertPortAvailable(configuration.backendPort), assertPortAvailable(configuration.frontendPort)]);
    if (process.argv.includes('--check')) {
      console.log('[App] Configuración, dependencias y puertos correctos. No se inició el bot.');
      console.log(`[App] Vista: ${configuration.frontendUrl}`);
      console.log(`[App] Redirect OAuth requerido: ${configuration.redirectUri}`);
      return;
    }
    console.log(`[App] Redirect OAuth que debes registrar en Discord: ${configuration.redirectUri}`);
    console.log('[App] Compilando backend…');
    await runNode(root, [path.join(root, 'node_modules/typescript/bin/tsc')], preparation.signal, 'la compilación del backend');
    preparation.signal.throwIfAborted();
    const logs = require('./logger.cjs').installConsole({ name: 'supervisor' });
    process.once('beforeExit', () => { void logs.close(); });
    app = startDevProcesses({
      ...configuration,
      report: message => console.error(`[App] ${message}`),
      launchBackend: callbacks => require('./supervise.cjs').supervise({ ...callbacks, env: configuration.backendEnv }),
      launchFrontend: () => spawn(process.execPath, [path.join(root, 'frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(configuration.frontendPort), '--strictPort'], {
        cwd: path.join(root, 'frontend'), env: configuration.frontendEnv, stdio: 'inherit', windowsHide: true,
      }),
      waitForFrontend,
      onReady: () => console.log(`\n[App] Toda la aplicación está lista: ${configuration.frontendUrl}\n[App] Bot + API + vista. Ctrl+C cierra todo.\n`),
    });
    if (preparation.signal.aborted) app.stop();
    process.exitCode = await app.done;
  } catch (error) {
    if (preparation.signal.aborted) { process.exitCode = 0; return; }
    console.error(`[App] ${error.message}`);
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop); process.off('disconnect', stop); process.off('message', onMessage);
  }
}

module.exports = { createDevEnvironment, assertPortAvailable, startDevProcesses };
if (require.main === module) void main();
