const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createWebServer } = require('../dist/web/server');
const { openWebDatabase } = require('../dist/web/database');
const {
  createPlaylistImportService,
  parsePlaylistImportUrl,
  parsePlaylistImportCsv,
  SpotifyPlaylistImportAdapter,
  YouTubePlaylistImportAdapter,
} = require('../dist/web/playlistImport');

const USER = '111111111111111111';
const OTHER = '222222222222222222';
const GUILD = '333333333333333333';
const OTHER_GUILD = '444444444444444444';
const ORIGIN = 'http://127.0.0.1:8080';
const BASE = `/api/guilds/${GUILD}`;

function makeEntry(index, overrides = {}) {
  const id = overrides.id ?? `vid${String(index).padStart(8, '0')}`;
  return {
    id,
    title: overrides.title !== undefined ? overrides.title : `Track ${index}`,
    uploader: overrides.uploader !== undefined ? overrides.uploader : `Artist ${index} - Topic`,
    duration: overrides.duration !== undefined ? overrides.duration : 180 + index,
    thumbnails:
      overrides.thumbnails !== undefined
        ? overrides.thumbnails
        : [{ url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, width: 320, height: 180 }],
    webpage_url: overrides.webpage_url !== undefined ? overrides.webpage_url : `https://www.youtube.com/watch?v=${id}`,
    ...overrides,
  };
}

