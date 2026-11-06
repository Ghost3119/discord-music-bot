const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { Client, GatewayIntentBits } = require('discord.js');
const { DisTube } = require('distube');
const { createMusicBridge } = require('../dist/music/webBridge');
const { requestPlayback } = require('../dist/music/playbackRequest');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
const { runYtDlp } = require('../dist/music/ytDlpRunner');
const { playbackQuery, publicPlaybackUrl, extractionInput } = require('../dist/music/mediaPolicy');
const { musicAction, sanitizeThumbnailUrl } = require('../dist/web/validation');
const { readWebConfig } = require('../dist/web/config');
const { createWebServer } = require('../dist/web/server');
const { openWebDatabase, hashToken } = require('../dist/web/database');

const USER = '111111111111111111', OTHER = '222222222222222222', GUILD = '333333333333333333';
const BASE = `/api/guilds/${GUILD}`, ORIGIN = 'http://127.0.0.1:8080';
const config = () => readWebConfig({ WEB_ENABLED: 'true', CLIENT_ID: USER, WEB_CLIENT_SECRET: 'fixture-only', WEB_ALLOWED_USER_IDS: `${USER},${OTHER}`, WEB_DATABASE_PATH: ':memory:' });
const track = 'https://www.youtube.com/watch?v=AAAAAAAAAAA';

