const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter, once } = require('node:events');
const { fork, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createDevEnvironment, assertPortAvailable, startDevProcesses } = require('../scripts/dev-app.cjs');

function environment(overrides = {}) {
  return {
    DISCORD_TOKEN: 'fixture-token-never-used', CLIENT_ID: '555555555555555555',
    GUILD_ID: '333333333333333333', WEB_CLIENT_SECRET: 'fixture-oauth-secret-never-used',
    WEB_ALLOWED_USER_IDS: '111111111111111111', ...overrides,
  };
}
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function processes(t, overrides = {}) {
  const calls = [];
  let backend;
  let frontend;
  const controller = startDevProcesses({
    backendEnv: {}, frontendEnv: {}, frontendUrl: 'http://127.0.0.1:5173',
    startupTimeoutMs: 2000, report: message => calls.push(['report', message]),
    launchBackend(callbacks) {
      calls.push(['backend-start']);
      backend = { ...callbacks, stops: 0 };
      return { stop() { backend.stops++; calls.push(['backend-stop']); callbacks.onExit(0); } };
    },
    launchFrontend() {
      calls.push(['frontend-start']);
      frontend = new EventEmitter();
      frontend.exitCode = null;
      frontend.signalCode = null;
      frontend.kills = [];
      frontend.kill = signal => {
        frontend.kills.push(signal);
        calls.push(['frontend-stop']);
        setImmediate(() => {
          frontend.signalCode = signal || 'SIGTERM';
          frontend.emit('close', null, frontend.signalCode);
        });
        return true;
      };
      return frontend;
    },
    waitForFrontend: async () => {},
    ...overrides,
  });
  t.after(async () => { controller.stop(); await controller.done; });
  return { controller, calls, get backend() { return backend; }, get frontend() { return frontend; } };
}

test('dev creates one local origin and keeps credentials out of the Vite environment', () => {
  const source = environment({
    WEB_ENABLED: 'false', WEB_HOST: '0.0.0.0', WEB_ORIGIN: 'https://previous.example',
    WEB_REDIRECT_URI: 'https://previous.example/auth/discord/callback',
    SPOTIFY_CLIENT_SECRET: 'fixture-spotify-secret', PATH: 'fixture-executable-path',
  });
  const before = { ...source };
  const result = createDevEnvironment(source);
  assert.deepEqual(source, before, 'preparing development must not modify the caller environment');
  assert.equal(result.backendPort, 8080);
  assert.equal(result.frontendPort, 5173);
  assert.equal(result.backendUrl, 'http://127.0.0.1:8080');
  assert.equal(result.frontendUrl, 'http://127.0.0.1:5173');
  assert.equal(result.redirectUri, `${result.frontendUrl}/auth/discord/callback`);
  assert.equal(result.backendEnv.WEB_ENABLED, 'true');
  assert.equal(result.backendEnv.WEB_HOST, '127.0.0.1');
  assert.equal(result.backendEnv.WEB_ORIGIN, result.frontendUrl);
  assert.equal(result.backendEnv.WEB_REDIRECT_URI, result.redirectUri);
  assert.equal(result.backendEnv.DISCORD_TOKEN, source.DISCORD_TOKEN);
  assert.equal(result.frontendEnv.SONORA_BACKEND_URL, result.backendUrl);
  assert.equal(result.frontendEnv.PATH, source.PATH);
  for (const key of ['DISCORD_TOKEN', 'WEB_CLIENT_SECRET', 'SPOTIFY_CLIENT_SECRET']) {
    assert.equal(Object.hasOwn(result.frontendEnv, key), false, `${key} must stay in the backend`);
    assert.ok(!JSON.stringify(result.frontendEnv).includes(source[key]));
  }
});

