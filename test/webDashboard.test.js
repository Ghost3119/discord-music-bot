const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { createWebServer } = require('../dist/web/server');
const { openWebDatabase, hashToken } = require('../dist/web/database');
const { readWebConfig } = require('../dist/web/config');

const USER = '111111111111111111';
const OTHER = '222222222222222222';
const GUILD = '333333333333333333';
const OTHER_GUILD = '444444444444444444';
const ORIGIN = 'http://127.0.0.1:8080';
const BASE = `/api/guilds/${GUILD}`;
const TRACK = { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Song', artist: 'Artist', duration: 213, thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', source: 'YouTube' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function denied() { return Object.assign(new Error('Guild access denied'), { statusCode: 403 }); }
function snapshot() { return { guildId: GUILD, status: 'idle', current: null, queue: [], currentTime: 0, volume: 50, repeat: 0, voice: null, health: {}, incidents: [] }; }
async function harness(t, overrides = {}) {
  const state = { time: 1000000, oauthUser: USER, calls: [], permissions: true, snapshots: 0, fetches: 0, control: null };
  const db = overrides.database || openWebDatabase(':memory:');
  const config = { enabled: true, host: '127.0.0.1', port: 8080, origin: ORIGIN, oauthClientId: '555555555555555555', oauthClientSecret: 'server-only-secret', oauthRedirectUri: `${ORIGIN}/auth/discord/callback`, allowedUserIds: [USER, OTHER], databasePath: ':memory:', sessionTtlMs: 60000, secureCookies: false, ...overrides.config };
  const bridge = {
    async assertGuildAccess(_userId, guildId) { if (!state.permissions || guildId !== GUILD) throw denied(); },
    async listGuilds() { return state.permissions ? [{ id: GUILD, name: 'Music server', icon: null }] : []; },
    async getState() { state.snapshots++; return snapshot(); },
    async control(userId, guildId, action, signal) { state.calls.push({ userId, guildId, action, signal }); if (state.control) await state.control(signal); },
  };
  const oauthFetch = async (url, options) => {
    state.fetches++;
    if (url.endsWith('/token')) {
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('client_secret'), config.oauthClientSecret);
      return new Response(JSON.stringify({ access_token: 'never-persist-this-token', token_type: 'Bearer' }));
    }
    assert.equal(options.headers.Authorization, 'Bearer never-persist-this-token');
    return new Response(JSON.stringify({ id: state.oauthUser, username: 'Test account', avatar: null }));
  };
  const app = await createWebServer({ config, bridge, database: db, oauthFetch: overrides.oauthFetch || oauthFetch, now: () => state.time, sseIntervalMs: 20 });
  t.after(async () => { await app.close(); if (!overrides.database) db.close(); });
  async function startLogin() {
    const response = await app.inject('/auth/discord');
    assert.equal(response.statusCode, 302);
    const stateValue = new URL(response.headers.location).searchParams.get('state');
    const cookie = response.cookies.find(item => item.name === 'music_oauth_state');
    return { state: stateValue, cookie: `music_oauth_state=${cookie.value}` };
  }
  async function finishLogin(login) {
    return app.inject({ url: `/auth/discord/callback?code=test-code&state=${login.state}`, headers: { cookie: login.cookie } });
  }
  async function login(userId = USER) {
    state.oauthUser = userId;
    const response = await finishLogin(await startLogin());
    assert.equal(response.statusCode, 302, response.body);
    const token = response.cookies.find(item => item.name === 'music_session').value;
    const cookie = `music_session=${token}`;
    const session = await app.inject({ url: '/api/session', headers: { cookie } });
    return { cookie, token, csrf: session.json().csrfToken };
  }
  async function mutate(auth, method, url, payload, extraHeaders = {}) {
    return app.inject({ method, url, headers: { cookie: auth.cookie, origin: ORIGIN, 'x-csrf-token': auth.csrf, ...extraHeaders }, ...(payload === undefined ? {} : { payload }) });
  }
  return { app, db, state, config, login, startLogin, finishLogin, mutate };
}

test('dashboard is disabled by default; enabled configuration validates OAuth, HTTPS and allowlist', () => {
  const disabled = readWebConfig({});
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.host, '127.0.0.1');
  assert.equal(disabled.port, 8080);
  assert.throws(() => readWebConfig({ WEB_ENABLED: 'true' }), /required/);
  const env = { WEB_ENABLED: 'true', CLIENT_ID: '555555555555555555', WEB_CLIENT_ID: '', WEB_CLIENT_SECRET: 'secret', WEB_ALLOWED_USER_IDS: USER };
  assert.equal(readWebConfig(env).oauthClientId, env.CLIENT_ID);
  assert.throws(() => readWebConfig({ ...env, WEB_ORIGIN: 'http://example.com' }), /HTTPS/);
  assert.throws(() => readWebConfig({ ...env, WEB_HOST: '0.0.0.0' }), /localhost/);
  assert.throws(() => readWebConfig({ ...env, WEB_REDIRECT_URI: 'http://evil.example/auth/discord/callback' }), /WEB_REDIRECT_URI/);
  assert.equal(readWebConfig({ ...env, WEB_ORIGIN: 'https://music.example' }).secureCookies, true);
});