test('public playback inputs reject private destinations and parser/option bypasses before any HTTP or extractor call', async t => {
  let hits = 0, plays = 0, searches = 0;
  const server = http.createServer((_req, reply) => { hits++; reply.writeHead(302, { location: '/private' }); reply.end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const target = `http://127.0.0.1:${server.address().port}/private`;
  const plugin = new YtDlpSearchPlugin();
  plugin.searchSong = async () => { searches++; throw new Error('Search must not start'); };
  const distube = { plugins: [plugin], getQueue: () => undefined, play: async () => { plays++; } };
  const inputs = [target, target.replace('http:', 'ht\ttp:'), target.replace('http:', 'ht\ntp:'), target.replace('http:', 'ht\rtp:'),
    'http://169.254.169.254/latest/meta-data/', 'https://localhost/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/',
    'https://2130706433/', 'https://0177.0.0.1/', 'https://0x7f000001/', 'https://10.0.0.1/', 'https://172.16.0.1/', 'https://192.168.1.1/',
    'https://youtube.com.attacker.test/watch?v=AAAAAAAAAAA', 'https://youtube.com@127.0.0.1/',
    'https://www.youtube.com:8443/watch?v=AAAAAAAAAAA', 'https://www.youtube.com/redirect?q=http://127.0.0.1/',
    'https:\\127.0.0.1\\private', '//127.0.0.1/private', '--exec=bad', ' --cookies=secret', 'ytsearch999999:x', 'scsearch5:x', 'x'.repeat(501), 'song\u0000name'];
  for (const query of inputs) {
    assert.throws(() => playbackQuery(query), undefined, JSON.stringify(query));
    assert.throws(() => musicAction({ action: 'play', query }));
    await assert.rejects(requestPlayback(distube, { guildId: GUILD, member: { voice: {} }, voiceChannel: { id: 'voice' }, query, searchSource: 'youtube', authorize() {} }));
    assert.equal(plugin.validate(query), false);
    await assert.rejects(plugin.resolve(query, {}));
    if (!/^scsearch5:/.test(query)) await assert.rejects(runYtDlp(query));
  }
  assert.equal(hits, 0); assert.equal(plays, 0); assert.equal(searches, 0);
});

test('public providers, playlists and bounded internal search fallbacks remain supported', () => {
  const urls = [track, 'https://m.youtube.com/watch?v=AAAAAAAAAAA', 'https://youtu.be/AAAAAAAAAAA', 'https://www.youtube.com/shorts/AAAAAAAAAAA',
    'https://music.youtube.com/watch?v=AAAAAAAAAAA&list=RDAAAAAAAAAAA', 'https://www.youtube.com/playlist?list=PLABCDEFGHIJK',
    'https://soundcloud.com/artist/song', 'https://soundcloud.com/artist/sets/album',
    'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'https://open.spotify.com/intl-es/album/4uLU6hMCjMI75M1A2tKUQC',
    'https://music.apple.com/mx/album/album/123456789?i=123456790', 'https://music.apple.com/mx/song/song/123456790'];
  for (const url of urls) assert.match(playbackQuery(url), /^https:/);
  assert.equal(playbackQuery('  Artist - canción  '), 'Artist - canción');
  assert.equal(extractionInput('ytsearch5:Artist - canción'), 'ytsearch5:Artist - canción');
  assert.equal(extractionInput('scsearch5:Artist - canción'), 'scsearch5:Artist - canción');
  assert.match(extractionInput('https://music.youtube.com/search?q=Artist#songs'), /#songs$/);
  assert.throws(() => publicPlaybackUrl('https://music.youtube.com/search?q=Artist#songs'));
  assert.throws(() => extractionInput('ytsearch99:Artist'));
});

test('production allowlist configuration with no guild filter completes OAuth and serves real bridge state; guild_members stays closed', async t => {
  t.mock.method(console, 'info', () => {});
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] }); t.after(() => client.destroy());
  client.distube = new DisTube(client, { plugins: [new YtDlpSearchPlugin()] });
  const member = { id: USER, user: { bot: false }, voice: {} };
  client.guilds.cache.set(GUILD, { id: GUILD, name: 'Fixture guild', iconURL: () => null, members: { fetch: async () => member } });
  const settings = { ...config(), databasePath: ':memory:' };
  assert.deepEqual(settings.allowedGuildIds, []); assert.deepEqual(settings.adminUserIds, []);
  const bridge = createMusicBridge(client, undefined, { accessMode: settings.accessMode, allowedGuildIds: settings.allowedGuildIds, adminUserIds: settings.adminUserIds });
  const app = await createWebServer({ config: settings, bridge, oauthFetch: async url => new Response(JSON.stringify(url.endsWith('/token') ? { token_type: 'Bearer', access_token: 'fixture-only' } : { id: USER, username: 'Fixture', avatar: null })) });
  t.after(() => app.close());
  const start = await app.inject('/auth/discord');
  const state = new URL(start.headers.location).searchParams.get('state');
  const finish = await app.inject({ url: `/auth/discord/callback?state=${state}&code=fixture`, headers: { cookie: `music_oauth_state=${start.cookies.find(c => c.name === 'music_oauth_state').value}` } });
  assert.equal(finish.statusCode, 302);
  const cookie = finish.cookies.filter(c => c.name === 'music_session' || c.name === 'music_csrf').map(c => `${c.name}=${c.value}`).join('; ');
  assert.equal((await app.inject({ url: '/api/session', headers: { cookie } })).json().isAdmin, false);
  assert.equal((await app.inject({ url: '/api/guilds', headers: { cookie } })).json().guilds.length, 1);
  const result = await app.inject({ url: `${BASE}/state`, headers: { cookie } });
  assert.equal(result.statusCode, 200); assert.equal(result.json().permissions.canViewDiagnostics, false);
  assert.equal((await app.inject({ url: `${BASE}/diagnostics`, headers: { cookie } })).statusCode, 403);
  await assert.rejects(createMusicBridge(client, undefined, { accessMode: 'guild_members', allowedGuildIds: [] }).getState(USER, GUILD), { errorCode: 'GUILD_ACCESS_DENIED' });
});

test('independent random CSRF survives database reopen semantics, login revokes old tokens and logout-all revokes the user', async t => {
  t.mock.method(console, 'info', () => {});
  const db = openWebDatabase(':memory:'); t.after(() => db.close());
  const settings = config(), user = { id: USER, username: 'Fixture', avatar: null };
  const first = db.createSession(user, Date.now(), 60_000), second = db.createSession(user, Date.now(), 60_000);
  assert.equal(db.getSession(first.token, Date.now()), null);
  assert.notEqual(second.csrfToken, hashToken(`dashboard-csrf:${second.token}`));
  const row = db.sqlite.prepare('SELECT * FROM web_sessions').get();
  assert.equal(row.csrf_hash, hashToken(second.csrfToken)); assert.equal(JSON.stringify(row).includes(second.csrfToken), false);
  const app = await createWebServer({ config: settings, database: db, bridge: { listGuilds: async () => [], assertGuildAccess: async () => {} } });
  t.after(() => app.close());
  const cookie = `music_session=${second.token}; music_csrf=${second.csrfToken}`;
  assert.equal((await app.inject({ url: '/api/session', headers: { cookie } })).json().csrfToken, second.csrfToken);
  const revoked = await app.inject({ method: 'POST', url: '/auth/logout/all', headers: { cookie, origin: ORIGIN, 'x-csrf-token': second.csrfToken } });
  assert.equal(revoked.statusCode, 200); assert.equal(db.getSession(second.token, Date.now()), null);
  const legacy = db.createSession(user, Date.now(), 60_000);
  db.sqlite.prepare('UPDATE web_sessions SET csrf_hash = ? WHERE token_hash = ?').run(hashToken(hashToken(`dashboard-csrf:${legacy.token}`)), hashToken(legacy.token));
  assert.equal(db.getSession(legacy.token, Date.now()), null, 'Legacy deterministic CSRF sessions require reauthentication');
});