test('custom development ports agree with the backend proxy and OAuth callback', () => {
  const result = createDevEnvironment(environment({ WEB_PORT: '8181', WEB_DEV_PORT: '5273' }));
  assert.equal(result.backendPort, 8181);
  assert.equal(result.frontendPort, 5273);
  assert.equal(result.backendUrl, 'http://127.0.0.1:8181');
  assert.equal(result.frontendUrl, 'http://127.0.0.1:5273');
  assert.equal(result.backendEnv.WEB_ORIGIN, result.frontendUrl);
  assert.equal(result.backendEnv.WEB_REDIRECT_URI, `${result.frontendUrl}/auth/discord/callback`);
  assert.equal(result.frontendEnv.SONORA_BACKEND_URL, result.backendUrl);
});

test('invalid or shared development ports fail before any process can be launched', () => {
  for (const value of ['0', '65536', '8080.5', 'not-a-port']) {
    assert.throws(() => createDevEnvironment(environment({ WEB_PORT: value })), /WEB_PORT/);
    assert.throws(() => createDevEnvironment(environment({ WEB_DEV_PORT: value })), /WEB_DEV_PORT/);
  }
  assert.throws(() => createDevEnvironment(environment({ WEB_PORT: '5173' })), /WEB_PORT.*WEB_DEV_PORT/);
});

test('missing configuration reports variable names without exposing provided credentials', () => {
  const keys = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'WEB_CLIENT_SECRET', 'WEB_ALLOWED_USER_IDS'];
  assert.throws(() => createDevEnvironment({}), error => {
    assert.equal(error.code, 'CONFIG_REQUIRED');
    assert.deepEqual([...error.missingKeys].sort(), [...keys].sort());
    return true;
  });
  assert.throws(() => createDevEnvironment(environment({ WEB_CLIENT_SECRET: '' })), error => {
    assert.deepEqual(error.missingKeys, ['WEB_CLIENT_SECRET']);
    assert.doesNotMatch(error.message, /fixture-token-never-used/);
    return true;
  });
  assert.throws(() => createDevEnvironment(environment({ WEB_ACCESS_MODE: 'guild_members', WEB_ALLOWED_USER_IDS: '' })), error => {
    assert.deepEqual(error.missingKeys, ['WEB_ALLOWED_GUILD_IDS']);
    return true;
  });
  const guildMode = createDevEnvironment(environment({ WEB_ACCESS_MODE: 'guild_members', WEB_ALLOWED_USER_IDS: '', WEB_ALLOWED_GUILD_IDS: '333333333333333333' }));
  assert.equal(guildMode.backendEnv.WEB_ACCESS_MODE, 'guild_members');
  assert.equal(guildMode.backendEnv.WEB_ALLOWED_GUILD_IDS, '333333333333333333');
});

test('port preflight refuses an occupied port without closing the existing server', async t => {
  const server = net.createServer(socket => socket.end('existing-service'));
  t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await assert.rejects(assertPortAvailable(port), error => {
    assert.match(error.message, new RegExp(String(port)));
    return true;
  });
  const socket = net.connect(port, '127.0.0.1');
  const chunks = [];
  socket.on('data', chunk => chunks.push(chunk));
  await once(socket, 'end');
  assert.equal(Buffer.concat(chunks).toString(), 'existing-service');
});

test('frontend starts only after backend readiness and announces readiness after HTTP is reachable', async t => {
  const httpReady = deferred();
  const ready = deferred();
  const p = processes(t, { waitForFrontend: () => httpReady.promise, onReady: () => ready.resolve() });
  assert.equal(p.calls.filter(([name]) => name === 'frontend-start').length, 0);
  p.backend.onMessage({ type: 'heartbeat' });
  await turn();
  assert.equal(p.frontend, undefined);
  p.backend.onMessage({ type: 'webReady' });
  p.backend.onMessage({ type: 'webReady' });
  await turn();
  assert.equal(p.calls.filter(([name]) => name === 'frontend-start').length, 1);
  httpReady.resolve();
  await ready.promise;
  p.controller.stop();
  p.controller.stop();
  assert.equal(await p.controller.done, 0);
  assert.equal(p.backend.stops, 1);
  assert.equal(p.frontend.kills.length, 1);
});

for (const code of [78, 79]) {
  test(`backend exit ${code} preserves the diagnostic status and never starts Vite`, async t => {
    const p = processes(t);
    p.backend.onExit(code);
    assert.equal(await p.controller.done, code);
    assert.equal(p.frontend, undefined);
  });
}