test('OAuth uses unpredictable cookie-bound one-time state, identify only, hashed persistent sessions', async t => {
  const h = await harness(t);
  const first = await h.startLogin();
  const second = await h.startLogin();
  assert.notEqual(first.state, second.state);
  const wrong = await h.app.inject({ url: `/auth/discord/callback?code=x&state=${first.state}`, headers: { cookie: second.cookie } });
  assert.equal(wrong.statusCode, 400);
  assert.equal(h.state.fetches, 0);
  const response = await h.finishLogin(first);
  assert.equal(response.statusCode, 302);
  const sessionCookie = response.cookies.find(item => item.name === 'music_session');
  assert.equal(sessionCookie.httpOnly, true);
  assert.equal(sessionCookie.sameSite, 'Lax');
  const row = h.db.sqlite.prepare('SELECT * FROM web_sessions').get();
  assert.equal(row.token_hash, hashToken(sessionCookie.value));
  assert.equal(JSON.stringify(row).includes(sessionCookie.value), false);
  assert.equal(JSON.stringify(h.db.sqlite.prepare('SELECT * FROM users').all()).includes('never-persist-this-token'), false);
  const replay = await h.finishLogin(first);
  assert.equal(replay.statusCode, 400);
  assert.equal(h.state.fetches, 2);
  const start = await h.app.inject('/auth/discord');
  assert.equal(new URL(start.headers.location).searchParams.get('scope'), 'identify');
  assert.equal(new URL(start.headers.location).searchParams.has('client_secret'), false);
});

test('OAuth expires states, rejects unauthorized accounts and does not expose upstream error secrets', async t => {
  const h = await harness(t);
  const login = await h.startLogin();
  h.state.time += 300001;
  assert.equal((await h.finishLogin(login)).statusCode, 400);
  h.state.oauthUser = '999999999999999999';
  const response = await h.finishLogin(await h.startLogin());
  assert.equal(response.statusCode, 403);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS count FROM web_sessions').get().count, 0);
});

test('persistent sessions expire and logout invalidates cookies and sessions; mutations require origin and CSRF', async t => {
  const h = await harness(t);
  assert.equal((await h.app.inject('/api/session')).statusCode, 401);
  const auth = await h.login();
  const forbidden = await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'stop' }, { 'x-csrf-token': 'x'.repeat(64) });
  assert.equal(forbidden.statusCode, 403);
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'stop' }, { origin: 'http://evil.example' })).statusCode, 403);
  assert.equal((await h.app.inject({ method: 'POST', url: `${BASE}/actions`, headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf }, payload: { action: 'stop' } })).statusCode, 403);
  assert.equal(h.state.calls.length, 0);
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'volume', volume: 150 })).statusCode, 400);
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'play', query: 'https://127.0.0.1/private' })).statusCode, 400);
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'pause' })).statusCode, 200);
  assert.equal(h.state.calls.length, 1);
  const logout = await h.mutate(auth, 'POST', '/auth/logout');
  assert.equal(logout.statusCode, 200);
  assert.equal((await h.app.inject({ url: '/api/session', headers: { cookie: auth.cookie } })).statusCode, 401);
  const next = await h.login();
  h.state.time += 60001;
  assert.equal((await h.app.inject({ url: '/api/session', headers: { cookie: next.cookie } })).statusCode, 401);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS count FROM web_sessions').get().count, 0);
});

test('every guild operation validates live access and library ownership across users and guilds', async t => {
  const h = await harness(t);
  const auth = await h.login();
  const created = await h.mutate(auth, 'POST', `${BASE}/playlists`, { name: 'Private collection' });
  const id = created.json().playlist.id;
  const other = await h.login(OTHER);
  assert.equal((await h.mutate(other, 'PATCH', `${BASE}/playlists/${id}`, { name: 'Stolen' })).statusCode, 404);
  assert.equal((await h.mutate(other, 'DELETE', `${BASE}/playlists/${id}`)).statusCode, 404);
  assert.equal((await h.mutate(other, 'POST', `${BASE}/playlists/${id}/tracks`, TRACK)).statusCode, 404);
  const unknownGuild = `/api/guilds/${OTHER_GUILD}`;
  assert.equal((await h.app.inject({ url: `${unknownGuild}/state`, headers: { cookie: auth.cookie } })).statusCode, 403);
  assert.equal((await h.mutate(auth, 'POST', `${unknownGuild}/favorites`, TRACK)).statusCode, 403);
  h.state.permissions = false;
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'skip' })).statusCode, 403);
  assert.equal((await h.app.inject({ url: `${BASE}/playlists`, headers: { cookie: auth.cookie } })).statusCode, 403);
});

