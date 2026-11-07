const assert = require('node:assert/strict');
const test = require('node:test');
const { setImmediate: turn } = require('node:timers/promises');
const { openWebDatabase, WebDatabase } = require('../dist/infrastructure/sqlite/database');
const { createSqliteRepositories } = require('../dist/infrastructure/sqlite/repositories');
const { createWebServer } = require('../dist/web/server');
const USER = '111111111111111111';
const GUILD = '333333333333333333';
const ORIGIN = 'http://127.0.0.1:8080';
const BASE = `/api/guilds/${GUILD}`;
const config = { enabled: true, host: '127.0.0.1', port: 8080, origin: ORIGIN, oauthClientId: '555555555555555555', oauthClientSecret: 'test-only', oauthRedirectUri: `${ORIGIN}/auth/discord/callback`, allowedUserIds: [USER], databasePath: ':memory:', sessionTtlMs: 60000, secureCookies: false };
const metadata = { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Song', artist: 'Artist', duration: 1, thumbnail: null, source: 'youtube' };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function harness(t, options = {}) {
  const db = openWebDatabase(':memory:');
  const repos = createSqliteRepositories(db);
  const state = { manage: true, calls: 0 };
  const session = await repos.sessions.createSession({ id: USER, username: 'User', avatar: null }, 1000, 60000);
  const headers = { cookie: `music_session=${session.token}`, origin: ORIGIN, 'x-csrf-token': session.csrfToken };
  const bridge = {
    async assertGuildAccess() {},
    async listGuilds() { return []; },
    async getPermissions() { return { canManageLibrary: state.manage, canControl: true }; },
    async control() { state.calls++; },
  };
  const app = await createWebServer({ config, bridge, repositories: repos, now: () => 1000, ...options });
  t.after(async () => { await app.close(); await repos.close(); });
  return { db, repos, app, state, bridge, headers };
}

test('SQLite facade returns promises, preserves this, rejects domain errors and closes idempotently', async () => {
  const db = openWebDatabase(':memory:');
  const r = createSqliteRepositories(db);
  try {
    const detached = r.sessions.createSession;
    const pending = detached({ id: USER, username: 'User', avatar: null }, 1000, 60000);
    assert.ok(pending instanceof Promise);
    await pending;
    const missing = r.playlists.getPlaylist(USER, GUILD, 'missing');
    assert.ok(missing instanceof Promise);
    await assert.rejects(missing, { kind: 'not_found', message: 'Playlist not found' });
  } finally { await Promise.all([r.close(), r.close()]); }
  await r.close();
  assert.equal(db.sqlite.open, false);
});

test('server awaits grouped async reads and mutations, preserving exact error bodies; injected resources stay open', async t => {
  const h = await harness(t);
  const create = h.repos.playlists.createPlaylist;
  const entered = deferred(), release = deferred();
  h.repos.playlists.createPlaylist = async (...args) => { entered.resolve(); await release.promise; return await create(...args); };
  const response = h.app.inject({ method: 'POST', url: `${BASE}/playlists`, headers: h.headers, payload: { name: 'Async' } });
  await entered.promise;
  assert.deepEqual(await h.repos.playlists.listPlaylists(USER, GUILD), []);
  release.resolve();
  const created = await response;
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().playlist.name, 'Async');
  h.repos.playlists.listPlaylists = async () => { await turn(); return [{ id: 'async', name: 'Delayed', tracks: [] }]; };
  assert.deepEqual((await h.app.inject({ url: `${BASE}/playlists`, headers: h.headers })).json(), { playlists: [{ id: 'async', name: 'Delayed', tracks: [] }] });
  const missing = await h.app.inject({ method: 'DELETE', url: `${BASE}/playlists/missing`, headers: h.headers });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body, '{"error":"Playlist not found"}');
  await h.app.close();
  assert.equal(h.db.sqlite.open, true);
});

