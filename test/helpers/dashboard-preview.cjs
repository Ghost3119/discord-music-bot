// Explicit QA fixture: no Discord client, credentials, external OAuth or production data.
// Run after build: node test/helpers/dashboard-preview.cjs
const path = require('node:path');
const { createWebServer } = require('../../dist/web/server');
const { openWebDatabase } = require('../../dist/web/database');
const port = 4174;
const userId = '100000000000000001';
const guildId = '100000000000000002';
const database = openWebDatabase(':memory:');
const song = (id, title, artist, duration) => ({ id, title, artist, duration, url: `https://www.youtube.com/watch?v=${id}`, thumbnail: null, source: 'youtube' });
const snapshot = {
  guildId, status: 'playing', current: song('dQw4w9WgXcQ', 'Midnight City', 'M83', 244),
  queue: [song('AAAAAAAAAAA', 'Something About Us', 'Daft Punk', 232), song('BBBBBBBBBBB', 'Space Song', 'Beach House', 320), song('CCCCCCCCCCC', 'Tadow', 'Masego & FKJ', 301)],
  currentTime: 78, volume: 65, repeat: 0, voice: { id: '100000000000000003', name: 'Lounge', members: 4 },
  health: { connected: true, ping: 42, voiceConnected: true, mode: 'playing', attempts: 0, recentFailures: 0, monitor: true, breaker: true, lastProgressAt: new Date().toISOString() }, incidents: [],
};
const bridge = {
  async assertGuildAccess(user, guild) { if (user !== userId || guild !== guildId) throw Object.assign(new Error('Forbidden'), { statusCode: 403 }); },
  async listGuilds() { return [{ id: guildId, name: 'The Listening Room', icon: null }]; },
  async getState() { return structuredClone(snapshot); },
  async control(_user, _guild, action) {
    switch (action.action) {
      case 'pause': snapshot.status = 'paused'; break;
      case 'resume': snapshot.status = 'playing'; break;
      case 'skip': snapshot.current = snapshot.queue.shift() ?? null; snapshot.currentTime = 0; break;
      case 'stop': snapshot.current = null; snapshot.queue = []; snapshot.status = 'idle'; break;
      case 'volume': snapshot.volume = action.volume; break;
      case 'repeat': snapshot.repeat = action.mode; break;
      case 'remove': snapshot.queue.splice(action.index - 1, 1); break;
      case 'move': snapshot.queue.splice(action.to - 1, 0, snapshot.queue.splice(action.from - 1, 1)[0]); break;
      case 'shuffle': snapshot.queue.reverse(); break;
      case 'play': snapshot.queue.push(song('DDDDDDDDDDD', action.query, 'Vista de prueba', 240)); break;
    }
  },
};

(async () => {
  const config = { enabled: true, host: '127.0.0.1', port, origin: `http://127.0.0.1:${port}`, oauthClientId: userId,
    oauthClientSecret: 'qa-fixture-not-a-credential', oauthRedirectUri: `http://127.0.0.1:${port}/auth/discord/callback`, allowedUserIds: [userId],
    databasePath: ':memory:', sessionTtlMs: 3600000, secureCookies: false, staticRoot: path.resolve(__dirname, '../../frontend/dist') };
  const app = await createWebServer({ config, bridge, database });
  // Fastify is ready already: this fixture uses a second small login server to set
  // a host cookie and redirect into the real API/static server on another port.
  const session = database.createSession({ id: userId, username: 'Alex · vista de prueba', avatar: null }, Date.now(), 3600000);
  const playlist = database.createPlaylist(userId, guildId, 'Noches sin prisa', Date.now());
  for (const item of [snapshot.current, ...snapshot.queue]) {
    const { id: _id, ...metadata } = item;
    database.addPlaylistTrack(userId, guildId, playlist.id, metadata);
  }
  const { id: _favoriteId, ...favorite } = snapshot.queue[1];
  database.addFavorite(userId, guildId, favorite, Date.now());
  const login = require('node:http').createServer((_request, response) => {
    response.writeHead(302, { 'Set-Cookie': `music_session=${session.token}; Path=/; HttpOnly; SameSite=Lax`, Location: `http://127.0.0.1:${port}` }); response.end();
  });
  await app.listen({ host: config.host, port });
  login.listen(4175, '127.0.0.1', () => console.log('QA fixture: http://127.0.0.1:4175 (simulated music, in-memory SQLite)'));
  const close = async () => { login.close(); await app.close(); database.close(); };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
})().catch(error => { console.error(error); database.close(); process.exitCode = 1; });