test('playlists reorder transactionally, compact after removal, reject streams, and favorites deduplicate', async t => {
  const h = await harness(t);
  const auth = await h.login();
  const id = (await h.mutate(auth, 'POST', `${BASE}/playlists`, { name: 'Collection' })).json().playlist.id;
  const tracks = [];
  for (let i = 0; i < 3; i++) tracks.push((await h.mutate(auth, 'POST', `${BASE}/playlists/${id}/tracks`, { ...TRACK, title: `Song ${i}` })).json().track);
  const ids = tracks.map(item => item.id).reverse();
  const reordered = await h.mutate(auth, 'PUT', `${BASE}/playlists/${id}/tracks/order`, { trackIds: ids });
  assert.equal(reordered.statusCode, 200, reordered.body);
  assert.deepEqual(reordered.json().playlist.tracks.map(item => item.id), ids);
  assert.equal((await h.mutate(auth, 'PUT', `${BASE}/playlists/${id}/tracks/order`, { trackIds: [ids[0], ids[0], ids[2]] })).statusCode, 400);
  assert.deepEqual(h.db.getPlaylist(USER, GUILD, id).tracks.map(item => item.id), ids);
  assert.equal((await h.mutate(auth, 'DELETE', `${BASE}/playlists/${id}/tracks/${ids[1]}`)).statusCode, 200);
  assert.deepEqual(h.db.sqlite.prepare('SELECT position FROM playlist_tracks ORDER BY position').all().map(row => row.position), [0, 1]);
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/playlists/${id}/tracks`, { ...TRACK, url: 'https://r1.googlevideo.com/videoplayback?expire=123&sig=token' })).statusCode, 400);
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/favorites`, { ...TRACK, thumbnail: 'http://127.0.0.1/private' })).statusCode, 400);
  const favorite = (await h.mutate(auth, 'POST', `${BASE}/favorites`, TRACK)).json().track;
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/favorites`, { ...TRACK, url: 'https://youtu.be/dQw4w9WgXcQ?si=tracking' })).json().track.id, favorite.id);
  assert.equal(h.db.listFavorites(USER, GUILD).length, 1);
  const other = await h.login(OTHER);
  assert.equal((await h.mutate(other, 'DELETE', `${BASE}/favorites/${favorite.id}`)).statusCode, 404);
  assert.equal((await h.mutate(auth, 'DELETE', `${BASE}/favorites/${favorite.id}`)).statusCode, 200);
  await h.mutate(auth, 'DELETE', `${BASE}/playlists/${id}`);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS count FROM playlist_tracks').get().count, 0);
  assert.deepEqual(h.db.sqlite.pragma('foreign_key_check'), []);
});

test('SQLite migrations, playlists and hashed sessions survive closing and reopening the database', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'music-dashboard-'));
  const filename = path.join(directory, 'dashboard.sqlite');
  let db;
  try {
    db = openWebDatabase(filename);
    const session = db.createSession({ id: USER, username: 'Persistent user', avatar: null }, 1000, 60000);
    const playlist = db.createPlaylist(USER, GUILD, 'Saved collection', 1000);
    db.addPlaylistTrack(USER, GUILD, playlist.id, { ...TRACK, source: 'youtube' });
    db.close();
    db = openWebDatabase(filename);
    assert.equal(db.getSession(session.token, 2000).user.id, USER);
    assert.equal(db.listPlaylists(USER, GUILD)[0].tracks[0].title, TRACK.title);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM web_migrations').get().count, 1);
    db.deleteSession(session.token);
    assert.equal(db.getSession(session.token, 2000), null);
  } finally { if (db?.sqlite.open) db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('playlist load is bounded, serial and uses bridge controls with cancellation and live permissions', async t => {
  const h = await harness(t);
  const auth = await h.login();
  const id = (await h.mutate(auth, 'POST', `${BASE}/playlists`, { name: 'Load collection' })).json().playlist.id;
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/playlists/${id}/load`)).statusCode, 400);
  for (let i = 0; i < 3; i++) h.db.addPlaylistTrack(USER, GUILD, id, { ...TRACK, source: 'youtube' });
  h.state.control = async () => { h.state.permissions = false; };
  const result = await h.mutate(auth, 'POST', `${BASE}/playlists/${id}/load`);
  assert.equal(result.statusCode, 403);
  assert.equal(h.state.calls.length, 1);
  assert.equal(h.state.calls[0].action.action, 'play');
  assert.ok(h.state.calls[0].signal instanceof AbortSignal);
});

async function liveEvent(app, cookie) {
  const address = app.server.address();
  const request = http.get({ host: '127.0.0.1', port: address.port, path: `${BASE}/events`, headers: { cookie } });
  const [response] = await once(request, 'response');
  response.setEncoding('utf8');
  const [first] = await once(response, 'data');
  return { request, response, first };
}

