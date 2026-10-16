const assert = require('node:assert/strict');
const test = require('node:test');
const { createWebLifecycle } = require('../dist/runtime/webDashboard');

test('disabled dashboard never opens resources', async () => {
  const lifecycle = createWebLifecycle({ enabled: () => false, open: () => assert.fail('disabled'), report: assert.fail });
  await lifecycle.start(); await lifecycle.stop();
});

test('HTTP startup failures are isolated from bot startup', async () => {
  const reports = [];
  const lifecycle = createWebLifecycle({ enabled: () => true, open: async () => { throw new Error('port occupied'); }, report: error => reports.push(error.message) });
  await lifecycle.start(); await lifecycle.stop();
  assert.deepEqual(reports, ['port occupied']);
});

test('shutdown during startup closes the late HTTP server exactly once', async () => {
  let release; let opens = 0; let closes = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const lifecycle = createWebLifecycle({ enabled: () => true, open: async () => { opens++; return pending; }, report: assert.fail });
  const start = lifecycle.start();
  const stop = lifecycle.stop();
  release({ close: async () => { closes++; } });
  await Promise.all([start, stop, lifecycle.stop()]);
  await lifecycle.start();
  assert.equal(opens, 1); assert.equal(closes, 1);
});

test('repeated startup shares the server and close failures remain contained', async () => {
  let opens = 0; const reports = [];
  const lifecycle = createWebLifecycle({ enabled: () => true, open: async () => { opens++; return { close: async () => { throw new Error('close failure'); } }; }, report: error => reports.push(error.message) });
  await Promise.all([lifecycle.start(), lifecycle.start()]);
  await lifecycle.stop(); await lifecycle.stop();
  assert.equal(opens, 1); assert.deepEqual(reports, ['close failure']);
});