test('a dashboard startup failure ends the launcher without leaving the bot running', async t => {
  const p = processes(t);
  p.backend.onMessage({ type: 'webStartupFailed' });
  assert.equal(await p.controller.done, 1);
  assert.equal(p.backend.stops, 1);
  assert.equal(p.frontend, undefined);
});

test('a backend startup timeout stops the backend and never opens a disconnected frontend', async t => {
  const p = processes(t, { startupTimeoutMs: 100 });
  assert.equal(await p.controller.done, 1);
  assert.equal(p.backend.stops, 1);
  assert.equal(p.frontend, undefined);
});

test('frontend launch errors stop the backend and terminate the launcher', async t => {
  const p = processes(t);
  p.backend.onMessage({ type: 'webReady' });
  await turn();
  p.frontend.emit('error', new Error('frontend fixture launch failed'));
  assert.equal(await p.controller.done, 1);
  assert.equal(p.backend.stops, 1);
});

test('a failed frontend HTTP readiness check closes both processes', async t => {
  const p = processes(t, { waitForFrontend: async () => { throw new Error('fixture readiness failed'); } });
  p.backend.onMessage({ type: 'webReady' });
  assert.equal(await p.controller.done, 1);
  assert.equal(p.backend.stops, 1);
  assert.equal(p.frontend.kills.length, 1);
});

test('an unexpected frontend exit stops the backend instead of leaving a partial app', async t => {
  const p = processes(t);
  p.backend.onMessage({ type: 'webReady' });
  await turn();
  p.frontend.exitCode = 1;
  p.frontend.emit('close', 1, null);
  assert.equal(await p.controller.done, 1);
  assert.equal(p.backend.stops, 1);
});

test('a backend failure after readiness closes the frontend and preserves its exit code', async t => {
  const p = processes(t);
  p.backend.onMessage({ type: 'webReady' });
  await turn();
  p.backend.onExit(78);
  assert.equal(await p.controller.done, 78);
  assert.equal(p.frontend.kills.length, 1);
});

test('intentional shutdown aborts a pending frontend readiness check', async t => {
  let signal;
  const p = processes(t, {
    waitForFrontend: (_url, options) => new Promise((resolve, reject) => {
      signal = options.signal;
      signal.addEventListener('abort', () => reject(new Error('readiness aborted')), { once: true });
    }),
  });
  p.backend.onMessage({ type: 'webReady' });
  await turn();
  assert.ok(signal);
  p.controller.stop();
  assert.equal(await p.controller.done, 0);
  assert.equal(signal.aborted, true);
  assert.equal(p.backend.stops, 1);
  assert.equal(p.frontend.kills.length, 1);
});

test('launcher shutdown closes a real local frontend process and releases its HTTP port', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'music-dev-app-test-'));
  const filename = path.join(directory, 'frontend.cjs');
  writeFileSync(filename, `
    const server = require('node:http').createServer((_request, response) => response.end('frontend-fixture'));
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  `);
  let child;
  let closed;
  let port;
  const ready = deferred();
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (closed) await closed;
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const p = processes(t, {
    launchFrontend() {
      child = fork(filename, [], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      closed = once(child, 'close');
      return child;
    },
    async waitForFrontend() {
      const [message] = await once(child, 'message');
      port = message.port;
      const response = await fetch(`http://127.0.0.1:${port}`);
      assert.equal(await response.text(), 'frontend-fixture');
    },
    onReady: () => ready.resolve(),
  });
  p.backend.onMessage({ type: 'webReady' });
  await ready.promise;
  p.controller.stop();
  assert.equal(await p.controller.done, 0);
  await closed;
  assert.equal(p.backend.stops, 1);
  await assertPortAvailable(port);
});