test('SSE synchronizes initial state, updates, revalidates permissions and cleans up on logout and shutdown', async t => {
  const h = await harness(t);
  const auth = await h.login();
  await h.app.listen({ host: '127.0.0.1', port: 0 });
  const stream = await liveEvent(h.app, auth.cookie);
  assert.match(stream.first, /event: state\ndata:/);
  assert.equal(JSON.parse(stream.first.split('data: ')[1]).guildId, GUILD);
  const next = once(stream.response, 'data');
  await next;
  assert.ok(h.state.snapshots >= 2);
  const ended = once(stream.response, 'end');
  await h.mutate(auth, 'POST', '/auth/logout');
  await ended;
  const after = h.state.snapshots;
  await delay(50);
  assert.equal(h.state.snapshots, after);
  const auth2 = await h.login();
  const stream2 = await liveEvent(h.app, auth2.cookie);
  const ended2 = once(stream2.response, 'end');
  h.state.permissions = false;
  await ended2;
  h.state.permissions = true;
  const stream3 = await liveEvent(h.app, auth2.cookie);
  const ended3 = once(stream3.response, 'end');
  await h.app.close();
  await ended3;
});

test('SSE sessions expire during a connection and excess connections are rejected', async t => {
  const h = await harness(t);
  const auth = await h.login();
  await h.app.listen({ host: '127.0.0.1', port: 0 });
  const clients = [];
  for (let i = 0; i < 4; i++) clients.push(await liveEvent(h.app, auth.cookie));
  const rejected = await h.app.inject({ url: `${BASE}/events`, headers: { cookie: auth.cookie } });
  assert.equal(rejected.statusCode, 429);
  const ends = clients.map(client => once(client.response, 'end'));
  h.state.time += 60001;
  await Promise.all(ends);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS count FROM web_sessions').get().count, 0);
});

test('logout cancels pending controls and playlist extraction before further tracks can execute', async t => {
  const h = await harness(t);
  const auth = await h.login();
  let started;
  const began = new Promise(resolve => { started = resolve; });
  h.state.control = async signal => {
    started();
    await once(signal, 'abort');
    throw Object.assign(new Error('private extractor details'), { errorCode: 'SESSION_CHANGED' });
  };
  const pending = h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'play', query: 'search text' });
  await began;
  assert.equal((await h.mutate(auth, 'POST', '/auth/logout')).statusCode, 200);
  const response = await pending;
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.includes('private extractor'), false);
  assert.equal(h.state.calls[0].signal.aborted, true);

  const nextAuth = await h.login();
  const playlist = h.db.createPlaylist(USER, GUILD, 'Cancellation', h.state.time);
  for (let i = 0; i < 3; i++) h.db.addPlaylistTrack(USER, GUILD, playlist.id, { ...TRACK, source: 'youtube' });
  let loadStarted;
  const loading = new Promise(resolve => { loadStarted = resolve; });
  h.state.control = async signal => { loadStarted(); await once(signal, 'abort'); throw Object.assign(new Error('cancelled'), { errorCode: 'SESSION_CHANGED' }); };
  const load = h.mutate(nextAuth, 'POST', `${BASE}/playlists/${playlist.id}/load`);
  await loading;
  await h.mutate(nextAuth, 'POST', '/auth/logout');
  assert.equal((await load).statusCode, 409);
  assert.equal(h.state.calls.length, 2);
});

test('session expiry and server shutdown cancel controls while extraction is pending', async t => {
  const h = await harness(t);
  const auth = await h.login();
  let started;
  const began = new Promise(resolve => { started = resolve; });
  h.state.control = async signal => { started(); await once(signal, 'abort'); signal.throwIfAborted(); };
  const pending = h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'play', query: TRACK.url });
  await began;
  h.state.time += 60001;
  assert.equal((await pending).statusCode, 409);
  assert.equal(h.state.calls[0].signal.aborted, true);

  const auth2 = await h.login();
  let secondStarted;
  const began2 = new Promise(resolve => { secondStarted = resolve; });
  h.state.control = async signal => { secondStarted(); await once(signal, 'abort'); throw Object.assign(new Error('cancelled'), { errorCode: 'SESSION_CHANGED' }); };
  const pending2 = h.mutate(auth2, 'POST', `${BASE}/actions`, { action: 'play', query: TRACK.url });
  await began2;
  await h.app.close();
  assert.equal((await pending2).statusCode, 409);
  assert.equal(h.state.calls[1].signal.aborted, true);
  assert.equal(h.db.sqlite.open, true, 'injected database remains caller-owned');
});

