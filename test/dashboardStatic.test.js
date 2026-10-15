const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createWebServer } = require('../dist/web/server');

test('static SPA stays inside frontend root and API/auth misses never serve the app shell', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-static-'));
  writeFileSync(path.join(directory, 'index.html'), '<!doctype html><title>SONORA fixture</title>');
  writeFileSync(path.join(directory, '.env'), 'PRIVATE_STATIC_FIXTURE');
  const id = '100000000000000001';
  const app = await createWebServer({
    config: { enabled: true, host: '127.0.0.1', port: 8080, origin: 'http://127.0.0.1:8080', oauthClientId: id,
      oauthClientSecret: 'test-fixture', oauthRedirectUri: 'http://127.0.0.1:8080/auth/discord/callback', allowedUserIds: [id],
      databasePath: ':memory:', sessionTtlMs: 60000, secureCookies: false, staticRoot: directory },
    bridge: { listGuilds: async () => [], assertGuildAccess: async () => {}, getState: async () => assert.fail('unauthenticated'), control: async () => assert.fail('unauthenticated') },
  });
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const root = await app.inject('/');
  assert.equal(root.statusCode, 200); assert.match(root.body, /SONORA fixture/);
  assert.match(root.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(root.headers['x-content-type-options'], 'nosniff');
  assert.match((await app.inject('/library')).body, /SONORA fixture/);
  for (const url of ['/.env', '/%2eenv', '/../package.json', '/%2e%2e/package.json', '/api/missing', '/auth/missing']) {
    const response = await app.inject(url);
    assert.doesNotMatch(response.body, /PRIVATE_STATIC_FIXTURE|discord-music-bot/);
    if (url.startsWith('/api') || url.startsWith('/auth')) assert.doesNotMatch(response.body, /SONORA fixture/);
  }
});