test('authenticated route budgets separate users behind one proxy and block navigations from triggering egress', async t => {
  t.mock.method(console, 'info', () => {});
  const db = openWebDatabase(':memory:'); t.after(() => db.close());
  let fetches = 0;
  const app = await createWebServer({ config: config(), database: db, bridge: { assertGuildAccess: async () => {}, listGuilds: async () => [] }, oauthFetch: async () => { fetches++; return new Response('{}'); } });
  t.after(() => app.close());
  const session = id => { const created = db.createSession({ id, username: 'Fixture', avatar: null }, Date.now(), 60_000); return { cookie: `music_session=${created.token}; music_csrf=${created.csrfToken}`, 'x-csrf-token': created.csrfToken }; };
  const a = session(USER), b = session(OTHER);
  for (const route of [`${BASE}/tracks/resolve?url=${encodeURIComponent(track)}`, `${BASE}/search?q=Artist`, `${BASE}/search/suggestions?q=Artist`, `${BASE}/lyrics/current`, `${BASE}/lyrics/selection?id=1`]) {
    assert.equal((await app.inject({ url: route, headers: { cookie: a.cookie } })).statusCode, 403);
  }
  assert.equal(fetches, 0);
  for (let i = 0; i < 30; i++) assert.equal((await app.inject({ url: '/api/session', headers: a })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/session', headers: a })).statusCode, 429);
  assert.equal((await app.inject({ url: '/api/session', headers: b })).statusCode, 200);
  // Cookie spoofing is not enough to obtain a separate user bucket.
  for (let i = 0; i < 20; i++) await app.inject({ url: `${BASE}/tracks/resolve?url=${encodeURIComponent(track)}`, headers: a });
  assert.equal((await app.inject({ url: `${BASE}/tracks/resolve?url=${encodeURIComponent(track)}`, headers: a })).statusCode, 429);
  assert.equal((await app.inject({ url: `${BASE}/tracks/resolve?url=${encodeURIComponent(track)}`, headers: b })).statusCode, 200);
  for (let i = 0; i < 118; i++) assert.equal((await app.inject({ url: '/api/guilds', headers: b })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/guilds', headers: b })).statusCode, 429, 'The aggregate user budget includes requests with separate route budgets');
});

test('public binding needs explicit opt-in and artwork only accepts known HTTPS origins', () => {
  const env = { WEB_ENABLED: 'true', CLIENT_ID: USER, WEB_CLIENT_SECRET: 'fixture-only', WEB_ALLOWED_USER_IDS: USER, WEB_ORIGIN: 'https://music.example', WEB_HOST: '0.0.0.0' };
  assert.throws(() => readWebConfig(env), /WEB_BIND_PUBLIC/);
  assert.equal(readWebConfig({ ...env, WEB_BIND_PUBLIC: 'true' }).bindPublic, true);
  assert.equal(config().sessionTtlMs, 24 * 3_600_000);
  for (const value of ['http://i.ytimg.com/cover.jpg', 'https://127.0.0.1/cover.jpg', 'data:image/png;base64,AAAA', 'https://i.ytimg.com.attacker.test/cover.jpg']) assert.equal(sanitizeThumbnailUrl(value), null);
  assert.equal(sanitizeThumbnailUrl('https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg?sig=secret'), 'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg');
});

test('encoded route aliases retain authentication, origin, CSRF and library authorization', async t => {
  t.mock.method(console, 'info', () => {});
  const db = openWebDatabase(':memory:'); t.after(() => db.close());
  const session = db.createSession({ id: USER, username: 'Fixture', avatar: null }, Date.now(), 60_000);
  let fetches = 0, searches = 0;
  const app = await createWebServer({ config: config(), database: db,
    bridge: { assertGuildAccess: async () => {}, listGuilds: async () => [], getPermissions: async () => ({ canControl: false, canManageLibrary: false }) },
    oauthFetch: async () => { fetches++; return new Response('{}'); },
    musicSearchService: { validateQuery() {}, search: async () => { searches++; return { tracks: [] }; } },
  });
  t.after(() => app.close());
  const cookie = `music_session=${session.token}; music_csrf=${session.csrfToken}`;
  const resolve = `/%61pi/guilds/${GUILD}/tracks/resolve?url=${encodeURIComponent(track)}`;
  const anonymous = await app.inject(resolve);
  assert.equal(anonymous.statusCode, 401); assert.equal(anonymous.headers['cache-control'], 'no-store');
  assert.equal((await app.inject({ url: `${BASE}/%73earch?q=Artist`, headers: { cookie } })).statusCode, 403);
  assert.equal((await app.inject({ url: resolve, headers: { cookie, origin: 'https://attacker.test' } })).statusCode, 403);
  assert.equal(fetches, 0); assert.equal(searches, 0);
  assert.equal((await app.inject({ url: `${BASE}/%73earch?q=Artist`, headers: { cookie, 'x-csrf-token': session.csrfToken } })).statusCode, 200);
  assert.equal(searches, 1);
  assert.equal((await app.inject({ method: 'POST', url: `${BASE}/%70laylists`, headers: { cookie, origin: ORIGIN, 'x-csrf-token': session.csrfToken }, payload: { name: 'Forbidden' } })).statusCode, 403);
});

test('OAuth PKCE binds the verifier to one state and HTTPS session cookies use __Host-', async t => {
  t.mock.method(console, 'info', () => {});
  const origin = 'https://music.example';
  let challenge, exchangedVerifier;
  const app = await createWebServer({ config: { ...config(), databasePath: ':memory:', origin, oauthRedirectUri: origin + '/auth/discord/callback', secureCookies: true },
    bridge: { listGuilds: async () => [], assertGuildAccess: async () => {} },
    oauthFetch: async (url, options) => {
      if (url.endsWith('/token')) {
        exchangedVerifier = options.body.get('code_verifier');
        assert.match(exchangedVerifier, /^[A-Za-z0-9_-]{43}$/);
        assert.equal(createHash('sha256').update(exchangedVerifier).digest('base64url'), challenge);
        return new Response(JSON.stringify({ access_token: 'fixture-only', token_type: 'Bearer' }));
      }
      return new Response(JSON.stringify({ id: USER, username: 'Fixture', avatar: null }));
    },
  });
  t.after(() => app.close());
  const start = await app.inject('/auth/discord'), url = new URL(start.headers.location);
  challenge = url.searchParams.get('code_challenge');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('code_verifier'), false);
  const next = await app.inject('/auth/discord');
  assert.notEqual(challenge, new URL(next.headers.location).searchParams.get('code_challenge'));
  const callback = `/auth/discord/callback?code=fixture&state=${url.searchParams.get('state')}`;
  const stateCookie = `music_oauth_state=${start.cookies.find(c => c.name === 'music_oauth_state').value}`;
  const finish = await app.inject({ url: callback, headers: { cookie: stateCookie } });
  assert.equal(finish.statusCode, 302); assert.notEqual(exchangedVerifier, url.searchParams.get('state'));
  for (const name of ['__Host-music_session', '__Host-music_csrf']) {
    const cookie = finish.cookies.find(c => c.name === name);
    assert.equal(cookie.secure, true); assert.equal(cookie.httpOnly, true); assert.equal(cookie.path, '/'); assert.equal(cookie.domain, undefined);
  }
  assert.equal((await app.inject({ url: callback, headers: { cookie: stateCookie } })).statusCode, 400);
  assert.equal(finish.headers['strict-transport-security'], 'max-age=31536000');
});