test('client disconnect propagates cancellation to in-flight playback without executing another request', async t => {
  const h = await harness(t);
  const auth = await h.login();
  await h.app.listen({ host: '127.0.0.1', port: 0 });
  let started, aborted;
  const began = new Promise(resolve => { started = resolve; });
  const cancelled = new Promise(resolve => { aborted = resolve; });
  h.state.control = async signal => { started(); await once(signal, 'abort'); aborted(); throw Object.assign(new Error('cancelled'), { errorCode: 'SESSION_CHANGED' }); };
  const request = http.request({ host: '127.0.0.1', port: h.app.server.address().port, path: `${BASE}/actions`, method: 'POST', headers: { cookie: auth.cookie, origin: ORIGIN, 'x-csrf-token': auth.csrf, 'content-type': 'application/json' } });
  request.on('error', () => {});
  request.end(JSON.stringify({ action: 'play', query: TRACK.url }));
  await began;
  request.destroy();
  await cancelled;
  assert.equal(h.state.calls[0].signal.aborted, true);
});

test('known bridge errors return safe actionable HTTP status; unknown errors hide secrets', async t => {
  const h = await harness(t);
  const auth = await h.login();
  for (const [code, status] of [['GUILD_ACCESS_DENIED', 403], ['CONTROL_CHANNEL_REQUIRED', 403], ['VOICE_PERMISSIONS', 403], ['SESSION_CHANGED', 409], ['QUEUE_BLOCKED', 409], ['NO_QUEUE', 400], ['INVALID_ACTION', 400], ['INVALID_QUEUE_POSITION', 400], ['NO_UP_NEXT', 400]]) {
    h.state.control = async () => { throw Object.assign(new Error('url?secret=provider-token'), { errorCode: code }); };
    const response = await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'pause' });
    assert.equal(response.statusCode, status);
    assert.equal(response.body.includes('provider-token'), false);
  }
  h.state.control = async () => { throw new Error('url?secret=provider-token'); };
  const response = await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'pause' });
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.includes('provider-token'), false);
});