test('launcher and real supervisor start and close the whole offline app without restarting or leaking backend env', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'music-dev-supervisor-test-'));
  const backendFile = path.join(directory, 'backend.cjs');
  const frontendFile = path.join(directory, 'frontend.cjs');
  const runnerFile = path.join(directory, 'runner.cjs');
  const stateFile = path.join(directory, 'backend-state.json');
  const supervisor = require.resolve('../scripts/supervise.cjs');
  const launcher = require.resolve('../scripts/dev-app.cjs');
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    rmSync(directory, { recursive: true, force: true });
  });
  writeFileSync(backendFile, `
    const fs = require('node:fs');
    const stateFile = ${JSON.stringify(stateFile)};
    const previous = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')).starts : 0;
    fs.writeFileSync(stateFile, JSON.stringify({ starts: previous + 1, sentinel: process.env.DEV_SENTINEL }));
    console.log('OFFLINE_BACKEND_STARTED');
    process.on('message', message => {
      if (message.type === 'shutdown') { console.log('OFFLINE_BACKEND_SHUTDOWN'); process.exit(0); }
    });
    process.on('disconnect', () => process.exit(0));
    process.send({ type: 'webReady' });
    setInterval(() => process.send({ type: 'heartbeat' }, () => {}), 20);
  `);
  writeFileSync(frontendFile, `
    const server = require('node:http').createServer((_request, response) => response.end('offline-complete-app'));
    process.on('disconnect', () => process.exit(0));
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port, sentinel: process.env.DEV_SENTINEL || null }));
  `);
  writeFileSync(runnerFile, `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const { fork } = require('node:child_process');
    const { once } = require('node:events');
    const { supervise } = require(${JSON.stringify(supervisor)});
    const { createDevEnvironment, startDevProcesses, assertPortAvailable } = require(${JSON.stringify(launcher)});
    const configuration = createDevEnvironment({ ...process.env, ${Object.entries(environment({ DEV_SENTINEL: 'backend-only' })).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(', ')} });
    let frontend;
    let frontendStarted;
    let frontendClosed = false;
    let backendClosed = false;
    let port;
    let controller;
    async function run() {
      controller = startDevProcesses({
        ...configuration,
        startupTimeoutMs: 5000,
        launchBackend(callbacks) {
          return supervise({
            entry: ${JSON.stringify(backendFile)}, env: configuration.backendEnv,
            minimumDelay: 20, maximumDelay: 50, heartbeatTimeout: 1000,
            onMessage: callbacks.onMessage,
            onExit(code) { backendClosed = true; callbacks.onExit(code); },
          });
        },
        launchFrontend() {
          frontend = fork(${JSON.stringify(frontendFile)}, [], {
            env: configuration.frontendEnv, windowsHide: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
          });
          frontendStarted = once(frontend, 'message');
          frontend.once('close', () => { frontendClosed = true; });
          return frontend;
        },
        async waitForFrontend(_url, { signal }) {
          const [message] = await frontendStarted;
          assert.equal(message.sentinel, null);
          port = message.port;
          const response = await fetch('http://127.0.0.1:' + port, { signal });
          assert.equal(await response.text(), 'offline-complete-app');
        },
        report: message => console.error(message),
        onReady: () => controller.stop(),
      });
      const code = await controller.done;
      assert.equal(code, 0);
      assert.equal(backendClosed, true);
      assert.equal(frontendClosed, true);
      assert.deepEqual(JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8')), { starts: 1, sentinel: 'backend-only' });
      await assertPortAvailable(port);
      console.log('OFFLINE_APP_CLOSED_CLEANLY');
    }
    void run().catch(error => { console.error(error); controller?.stop(1); process.exitCode = 1; });
  `);
  const systemEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'HOME'].includes(key.toUpperCase())));
  const result = await promisify(execFile)(process.execPath, [runnerFile], {
    cwd: directory, env: systemEnv, windowsHide: true, timeout: 10000,
  });
  assert.match(result.stdout, /OFFLINE_BACKEND_STARTED/);
  assert.match(result.stdout, /OFFLINE_BACKEND_SHUTDOWN/);
  assert.match(result.stdout, /OFFLINE_APP_CLOSED_CLEANLY/);
  assert.doesNotMatch(result.stderr, /reinicio en|dejó de responder/);
});