async function createTestHarness(t, overrides = {}) {
  const state = {
    time: 1_700_000_000_000,
    oauthUser: USER,
    permissions: new Set([GUILD, OTHER_GUILD]),
    ytDlpCalls: [],
    ytDlpHandler: null,
  };
  const db = overrides.database || openWebDatabase(':memory:');
  const config = {
    enabled: true,
    host: '127.0.0.1',
    port: 8080,
    origin: ORIGIN,
    oauthClientId: '555555555555555555',
    oauthClientSecret: 'server-only-secret',
    oauthRedirectUri: `${ORIGIN}/auth/discord/callback`,
    allowedUserIds: [USER, OTHER],
    databasePath: ':memory:',
    sessionTtlMs: 60_000,
    secureCookies: false,
    ...overrides.config,
  };
  const bridge = {
    async assertGuildAccess(_userId, guildId) {
      if (!state.permissions.has(guildId)) {
        throw Object.assign(new Error('Guild access denied'), { statusCode: 403 });
      }
    },
    async listGuilds() {
      return [...state.permissions].map(id => ({ id, name: `Server ${id}`, icon: null }));
    },
    async getState(_userId, guildId) {
      return {
        guildId,
        status: 'idle',
        current: null,
        queue: [],
        currentTime: 0,
        volume: 50,
        repeat: 0,
        voice: null,
        health: {},
        incidents: [],
      };
    },
    async control() {},
  };
  const oauthFetch = async url => {
    if (String(url).endsWith('/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer' }));
    }
    return new Response(JSON.stringify({ id: state.oauthUser, username: 'Importer', avatar: null }));
  };
  const playlistImportService =
    overrides.playlistImportService ||
    createPlaylistImportService({
      pageSize: overrides.pageSize ?? 50,
      maxTracks: overrides.maxTracks ?? 500,
      runYtDlp: async (input, flags, signal) => {
        state.ytDlpCalls.push({ input, flags, signal });
        if (state.ytDlpHandler) {
          return state.ytDlpHandler(input, flags, signal);
        }
        return {
          id: 'PL_DEFAULT',
          title: 'Default Playlist',
          uploader: 'Curator - Topic',
          playlist_count: 2,
          thumbnails: [{ url: 'https://i.ytimg.com/vi/vid00000001/hqdefault.jpg', width: 480, height: 360 }],
          entries: [makeEntry(1), makeEntry(2)],
        };
      },
    });

  const app = await createWebServer({
    config,
    bridge,
    database: db,
    oauthFetch,
    now: () => state.time,
    sseIntervalMs: 20,
    musicOperationTimeoutMs: overrides.musicOperationTimeoutMs ?? 5_000,
    playlistImportService,
  });

  t.after(async () => {
    await app.close();
    if (!overrides.database && db.sqlite.open) db.close();
  });

  async function login(userId = USER) {
    state.oauthUser = userId;
    const start = await app.inject('/auth/discord');
    const stateVal = new URL(start.headers.location).searchParams.get('state');
    const stateCookie = start.cookies.find(item => item.name === 'music_oauth_state').value;
    const finish = await app.inject({
      url: `/auth/discord/callback?code=code123&state=${stateVal}`,
      headers: { cookie: `music_oauth_state=${stateCookie}` },
    });
    const token = finish.cookies.find(item => item.name === 'music_session').value;
    const cookie = `music_session=${token}`;
    const session = (await app.inject({ url: '/api/session', headers: { cookie } })).json();
    return { cookie, csrf: session.csrfToken };
  }

  async function mutate(auth, method, url, payload, extraHeaders = {}) {
    return app.inject({
      method,
      url,
      headers: {
        cookie: auth.cookie,
        origin: ORIGIN,
        'x-csrf-token': auth.csrf,
        ...extraHeaders,
      },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  return { app, db, state, login, mutate };
}

test('URL validation accepts valid YouTube and YouTube Music playlist links and rejects invalid/private/arbitrary URLs', () => {
  const yt = parsePlaylistImportUrl('https://www.youtube.com/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i');
  assert.equal(yt.platform, 'youtube');
  assert.equal(yt.playlistId, 'PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i');
  assert.equal(yt.canonicalUrl, 'https://www.youtube.com/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i');

  const ytm = parsePlaylistImportUrl(
    'https://music.youtube.com/playlist?list=OLAK5uy_m8B3J9N0123456789abcdef&si=tracking',
  );
  assert.equal(ytm.platform, 'youtube_music');
  assert.equal(ytm.playlistId, 'OLAK5uy_m8B3J9N0123456789abcdef');
  assert.equal(ytm.canonicalUrl, 'https://www.youtube.com/playlist?list=OLAK5uy_m8B3J9N0123456789abcdef');
  assert.equal(ytm.sourceUrl, 'https://music.youtube.com/playlist?list=OLAK5uy_m8B3J9N0123456789abcdef');

  const watchWithList = parsePlaylistImportUrl(
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890abcdef',
  );
  assert.equal(watchWithList.platform, 'youtube_music');
  assert.equal(watchWithList.playlistId, 'PL1234567890abcdef');

  const spotify = parsePlaylistImportUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(spotify.platform, 'spotify');
  assert.equal(spotify.playlistId, '37i9dQZF1DXcBWIGoYBM5M');

  // Rejections
  for (const invalid of [
    '',
    'not-a-url',
    'http://www.youtube.com/playlist?list=PL1234567890',
    'https://user:pass@www.youtube.com/playlist?list=PL1234567890',
    'https://www.youtube.com:8443/playlist?list=PL1234567890',
    'https://www.youtube.com/playlist?list=PL1234567890#frag',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://evil.example.com/playlist?list=PL1234567890',
    'https://127.0.0.1/playlist?list=PL1234567890',
    'file:///etc/passwd',
  ]) {
    assert.throws(() => parsePlaylistImportUrl(invalid), /enlace|URL|playlist/i);
  }

  // Account-only private playlists (WL / LL / LM)
  for (const privateId of ['WL', 'LL', 'LM']) {
    assert.throws(
      () => parsePlaylistImportUrl(`https://music.youtube.com/playlist?list=${privateId}`),
      err => err.statusCode === 403,
    );
  }
});

test('preview endpoint extracts YouTube and YouTube Music playlists with pagination, >100 tracks, duplicates, missing thumbnails and incomplete metadata', async t => {
  const h = await createTestHarness(t, { pageSize: 50, maxTracks: 500 });
  const auth = await h.login();

  // Generate 120 tracks across 3 pages (1..50, 51..100, 101..150)
  // Including intentional duplicate at index 5 & 6, missing thumbnail at index 2, incomplete metadata at index 3, and private/deleted video at index 4
  const allEntries = Array.from({ length: 120 }, (_, idx) => {
    const num = idx + 1;
    if (num === 2) {
      // Missing thumbnails array -> should fallback to youtubeThumbnail(id)
      return makeEntry(num, { thumbnails: [], thumbnail: undefined });
    }
    if (num === 3) {
      // Incomplete metadata (no artist, no duration, no title)
      return makeEntry(num, { title: '', uploader: '', channel: '', duration: null });
    }
    if (num === 4) {
      // Deleted video (partial failure / unavailable entry) -> omitted while keeping rest
      return makeEntry(num, { title: '[Deleted video]' });
    }
    if (num === 6) {
      // Intentional duplicate of entry 5
      return makeEntry(5);
    }
    return makeEntry(num);
  });

  h.state.ytDlpHandler = async (_input, flags) => {
    const start = (flags.playlistStart ?? 1) - 1;
    const end = flags.playlistEnd ?? allEntries.length;
    return {
      id: 'PL_120_ITEMS',
      title: 'Sesión Nocturna YTM',
      uploader: 'DJ Sonora - Topic',
      playlist_count: 120,
      thumbnails: [{ url: 'https://i.ytimg.com/vi/playlistcover/hqdefault.jpg', width: 600, height: 600 }],
      entries: allEntries.slice(start, end),
    };
  };

  const res = await h.mutate(auth, 'POST', `${BASE}/playlists/import/preview`, {
    url: 'https://music.youtube.com/playlist?list=PL_120_ITEMS',
  });
  assert.equal(res.statusCode, 200, res.body);
  const { preview } = res.json();

  // Verify 3 paginated flat-playlist calls were made (1..50, 51..100, 101..150)
  assert.equal(h.state.ytDlpCalls.length, 3);
  assert.equal(h.state.ytDlpCalls[0].flags.flatPlaylist, true);
  assert.equal(h.state.ytDlpCalls[0].flags.playlistStart, 1);
  assert.equal(h.state.ytDlpCalls[0].flags.playlistEnd, 50);
  assert.equal(h.state.ytDlpCalls[1].flags.playlistStart, 51);
  assert.equal(h.state.ytDlpCalls[1].flags.playlistEnd, 100);
  assert.equal(h.state.ytDlpCalls[2].flags.playlistStart, 101);
  assert.equal(h.state.ytDlpCalls[2].flags.playlistEnd, 150);

  assert.equal(preview.platform, 'youtube_music');
  assert.equal(preview.title, 'Sesión Nocturna YTM');
  assert.equal(preview.author, 'DJ Sonora');
  assert.equal(preview.totalCount, 120);
  assert.equal(preview.importedCount, 119); // 120 - 1 deleted video
  assert.equal(preview.omittedCount, 1);
  assert.equal(preview.truncated, false);
  assert.equal(preview.tracks.length, 119);

  // Entry 1 has its own thumbnail (not the playlist cover)
  assert.equal(preview.tracks[0].thumbnail, 'https://i.ytimg.com/vi/vid00000001/mqdefault.jpg');
  assert.notEqual(preview.tracks[0].thumbnail, preview.thumbnail);

  // Entry 2 had missing thumbnails -> fallback to standard YouTube video thumbnail, NOT playlist cover
  assert.equal(preview.tracks[1].thumbnail, 'https://i.ytimg.com/vi/vid00000002/hqdefault.jpg');

  // Entry 3 had incomplete metadata -> safe fallbacks
  assert.equal(preview.tracks[2].title, 'YouTube (vid00000003)');
  assert.equal(preview.tracks[2].artist, 'Artista desconocido');
  assert.equal(preview.tracks[2].duration, 0);

  // Intentional duplicate preserved (Entry 5 and Entry 6 both have vid00000005, at positions 3 and 4 after skipping deleted entry 4)
  assert.equal(preview.tracks[3].sourceId, 'vid00000005');
  assert.equal(preview.tracks[4].sourceId, 'vid00000005');
  assert.equal(preview.tracks[3].position, 3);
  assert.equal(preview.tracks[4].position, 4);
});

test('preview endpoint handles private playlist, empty playlist, Spotify stub, timeout and cancellation', async t => {
  const h = await createTestHarness(t, { musicOperationTimeoutMs: 120 });
  const auth = await h.login();

  // 1. Private playlist
  h.state.ytDlpHandler = async () => {
    throw new Error('ERROR: [youtube:tab] PL_PRIV: YouTube said: This playlist is private.');
  };
  const privRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import/preview`, {
    url: 'https://www.youtube.com/playlist?list=PL_PRIVATE_LIST',
  });
  assert.equal(privRes.statusCode, 403);
  assert.match(privRes.json().error, /privada/i);

  // 2. Empty playlist
  h.state.ytDlpHandler = async () => ({
    id: 'PL_EMPTY',
    title: 'Empty List',
    entries: [],
  });
  const emptyRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import/preview`, {
    url: 'https://www.youtube.com/playlist?list=PL_EMPTY_LIST',
  });
  assert.equal(emptyRes.statusCode, 422);
  assert.match(emptyRes.json().error, /vacía/i);

  // 3. Playlist where all entries are unavailable/deleted
  h.state.ytDlpHandler = async () => ({
    id: 'PL_ALL_DELETED',
    title: 'Dead List',
    entries: [makeEntry(1, { title: '[Deleted video]' }), makeEntry(2, { title: '[Private video]' })],
  });
  const deadRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import/preview`, {
    url: 'https://www.youtube.com/playlist?list=PL_DEAD_LIST',
  });
  assert.equal(deadRes.statusCode, 422);

  // 4. Spotify URL returns 501 stub message
  const spotifyRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import/preview`, {
    url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
  });
  assert.equal(spotifyRes.statusCode, 501);
  assert.match(spotifyRes.json().error, /Spotify/i);

  // 5. Timeout returns 504
  h.state.ytDlpHandler = async (_input, _flags, signal) => {
    await once(signal, 'abort');
    signal.throwIfAborted();
  };
  const timeoutRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import/preview`, {
    url: 'https://www.youtube.com/playlist?list=PL_SLOW_LIST',
  });
  assert.equal(timeoutRes.statusCode, 504);

  // 6. Client disconnect / cancellation aborts extractor signal immediately
  await h.app.listen({ host: '127.0.0.1', port: 0 });
  let extractorStarted;
  let extractorAborted;
  const startedPromise = new Promise(resolve => { extractorStarted = resolve; });
  const abortedPromise = new Promise(resolve => { extractorAborted = resolve; });
  h.state.ytDlpHandler = async (_input, _flags, signal) => {
    extractorStarted();
    await once(signal, 'abort');
    extractorAborted(signal.aborted);
    signal.throwIfAborted();
  };
  const req = http.request({
    host: '127.0.0.1',
    port: h.app.server.address().port,
    path: `${BASE}/playlists/import/preview`,
    method: 'POST',
    headers: {
      cookie: auth.cookie,
      origin: ORIGIN,
      'x-csrf-token': auth.csrf,
      'content-type': 'application/json',
    },
  });
  req.on('error', () => {});
  req.end(JSON.stringify({ url: 'https://www.youtube.com/playlist?list=PL_CANCEL_TEST' }));
  await startedPromise;
  req.destroy();
  const wasAborted = await abortedPromise;
  assert.equal(wasAborted, true);
});

test('commit endpoint saves 100+ tracks atomically in order, rolls back on partial failure, and prevents double-click duplicates', async t => {
  const h = await createTestHarness(t);
  const auth = await h.login();

  const tracks120 = Array.from({ length: 120 }, (_, idx) => {
    const num = idx + 1;
    const id = `vid${String(num).padStart(8, '0')}`;
    return {
      url: `https://www.youtube.com/watch?v=${id}`,
      title: `Canción ${num}`,
      artist: `Artista ${num}`,
      duration: 200 + num,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      source: 'youtube',
    };
  });

  // 1. Atomic failure policy: if track #85 has an invalid/malicious URL, NO playlist or tracks are created
  const corrupted = tracks120.map((item, idx) =>
    idx === 84 ? { ...item, url: 'https://evil.example/audio.mp3' } : item,
  );
  const badRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import`, {
    name: 'Corrupted Import',
    tracks: corrupted,
    requestId: 'req-corrupt-1',
  });
  assert.equal(badRes.statusCode, 400);
  assert.equal(h.db.listPlaylists(USER, GUILD).length, 0);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS count FROM playlist_tracks').get().count, 0);

  // 2. Valid commit of 120 tracks + intentional duplicate at the end
  const withDuplicate = [...tracks120, tracks120[0]];
  const goodRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import`, {
    name: 'Colección Importada 121',
    tracks: withDuplicate,
    requestId: 'req-valid-121',
  });
  assert.equal(goodRes.statusCode, 200, goodRes.body);
  const saved = goodRes.json().playlist;
  assert.equal(saved.name, 'Colección Importada 121');
  assert.equal(saved.tracks.length, 121);
  assert.equal(saved.tracks[0].title, 'Canción 1');
  assert.equal(saved.tracks[119].title, 'Canción 120');
  assert.equal(saved.tracks[120].title, 'Canción 1');
  assert.notEqual(saved.tracks[0].id, saved.tracks[120].id);

  // Verify database persistence and contiguous positions 0..120
  const dbPlaylists = h.db.listPlaylists(USER, GUILD);
  assert.equal(dbPlaylists.length, 1);
  assert.equal(dbPlaylists[0].tracks.length, 121);
  const positions = h.db.sqlite
    .prepare('SELECT position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC')
    .all(saved.id)
    .map(r => r.position);
  assert.deepEqual(
    positions,
    Array.from({ length: 121 }, (_, i) => i),
  );

  // 3. Double-click with same requestId returns the exact same playlist without creating a duplicate
  const duplicateClickRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import`, {
    name: 'Colección Importada 121',
    tracks: withDuplicate,
    requestId: 'req-valid-121',
  });
  assert.equal(duplicateClickRes.statusCode, 200);
  assert.equal(duplicateClickRes.json().playlist.id, saved.id);
  assert.equal(h.db.listPlaylists(USER, GUILD).length, 1);
});

test('security: unauthorized users, missing CSRF, and guild isolation are enforced on import endpoints', async t => {
  const h = await createTestHarness(t);
  const auth = await h.login(USER);
  const otherAuth = await h.login(OTHER);

  // Unauthenticated
  assert.equal(
    (
      await h.app.inject({
        method: 'POST',
        url: `${BASE}/playlists/import/preview`,
        headers: { origin: ORIGIN },
        payload: { url: 'https://www.youtube.com/playlist?list=PL1234567890' },
      })
    ).statusCode,
    401,
  );

  // Bad CSRF
  assert.equal(
    (
      await h.mutate(
        auth,
        'POST',
        `${BASE}/playlists/import/preview`,
        { url: 'https://www.youtube.com/playlist?list=PL1234567890' },
        { 'x-csrf-token': '0'.repeat(64) },
      )
    ).statusCode,
    403,
  );

  // Import into GUILD as USER
  const imported = await h.mutate(auth, 'POST', `${BASE}/playlists/import`, {
    name: 'Solo para USER en GUILD',
    tracks: [
      {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Track 1',
        artist: 'Artist 1',
        duration: 210,
        thumbnail: null,
        source: 'youtube',
      },
    ],
  });
  assert.equal(imported.statusCode, 200);

  // OTHER user in GUILD cannot see USER's imported playlist
  assert.equal(h.db.listPlaylists(OTHER, GUILD).length, 0);
  // USER in OTHER_GUILD cannot see GUILD's imported playlist
  assert.equal(h.db.listPlaylists(USER, OTHER_GUILD).length, 0);

  // Revoke GUILD access -> both preview and import return 403
  h.state.permissions.delete(GUILD);
  assert.equal(
    (
      await h.mutate(otherAuth, 'POST', `${BASE}/playlists/import/preview`, {
        url: 'https://www.youtube.com/playlist?list=PL1234567890',
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await h.mutate(otherAuth, 'POST', `${BASE}/playlists/import`, {
        name: 'Denied',
        tracks: [
          {
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            title: 'Track 1',
            artist: 'Artist 1',
            duration: 210,
            thumbnail: null,
            source: 'youtube',
          },
        ],
      })
    ).statusCode,
    403,
  );
});

test('SpotifyPlaylistImportAdapter resolves authorized Spotify playlists with pagination, omits local/podcast items, and maps 401/403/404/429 errors', async () => {
  const parsed = parsePlaylistImportUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');

  // 1. Paginated authorized Spotify playlist with local track, podcast episode, and intentional duplicate
  const calls = [];
  const adapter = new SpotifyPlaylistImportAdapter({
    accessToken: 'spotify-test-token',
    pageSize: 2,
    maxTracks: 500,
    fetchImpl: async url => {
      calls.push(String(url));
      const str = String(url);
      if (str.endsWith('/playlists/37i9dQZF1DXcBWIGoYBM5M')) {
        return new Response(
          JSON.stringify({
            id: '37i9dQZF1DXcBWIGoYBM5M',
            name: 'Viva Latino Authorized',
            owner: { display_name: 'Spotify Tester' },
            images: [{ url: 'https://i.scdn.co/image/ab67706f0000000211111111', width: 640, height: 640 }],
            tracks: {
              total: 5,
              items: [
                {
                  is_local: false,
                  track: {
                    id: '1IHWl5LamUGEuP4ozKQSXZ',
                    name: 'Tití Me Preguntó',
                    type: 'track',
                    duration_ms: 243000,
                    artists: [{ name: 'Bad Bunny' }],
                    album: {
                      name: 'Un Verano Sin Ti',
                      images: [{ url: 'https://i.scdn.co/image/ab67616d0000b27322222222', width: 300, height: 300 }],
                    },
                  },
                },
                {
                  is_local: true,
                  track: { id: 'local1', name: 'Local File', type: 'track' },
                },
                {
                  is_local: false,
                  track: { id: 'ep12345678901234567890', name: 'Podcast Episode', type: 'episode' },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (str.includes('offset=3')) {
        return new Response(
          JSON.stringify({
            total: 5,
            next: null,
            items: [
              {
                is_local: false,
                track: {
                  id: '4LRPiXqCikLlN15c3yImP7',
                  name: 'As It Was',
                  type: 'track',
                  duration_ms: 167303,
                  artists: [{ name: 'Harry Styles' }],
                  album: { name: "Harry's House", images: [] },
                },
              },
              {
                is_local: false,
                track: {
                  id: '1IHWl5LamUGEuP4ozKQSXZ',
                  name: 'Tití Me Preguntó',
                  type: 'track',
                  duration_ms: 243000,
                  artists: [{ name: 'Bad Bunny' }],
                  album: { name: 'Un Verano Sin Ti', images: [] },
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    },
  });

  const preview = await adapter.resolvePlaylist(parsed, new AbortController().signal);
  assert.equal(calls.length, 2);
  assert.equal(preview.platform, 'spotify');
  assert.equal(preview.title, 'Viva Latino Authorized');
  assert.equal(preview.author, 'Spotify Tester');
  assert.equal(preview.thumbnail, 'https://i.scdn.co/image/ab67706f0000000211111111');
  assert.equal(preview.totalCount, 5);
  assert.equal(preview.importedCount, 3);
  assert.equal(preview.omittedCount, 2);
  assert.equal(preview.tracks[0].url, 'https://open.spotify.com/track/1IHWl5LamUGEuP4ozKQSXZ');
  assert.equal(preview.tracks[0].source, 'spotify');
  assert.equal(preview.tracks[0].album, 'Un Verano Sin Ti');
  assert.equal(preview.tracks[0].duration, 243);
  assert.equal(preview.tracks[1].title, 'As It Was');
  assert.equal(preview.tracks[2].sourceId, '1IHWl5LamUGEuP4ozKQSXZ'); // Intentional duplicate preserved

  // 2. HTTP error mapping (401, 403, 404, 429)
  for (const [status, expectedCode] of [
    [401, 'SPOTIFY_NOT_CONNECTED'],
    [403, 'SPOTIFY_INSUFFICIENT_PERMISSIONS'],
    [404, 'SPOTIFY_PLAYLIST_INACCESSIBLE'],
    [429, 'SPOTIFY_RATE_LIMITED'],
  ]) {
    const errAdapter = new SpotifyPlaylistImportAdapter({
      accessToken: 'tok',
      fetchImpl: async () => new Response('{}', { status }),
    });
    await assert.rejects(
      () => errAdapter.resolvePlaylist(parsed, new AbortController().signal),
      err => err.statusCode === status && err.errorCode === expectedCode,
    );
  }
});

test('CSV import parses Exportify, standard SONORA, and semicolon CSVs, validates security limits, and saves/loads tracks', async t => {
  const playedQueries = [];
  const h = await createTestHarness(t);
  h.app; // ensure server ready
  const auth = await h.login();

  // 1. Exportify Spotify CSV format (Track URI, Track Name, Artist Name(s), Album Name, Duration (ms)) + invalid/local rows omitted
  const exportifyCsv = [
    '\uFEFF"Track URI","Track Name","Artist Name(s)","Album Name","Duration (ms)"',
    '"spotify:track:1IHWl5LamUGEuP4ozKQSXZ","Tití Me Preguntó","Bad Bunny","Un Verano Sin Ti","243000"',
    '"spotify:track:4LRPiXqCikLlN15c3yImP7","As It Was","Harry Styles; Guest Artist","Harry""s House","167303"',
    '"spotify:local:artist:album:Song:180","Local Song","Local Artist","Local Album","180000"',
    '"http://127.0.0.1:8080/internal","SSRF Attempt","Evil","Hack","120000"',
    '"","Missing Title Row","","Album","100000"',
  ].join('\r\n');

  const csvPreviewRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import/csv`, {
    csv: exportifyCsv,
    sourceName: 'mi_exportify_spotify.csv',
  });
  assert.equal(csvPreviewRes.statusCode, 200, csvPreviewRes.body);
  const { preview } = csvPreviewRes.json();
  assert.equal(preview.platform, 'csv');
  assert.equal(preview.title, 'mi exportify spotify');
  assert.equal(preview.totalCount, 5);
  assert.equal(preview.importedCount, 2);
  assert.equal(preview.omittedCount, 3);
  assert.equal(preview.tracks[0].url, 'https://open.spotify.com/track/1IHWl5LamUGEuP4ozKQSXZ');
  assert.equal(preview.tracks[0].source, 'spotify');
  assert.equal(preview.tracks[0].duration, 243);
  assert.equal(preview.tracks[1].artist, 'Harry Styles, Guest Artist');
  assert.equal(preview.tracks[1].album, 'Harry"s House');
  assert.equal(preview.tracks[1].duration, 167);

  // 2. Manual Spanish semicolon CSV without URLs -> uses canonical search URLs and commits transactionally
  const manualCsv = [
    'Título;Artista;Álbum;Duración',
    'Ojitos Lindos;Bad Bunny, Bomba Estéreo;Un Verano Sin Ti;04:18',
    'Provenza;Karol G;Mañana Será Bonito;210',
  ].join('\n');

  const manualPreviewRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import/csv`, {
    csv: manualCsv,
    name: 'Lista Manual CSV',
  });
  assert.equal(manualPreviewRes.statusCode, 200, manualPreviewRes.body);
  const manualPreview = manualPreviewRes.json().preview;
  assert.equal(manualPreview.title, 'Lista Manual CSV');
  assert.equal(manualPreview.tracks.length, 2);
  assert.equal(manualPreview.tracks[0].source, 'csv');
  assert.equal(manualPreview.tracks[0].duration, 258);
  assert.match(manualPreview.tracks[0].url, /^https:\/\/music\.youtube\.com\/search\?q=/);

  // Commit the CSV tracks via the existing transactional import endpoint
  const commitRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import`, {
    name: manualPreview.title,
    tracks: manualPreview.tracks,
    requestId: 'csv-commit-1',
  });
  assert.equal(commitRes.statusCode, 200, commitRes.body);
  const savedPlaylist = commitRes.json().playlist;
  assert.equal(savedPlaylist.tracks.length, 2);
  assert.equal(savedPlaylist.tracks[0].source, 'csv');

  // 3. Reject missing columns, malformed quotes, and oversized CSV
  const badColsRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import/csv`, {
    csv: 'foo,bar\n1,2',
  });
  assert.equal(badColsRes.statusCode, 400);
  assert.equal(badColsRes.json().code, 'CSV_MISSING_COLUMNS');

  const unclosedQuoteRes = await h.mutate(auth, 'POST', `${BASE}/playlists/import/csv`, {
    csv: 'Title,Artist\n"Unclosed title,Bad Bunny',
  });
  assert.equal(unclosedQuoteRes.statusCode, 400);
  assert.equal(unclosedQuoteRes.json().code, 'CSV_MALFORMED');

  assert.throws(
    () => parsePlaylistImportCsv({ csv: 'Title,Artist\n' + 'a,b\n'.repeat(70_000) }),
    err => err.statusCode === 413 && err.errorCode === 'CSV_TOO_LARGE',
  );
});