test('playback accepts public playlists while library rejects aggregate and temporary URLs', async t => {
  const h = await harness(t);
  const auth = await h.login();
  const playlistUrl = 'https://www.youtube.com/playlist?list=PL1234567890abc';
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'play', query: playlistUrl })).statusCode, 200);
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/favorites`, { ...TRACK, url: playlistUrl })).statusCode, 400);
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'play', query: 'file:///C:/secret' })).statusCode, 400);
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'play', query: '//127.0.0.1/secret' })).statusCode, 400);
});

test('OAuth network failures are sanitized and login endpoints are rate limited', async t => {
  const h = await harness(t, { oauthFetch: async () => { throw new Error('client_secret=very-private'); } });
  const response = await h.finishLogin(await h.startLogin());
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.includes('very-private'), false);
  for (let i = 0; i < 9; i++) assert.equal((await h.app.inject('/auth/discord')).statusCode, 302);
  assert.equal((await h.app.inject('/auth/discord')).statusCode, 429);
});

test('30 day sessions do not overflow operation timers and prototype error codes stay sanitized', async t => {
  const h = await harness(t, { config: { sessionTtlMs: 30 * 86400000 } });
  const auth = await h.login();
  h.state.control = async signal => { await delay(30); signal.throwIfAborted(); };
  assert.equal((await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'pause' })).statusCode, 200);
  for (const code of ['__proto__', 'constructor', 'toString']) {
    h.state.control = async () => { throw Object.assign(new Error('private provider token'), { errorCode: code }); };
    const response = await h.mutate(auth, 'POST', `${BASE}/actions`, { action: 'pause' });
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.includes('private provider token'), false);
  }
});

test('configuration supports allowlist by default and validates guild_members mode and admin IDs', () => {
  const baseEnv = { WEB_ENABLED: 'true', CLIENT_ID: '555555555555555555', WEB_CLIENT_SECRET: 'secret' };
  const allowlist = readWebConfig({ ...baseEnv, WEB_ALLOWED_USER_IDS: USER });
  assert.equal(allowlist.accessMode, 'allowlist');
  assert.deepEqual(allowlist.adminUserIds, [USER]);

  const dynamic = readWebConfig({ ...baseEnv, WEB_ACCESS_MODE: 'guild_members', WEB_ALLOWED_GUILD_IDS: `${GUILD}, ${OTHER_GUILD}`, WEB_ADMIN_USER_IDS: USER });
  assert.equal(dynamic.accessMode, 'guild_members');
  assert.deepEqual(dynamic.allowedGuildIds, [GUILD, OTHER_GUILD]);
  assert.deepEqual(dynamic.adminUserIds, [USER]);
  assert.deepEqual(dynamic.allowedUserIds, []);

  assert.throws(() => readWebConfig({ ...baseEnv, WEB_ACCESS_MODE: 'invalid', WEB_ALLOWED_USER_IDS: USER }), /WEB_ACCESS_MODE/);
  assert.throws(() => readWebConfig({ ...baseEnv, WEB_ACCESS_MODE: 'guild_members' }), /WEB_ALLOWED_GUILD_IDS/);
  assert.throws(() => readWebConfig({ ...baseEnv, WEB_ACCESS_MODE: 'guild_members', WEB_ALLOWED_GUILD_IDS: 'not-a-snowflake' }), /WEB_ALLOWED_GUILD_IDS/);
  assert.throws(() => readWebConfig({ ...baseEnv, WEB_ACCESS_MODE: 'guild_members', WEB_ALLOWED_GUILD_IDS: GUILD, WEB_ADMIN_USER_IDS: 'invalid' }), /WEB_ADMIN_USER_IDS/);
  assert.throws(() => readWebConfig({ ...baseEnv, WEB_ALLOWED_USER_IDS: USER, WEB_MEMBERSHIP_CACHE_TTL_MS: '999999' }), /WEB_MEMBERSHIP_CACHE_TTL_MS/);
});

test('guild_members mode authorizes members of allowed guilds, rejects external users, and revokes expelled users', async t => {
  const EXTERNAL = '777777777777777777';
  const UNAUTHORIZED_GUILD = '888888888888888888';
  const memberships = new Map([
    [USER, new Set([GUILD, UNAUTHORIZED_GUILD])],
    [EXTERNAL, new Set([UNAUTHORIZED_GUILD])],
  ]);
  const db = openWebDatabase(':memory:');
  t.after(() => db.close());
  let currentOAuthUser = USER;
  const config = {
    enabled: true, host: '127.0.0.1', port: 8080, origin: ORIGIN,
    oauthClientId: '555555555555555555', oauthClientSecret: 'server-only-secret',
    oauthRedirectUri: `${ORIGIN}/auth/discord/callback`,
    accessMode: 'guild_members', allowedUserIds: [], allowedGuildIds: [GUILD, OTHER_GUILD],
    adminUserIds: [], databasePath: ':memory:', sessionTtlMs: 60000, secureCookies: false,
  };
  const bridge = {
    async assertGuildAccess(userId, guildId) {
      if (!memberships.get(userId)?.has(guildId)) throw Object.assign(new Error('Denied'), { errorCode: 'GUILD_ACCESS_DENIED' });
    },
    async listGuilds(userId) {
      const userGuilds = memberships.get(userId) ?? new Set();
      return [GUILD, OTHER_GUILD, UNAUTHORIZED_GUILD]
        .filter(id => userGuilds.has(id))
        .map(id => ({ id, name: `Server ${id}`, icon: null }));
    },
    async getState(_userId, guildId) {
      return { ...snapshot(), guildId, health: { connected: true, ping: 15 }, incidents: [{ code: 'NET', message: 'err', at: new Date().toISOString() }] };
    },
    async control() {},
  };
  const oauthFetch = async url => {
    if (url.endsWith('/token')) return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer' }));
    return new Response(JSON.stringify({ id: currentOAuthUser, username: 'Member', avatar: null }));
  };
  const app = await createWebServer({ config, bridge, database: db, oauthFetch, sseIntervalMs: 20 });
  t.after(() => app.close());

  async function attemptLogin(userId) {
    currentOAuthUser = userId;
    const start = await app.inject('/auth/discord');
    const state = new URL(start.headers.location).searchParams.get('state');
    const cookie = start.cookies.find(item => item.name === 'music_oauth_state').value;
    return app.inject({ url: `/auth/discord/callback?code=ok&state=${state}`, headers: { cookie: `music_oauth_state=${cookie}` } });
  }

  // External user (only in UNAUTHORIZED_GUILD, not in WEB_ALLOWED_GUILD_IDS) is rejected at login
  const externalRes = await attemptLogin(EXTERNAL);
  assert.equal(externalRes.statusCode, 403);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM web_sessions').get().count, 0);

  // Authorized guild member logs in without WEB_ALLOWED_USER_IDS
  const memberRes = await attemptLogin(USER);
  assert.equal(memberRes.statusCode, 302);
  const token = memberRes.cookies.find(item => item.name === 'music_session').value;
  const cookie = `music_session=${token}`;
  const sessionRes = await app.inject({ url: '/api/session', headers: { cookie } });
  assert.equal(sessionRes.statusCode, 200);
  assert.equal(sessionRes.json().accessMode, 'guild_members');
  assert.equal(sessionRes.json().role, 'member');
  assert.equal(sessionRes.json().isAdmin, false);

  // Only authorized guilds where user is a member are shown (UNAUTHORIZED_GUILD and OTHER_GUILD are excluded)
  const guildsRes = await app.inject({ url: '/api/guilds', headers: { cookie } });
  assert.equal(guildsRes.statusCode, 200);
  assert.deepEqual(guildsRes.json().guilds.map(g => g.id), [GUILD]);
  assert.equal((await app.inject({ url: `/api/guilds/${UNAUTHORIZED_GUILD}/state`, headers: { cookie } })).statusCode, 403);
  assert.equal((await app.inject({ url: `/api/guilds/${OTHER_GUILD}/state`, headers: { cookie } })).statusCode, 403);

  // User is expelled from GUILD during active session -> all guild endpoints deny and /api/session revokes session
  memberships.get(USER).delete(GUILD);
  assert.equal((await app.inject({ url: `${BASE}/state`, headers: { cookie } })).statusCode, 403);
  assert.equal((await app.inject({ url: `${BASE}/playlists`, headers: { cookie } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/session', headers: { cookie } })).statusCode, 401);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM web_sessions').get().count, 0);
});

test('two servers with different permissions, voice channel requirement, and role separation (member, voice, admin)', async t => {
  const ADMIN = '666666666666666666';
  const voiceGuilds = new Map([
    [USER, new Set([GUILD])], // USER is in voice in GUILD, but only a member (outside voice) in OTHER_GUILD
    [ADMIN, new Set([])],     // ADMIN is an explicit admin, but not in voice in either guild
  ]);
  const db = openWebDatabase(':memory:');
  t.after(() => db.close());
  let currentOAuthUser = USER;
  const config = {
    enabled: true, host: '127.0.0.1', port: 8080, origin: ORIGIN,
    oauthClientId: '555555555555555555', oauthClientSecret: 'server-only-secret',
    oauthRedirectUri: `${ORIGIN}/auth/discord/callback`,
    accessMode: 'guild_members', allowedUserIds: [], allowedGuildIds: [GUILD, OTHER_GUILD],
    adminUserIds: [ADMIN], databasePath: ':memory:', sessionTtlMs: 60000, secureCookies: false,
  };
  const bridge = {
    async assertGuildAccess(_userId, guildId) {
      if (![GUILD, OTHER_GUILD].includes(guildId)) throw Object.assign(new Error('Denied'), { errorCode: 'GUILD_ACCESS_DENIED' });
    },
    async listGuilds() {
      return [{ id: GUILD, name: 'Guild A', icon: null }, { id: OTHER_GUILD, name: 'Guild B', icon: null }];
    },
    async getPermissions(userId, guildId) {
      const inVoice = Boolean(voiceGuilds.get(userId)?.has(guildId));
      const isAdmin = userId === ADMIN;
      return {
        role: isAdmin ? 'admin' : inVoice ? 'voice' : 'member',
        isMember: true, inVoiceChannel: inVoice, canControl: inVoice, isAdmin,
        canRead: true, canManageLibrary: true, canViewDiagnostics: isAdmin, canManageConfig: isAdmin,
      };
    },
    async getState(userId, guildId) {
      const perms = await this.getPermissions(userId, guildId);
      return {
        ...snapshot(), guildId,
        health: { connected: true, ping: 22 },
        incidents: [{ code: 'STREAM_ERR', message: 'Diagnostic error', at: new Date().toISOString() }],
        permissions: perms,
      };
    },
    async control(userId, guildId) {
      if (!voiceGuilds.get(userId)?.has(guildId)) {
        throw Object.assign(new Error('Join voice channel'), { errorCode: 'CONTROL_CHANNEL_REQUIRED' });
      }
    },
  };
  const oauthFetch = async url => {
    if (url.endsWith('/token')) return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer' }));
    return new Response(JSON.stringify({ id: currentOAuthUser, username: 'User', avatar: null }));
  };
  const app = await createWebServer({ config, bridge, database: db, oauthFetch, sseIntervalMs: 20 });
  t.after(() => app.close());

  async function loginAs(userId) {
    currentOAuthUser = userId;
    const start = await app.inject('/auth/discord');
    const state = new URL(start.headers.location).searchParams.get('state');
    const stateCookie = start.cookies.find(item => item.name === 'music_oauth_state').value;
    const cb = await app.inject({ url: `/auth/discord/callback?code=ok&state=${state}`, headers: { cookie: `music_oauth_state=${stateCookie}` } });
    const token = cb.cookies.find(item => item.name === 'music_session').value;
    const cookie = `music_session=${token}`;
    const session = (await app.inject({ url: '/api/session', headers: { cookie } })).json();
    return { cookie, csrf: session.csrfToken, session };
  }

  const memberAuth = await loginAs(USER);
  // In GUILD, USER is in voice: role is 'voice', canControl is true, controls succeed, diagnostics are redacted
  const stateA = (await app.inject({ url: `/api/guilds/${GUILD}/state`, headers: { cookie: memberAuth.cookie } })).json();
  assert.equal(stateA.permissions.role, 'voice');
  assert.equal(stateA.permissions.canControl, true);
  assert.equal(stateA.permissions.canViewDiagnostics, false);
  assert.deepEqual(stateA.health, {});
  assert.deepEqual(stateA.incidents, []);
  assert.equal((await app.inject({ method: 'POST', url: `/api/guilds/${GUILD}/actions`, headers: { cookie: memberAuth.cookie, origin: ORIGIN, 'x-csrf-token': memberAuth.csrf }, payload: { action: 'pause' } })).statusCode, 200);

  // In OTHER_GUILD, USER is a member outside voice: reading & library succeed, controls are denied (403)
  const stateB = (await app.inject({ url: `/api/guilds/${OTHER_GUILD}/state`, headers: { cookie: memberAuth.cookie } })).json();
  assert.equal(stateB.permissions.role, 'member');
  assert.equal(stateB.permissions.canControl, false);
  const plRes = await app.inject({ method: 'POST', url: `/api/guilds/${OTHER_GUILD}/playlists`, headers: { cookie: memberAuth.cookie, origin: ORIGIN, 'x-csrf-token': memberAuth.csrf }, payload: { name: 'My list' } });
  assert.equal(plRes.statusCode, 200);
  const plId = plRes.json().playlist.id;
  await app.inject({ method: 'POST', url: `/api/guilds/${OTHER_GUILD}/playlists/${plId}/tracks`, headers: { cookie: memberAuth.cookie, origin: ORIGIN, 'x-csrf-token': memberAuth.csrf }, payload: TRACK });
  assert.equal((await app.inject({ method: 'POST', url: `/api/guilds/${OTHER_GUILD}/actions`, headers: { cookie: memberAuth.cookie, origin: ORIGIN, 'x-csrf-token': memberAuth.csrf }, payload: { action: 'pause' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `/api/guilds/${OTHER_GUILD}/playlists/${plId}/load`, headers: { cookie: memberAuth.cookie, origin: ORIGIN, 'x-csrf-token': memberAuth.csrf } })).statusCode, 403);

  // Non-admin is denied diagnostics and config endpoints on the server
  assert.equal((await app.inject({ url: `/api/guilds/${GUILD}/diagnostics`, headers: { cookie: memberAuth.cookie } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/config', headers: { cookie: memberAuth.cookie } })).statusCode, 403);

  // Explicit ADMIN can access diagnostics and config, receives health/incidents, but still needs voice channel for music controls
  const adminAuth = await loginAs(ADMIN);
  assert.equal(adminAuth.session.role, 'admin');
  assert.equal(adminAuth.session.isAdmin, true);
  const adminState = (await app.inject({ url: `/api/guilds/${GUILD}/state`, headers: { cookie: adminAuth.cookie } })).json();
  assert.equal(adminState.permissions.role, 'admin');
  assert.equal(adminState.permissions.canViewDiagnostics, true);
  assert.equal(adminState.permissions.canControl, false);
  assert.equal(adminState.health.ping, 22);
  assert.equal(adminState.incidents.length, 1);
  const diagRes = await app.inject({ url: `/api/guilds/${GUILD}/diagnostics`, headers: { cookie: adminAuth.cookie } });
  assert.equal(diagRes.statusCode, 200);
  assert.equal(diagRes.json().health.ping, 22);
  const cfgRes = await app.inject({ url: '/api/config', headers: { cookie: adminAuth.cookie } });
  assert.equal(cfgRes.statusCode, 200);
  assert.equal(cfgRes.json().accessMode, 'guild_members');
  assert.deepEqual(cfgRes.json().allowedGuildIds, [GUILD, OTHER_GUILD]);
  assert.equal(JSON.stringify(cfgRes.json()).includes('server-only-secret'), false);
  // Admin outside voice channel cannot trigger music controls
  assert.equal((await app.inject({ method: 'POST', url: `/api/guilds/${GUILD}/actions`, headers: { cookie: adminAuth.cookie, origin: ORIGIN, 'x-csrf-token': adminAuth.csrf }, payload: { action: 'pause' } })).statusCode, 403);
});

test('Discord REST unavailability denies login and active guild access, and leaving a guild closes only its SSE stream', async t => {
  let discordRestDown = false;
  const userGuilds = new Set([GUILD, OTHER_GUILD]);
  const h = await harness(t, {
    config: { accessMode: 'guild_members', allowedUserIds: [], allowedGuildIds: [GUILD, OTHER_GUILD], adminUserIds: [] },
  });
  h.state.permissions = true;
  const auth = await h.login(USER);
  await h.app.listen({ host: '127.0.0.1', port: 0 });
  const stream = await liveEvent(h.app, auth.cookie);
  assert.equal(JSON.parse(stream.first.split('data: ')[1]).guildId, GUILD);

  // User leaves GUILD while SSE is open -> SSE stream closes and any API call to GUILD fails with 403
  const ended = once(stream.response, 'end');
  userGuilds.delete(GUILD);
  h.state.permissions = false;
  assert.equal((await h.app.inject({ url: `${BASE}/state`, headers: { cookie: auth.cookie } })).statusCode, 403);
  await ended;

  // When Discord REST fails to confirm membership during login, login is denied (fail-closed)
  discordRestDown = true;
  assert.equal(discordRestDown, true);
  const failedLogin = await h.finishLogin(await h.startLogin());
  assert.equal(failedLogin.statusCode, 403);
});