test('session revoked during membership wait is rejected before library write', async t => {
  const h = await harness(t);
  const entered = deferred(), release = deferred();
  h.bridge.assertGuildAccess = async () => { entered.resolve(); await release.promise; };
  const response = h.app.inject({ method: 'POST', url: `${BASE}/playlists`, headers: h.headers, payload: { name: 'Denied' } });
  await entered.promise;
  await h.repos.sessions.deleteUserSessions(USER);
  release.resolve();
  assert.equal((await response).statusCode, 401);
  assert.deepEqual(await h.repos.playlists.listPlaylists(USER, GUILD), []);
});

test('role revoked during asynchronous playlist read blocks playback', async t => {
  const h = await harness(t);
  const p = await h.repos.playlists.createPlaylistWithTracks(USER, GUILD, 'List', [metadata], 1000);
  const get = h.repos.playlists.getPlaylist;
  h.repos.playlists.getPlaylist = async (...args) => { const result = await get(...args); h.state.manage = false; await turn(); return result; };
  const response = await h.app.inject({ method: 'POST', url: `${BASE}/playlists/${p.id}/load`, headers: h.headers });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body, '{"error":"Library access is required"}');
  assert.equal(h.state.calls, 0);
});

test('role revoked during metadata resolution blocks saving a track', async t => {
  let h;
  h = await harness(t, { oauthFetch: async () => { h.state.manage = false; return new Response(JSON.stringify({ title: 'Resolved', author_name: 'Artist' })); } });
  const p = await h.repos.playlists.createPlaylist(USER, GUILD, 'List', 1000);
  const response = await h.app.inject({ method: 'POST', url: `${BASE}/playlists/${p.id}/tracks`, headers: h.headers, payload: { url: metadata.url } });
  assert.equal(response.statusCode, 403);
  assert.deepEqual((await h.repos.playlists.getPlaylist(USER, GUILD, p.id)).tracks, []);
});

test('purge catches rejected promises, skips overlaps, resumes and is drained on shutdown', async t => {
  const h = await harness(t);
  t.mock.timers.enable({ apis: ['setInterval'] });
  // The interval was registered before mocking; recreate the server under the clock.
  await h.app.close();
  let pending = deferred(), calls = 0;
  h.repos.sessions.purgeExpired = async () => { calls++; await pending.promise; };
  const app = await createWebServer({ config, bridge: h.bridge, repositories: h.repos, now: () => 1000 });
  t.after(async () => { pending.resolve(); await app.close(); });
  const warnings = [];
  t.mock.method(console, 'warn', message => warnings.push(message));
  t.mock.timers.tick(60000);
  await turn();
  t.mock.timers.tick(120000);
  assert.equal(calls, 1);
  pending.reject(new Error('private database detail'));
  await turn();
  assert.deepEqual(warnings, ['[Web] Dashboard expired-session cleanup failed.']);
  pending = deferred();
  t.mock.timers.tick(60000);
  await turn();
  assert.equal(calls, 2);
  let closed = false;
  const closing = app.close().then(() => { closed = true; });
  await turn();
  assert.equal(closed, false);
  pending.resolve();
  await closing;
  t.mock.timers.tick(60000);
  assert.equal(calls, 2);
  assert.equal(h.db.sqlite.open, true);
});

test('owned repositories close once on normal shutdown and startup failure; legacy injected database stays open', async t => {
  const original = WebDatabase.prototype.close;
  let closes = 0;
  t.mock.method(WebDatabase.prototype, 'close', function () { closes++; return original.call(this); });
  const bridge = { async assertGuildAccess() {}, async listGuilds() { return []; } };
  const app = await createWebServer({ config, bridge });
  await app.close(); await app.close();
  assert.equal(closes, 1);
  // An existing relative static root makes plugin registration fail after opening SQLite.
  await assert.rejects(createWebServer({ config: { ...config, staticRoot: 'test' }, bridge }), /absolute/);
  assert.equal(closes, 2);
  const db = openWebDatabase(':memory:');
  try {
    const legacy = await createWebServer({ config, bridge, database: db });
    await legacy.close();
    assert.equal(db.sqlite.open, true);
    const repositories = createSqliteRepositories(db);
    await assert.rejects(createWebServer({ config: { ...config, staticRoot: 'test' }, bridge, repositories }), /absolute/);
    assert.equal(db.sqlite.open, true);
  } finally { db.close(); }
});
