const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebServer } = require('../dist/web/server');
const { openWebDatabase } = require('../dist/web/database');
const {
  createMusicSearchService,
  validateMusicSearchQuery,
  normalizeSearchEntry,
} = require('../dist/web/musicSearch');

const USER = '111111111111111111';
const OTHER = '222222222222222222';
const GUILD = '333333333333333333';
const OTHER_GUILD = '444444444444444444';
const ORIGIN = 'http://127.0.0.1:8080';
const BASE = `/api/guilds/${GUILD}`;

function makeYtEntry(index, overrides = {}) {
  const id = overrides.id ?? `ytvid${String(index).padStart(6, '0')}`;
  return {
    id,
    title: overrides.title !== undefined ? overrides.title : `Song ${index}`,
    uploader: overrides.uploader !== undefined ? overrides.uploader : `Artist ${index} - Topic`,
    channel: overrides.channel !== undefined ? overrides.channel : `Artist ${index} - Topic`,
    duration: overrides.duration !== undefined ? overrides.duration : 180 + index,
    thumbnails:
      overrides.thumbnails !== undefined
        ? overrides.thumbnails
        : [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 360 }],
    webpage_url:
      overrides.webpage_url !== undefined
        ? overrides.webpage_url
        : `https://www.youtube.com/watch?v=${id}`,
    ...overrides,
  };
}

function makeScEntry(index, overrides = {}) {
  const id = overrides.id ?? `9900${index}`;
  return {
    id,
    title: overrides.title !== undefined ? overrides.title : `SoundCloud Track ${index}`,
    uploader: overrides.uploader !== undefined ? overrides.uploader : `SC Uploader ${index}`,
    artists: overrides.artists !== undefined ? overrides.artists : [`SC Artist ${index}`],
    duration: overrides.duration !== undefined ? overrides.duration : 210 + index,
    thumbnails:
      overrides.thumbnails !== undefined
        ? overrides.thumbnails
        : [
            { url: `https://i1.sndcdn.com/artworks-${id}-mini.jpg`, width: 16, height: 16 },
            { url: `https://i1.sndcdn.com/artworks-${id}-t500x500.jpg`, width: 500, height: 500 },
          ],
    webpage_url:
      overrides.webpage_url !== undefined
        ? overrides.webpage_url
        : `https://soundcloud.com/artist-${index}/track-${index}`,
    ...overrides,
  };
}

async function createTestHarness(t, overrides = {}) {
  const state = {
    time: 1_700_000_000_000,
    oauthUser: USER,
    permissions: new Set([GUILD]),
    inVoice: true,
    ytDlpCalls: [],
    ytDlpHandler: null,
    controlCalls: [],
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
        throw Object.assign(new Error('Guild access denied'), {
          statusCode: 403,
          errorCode: 'GUILD_ACCESS_DENIED',
        });
      }
    },
    async listGuilds() {
      return [...state.permissions].map((id) => ({ id, name: `Server ${id}`, icon: null }));
    },
    async getPermissions(_userId, guildId) {
      if (!state.permissions.has(guildId)) {
        throw Object.assign(new Error('Guild access denied'), {
          statusCode: 403,
          errorCode: 'GUILD_ACCESS_DENIED',
        });
      }
      return {
        role: state.inVoice ? 'voice' : 'member',
        isMember: true,
        inVoiceChannel: state.inVoice,
        canControl: state.inVoice,
        isAdmin: false,
        canRead: true,
        canManageLibrary: true,
        canViewDiagnostics: false,
        canManageConfig: false,
      };
    },
    async getState(_userId, guildId) {
      return {
        guildId,
        status: 'idle',
        current: null,
        queue: [],
        currentTime: 0,
        volume: 80,
        repeat: 0,
        voice: state.inVoice ? { id: '999', name: 'General', members: 2 } : null,
        health: {},
        incidents: [],
      };
    },
    async control(userId, guildId, action) {
      if (!state.inVoice) {
        throw Object.assign(new Error('Join voice channel'), {
          statusCode: 403,
          errorCode: 'CONTROL_CHANNEL_REQUIRED',
        });
      }
      state.controlCalls.push({ userId, guildId, action });
    },
    ...overrides.bridge,
  };

  const oauthFetch = async (input) => {
    const url = String(input);
    if (url.includes('youtube.com/oembed')) {
      return new Response(
        JSON.stringify({
          title: 'LUNA',
          author_name: 'Feid - Topic',
          thumbnail_url: 'https://i.ytimg.com/vi/aqs0aXBBC8g/hqdefault.jpg',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const musicSearchService =
    overrides.musicSearchService ||
    createMusicSearchService({
      fetch: overrides.fetch || oauthFetch,
      providerTimeoutMs: overrides.providerTimeoutMs ?? 5_000,
      cacheTtlMs: overrides.cacheTtlMs ?? 60_000,
      maxConcurrentSearches: overrides.maxConcurrentSearches ?? 6,
      runYtDlp: async (input, flags, signal) => {
        state.ytDlpCalls.push({ input, flags });
        if (state.ytDlpHandler) {
          return await state.ytDlpHandler(input, flags, signal);
        }
        if (String(input).startsWith('https://music.youtube.com/search')) {
          return {
            entries: [
              {
                id: 'aqs0aXBBC8g',
                title: 'LUNA',
                url: 'https://music.youtube.com/watch?v=aqs0aXBBC8g',
                _type: 'url',
              },
            ],
          };
        }
        if (String(input).startsWith('ytsearch')) {
          return {
            entries: [makeYtEntry(1, { id: 'x2oUajHp8pg', title: 'Feid - LUNA (Official Video)' })],
          };
        }
        if (String(input).startsWith('scsearch')) {
          return {
            entries: [makeScEntry(1, { title: 'LUNA (SoundCloud Edit)' })],
          };
        }
        return { entries: [] };
      },
    });

  const app = await createWebServer({
    config,
    bridge,
    database: db,
    now: () => state.time,
    oauthFetch: overrides.fetch || oauthFetch,
    musicOperationTimeoutMs: overrides.musicOperationTimeoutMs ?? 5_000,
    musicSearchService,
  });

  t.after(async () => {
    await app.close();
    if (db.sqlite.open) db.close();
  });

  function createUserSession(userId = USER) {
    const created = db.createSession(
      { id: userId, username: `user-${userId}`, avatar: null },
      state.time,
      config.sessionTtlMs,
    );
    return {
      cookie: `music_session=${created.token}`,
      csrf: created.csrfToken,
    };
  }

  return { app, db, state, createUserSession, musicSearchService };
}

test('searches YouTube, YouTube Music, and SoundCloud individually and normalizes metadata', async (t) => {
  const h = await createTestHarness(t);
  const auth = h.createUserSession();

  // 1. YouTube Music search enriches artist via oEmbed and cleans "- Topic"
  const ytmRes = await h.app.inject({
    method: 'GET',
    url: `${BASE}/search?q=Feid+Luna&platform=youtube_music`,
    headers: { cookie: auth.cookie },
  });
  assert.equal(ytmRes.statusCode, 200);
  const ytmBody = ytmRes.json();
  assert.equal(ytmBody.platform, 'youtube_music');
  assert.equal(ytmBody.partial, false);
  assert.equal(ytmBody.results.length, 1);
  assert.equal(ytmBody.results[0].platform, 'youtube_music');
  assert.equal(ytmBody.results[0].source, 'youtube');
  assert.equal(ytmBody.results[0].artist, 'Feid');
  assert.equal(ytmBody.results[0].channel, 'Feid - Topic');
  assert.equal(ytmBody.results[0].url, 'https://www.youtube.com/watch?v=aqs0aXBBC8g');
  assert.equal(
    ytmBody.results[0].thumbnail,
    'https://i.ytimg.com/vi/aqs0aXBBC8g/hqdefault.jpg',
  );

  // 2. YouTube search
  const ytRes = await h.app.inject({
    method: 'GET',
    url: `${BASE}/search?q=Feid+Luna&platform=youtube`,
    headers: { cookie: auth.cookie },
  });
  assert.equal(ytRes.statusCode, 200);
  const ytBody = ytRes.json();
  assert.equal(ytBody.platform, 'youtube');
  assert.equal(ytBody.results.length, 1);
  assert.equal(ytBody.results[0].platform, 'youtube');
  assert.equal(ytBody.results[0].source, 'youtube');
  assert.equal(ytBody.results[0].artist, 'Artist 1');
  assert.equal(ytBody.results[0].duration, 181);

  // 3. SoundCloud search
  const scRes = await h.app.inject({
    method: 'GET',
    url: `${BASE}/search?q=Feid+Luna&platform=soundcloud`,
    headers: { cookie: auth.cookie },
  });
  assert.equal(scRes.statusCode, 200);
  const scBody = scRes.json();
  assert.equal(scBody.platform, 'soundcloud');
  assert.equal(scBody.results.length, 1);
  assert.equal(scBody.results[0].platform, 'soundcloud');
  assert.equal(scBody.results[0].source, 'soundcloud');
  assert.equal(scBody.results[0].artist, 'SC Artist 1');
  assert.equal(scBody.results[0].channel, 'SC Uploader 1');
  assert.equal(
    scBody.results[0].thumbnail,
    'https://i1.sndcdn.com/artworks-99001-t500x500.jpg',
  );
});

test('validates empty queries, special characters, and blocks arbitrary URLs / SSRF attempts', async () => {
  // Empty queries rejected
  assert.throws(() => validateMusicSearchQuery({ query: '' }), /Introduce una canción/);
  assert.throws(() => validateMusicSearchQuery({ query: '    ' }), /Introduce una canción/);
  assert.throws(() => validateMusicSearchQuery({ query: null }), /Introduce una canción/);

  // Arbitrary URLs / SSRF blocked
  for (const forbidden of [
    'https://169.254.169.254/latest/meta-data',
    'http://localhost:8080/admin',
    'file:///etc/passwd',
    'https://www.youtube.com/watch?v=x2oUajHp8pg',
    'music.youtube.com/playlist?list=PL123',
    '//internal.service/api',
  ]) {
    assert.throws(
      () => validateMusicSearchQuery({ query: forbidden }),
      /en lugar de un enlace/,
      `Should block URL: ${forbidden}`,
    );
  }

  // Special characters & version tags preserved
  const special = validateMusicSearchQuery({
    query: '  Rosalía & Rauw — Beso (Official Live Acoustic Remix / Cover) [Instrumental]  ',
    platform: 'youtube_music',
    limit: '10',
  });
  assert.equal(
    special.query,
    'Rosalía & Rauw — Beso (Official Live Acoustic Remix / Cover) [Instrumental]',
  );
  assert.equal(special.platform, 'youtube_music');
  assert.equal(special.limit, 10);
});

test('preserves version tags (Remix, Live, Acoustic, Cover, Instrumental) and handles missing thumbnails', () => {
  const ytEntry = normalizeSearchEntry(
    {
      id: 'v1234567890',
      title: 'Daoko × Kenshi Yonezu - Fireworks (Live Acoustic Remix Cover Instrumental)',
      uploader: 'Daoko - Topic',
      duration: 245,
      thumbnails: [],
      thumbnail: null,
    },
    'youtube',
  );
  assert.ok(ytEntry);
  assert.equal(
    ytEntry.title,
    'Daoko × Kenshi Yonezu - Fireworks (Live Acoustic Remix Cover Instrumental)',
  );
  assert.equal(ytEntry.artist, 'Daoko');
  assert.equal(ytEntry.channel, 'Daoko - Topic');
  assert.equal(ytEntry.thumbnail, 'https://i.ytimg.com/vi/v1234567890/hqdefault.jpg');

  // SoundCloud entry without thumbnail stays null (never invents a YouTube cover)
  const scEntry = normalizeSearchEntry(
    {
      id: '777',
      title: 'Midnight Synth (VIP Mix)',
      uploader: 'Nightwave',
      webpage_url: 'https://soundcloud.com/nightwave/midnight-synth-vip-mix',
      thumbnails: [{ url: 'https://evil.example.com/tracker.jpg' }],
    },
    'soundcloud',
  );
  assert.ok(scEntry);
  assert.equal(scEntry.thumbnail, null);
  assert.equal(scEntry.artist, 'Nightwave');
});

test('returns 200 with empty results when no songs match (not a technical error)', async (t) => {
  const h = await createTestHarness(t);
  h.state.ytDlpHandler = async () => ({ entries: [] });
  const auth = h.createUserSession();

  const res = await h.app.inject({
    method: 'GET',
    url: `${BASE}/search?q=xyznonexistenttrack999&platform=all`,
    headers: { cookie: auth.cookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(body.results, []);
  assert.equal(body.partial, false);
  assert.equal(body.providers.length, 3);
  assert.ok(body.providers.every((p) => p.ok && p.count === 0));
});

test('returns partial results when one provider fails in "all" mode and 502/504 when all fail', async (t) => {
  const h = await createTestHarness(t, { providerTimeoutMs: 120 });
  const auth = h.createUserSession();

  // Case 1: SoundCloud fails, YouTube Music & YouTube succeed -> 200 partial: true
  h.state.ytDlpHandler = async (input) => {
    if (String(input).startsWith('scsearch')) {
      throw new Error('SoundCloud extractor error');
    }
    if (String(input).startsWith('https://music.youtube.com')) {
      return { entries: [makeYtEntry(1, { id: 'sharedId001', duration: 0, title: 'Shared Song' })] };
    }
    return {
      entries: [
        makeYtEntry(1, { id: 'sharedId001', duration: 195, title: 'Shared Song' }),
        makeYtEntry(2, { id: 'uniqueYt002', duration: 210, title: 'Second Song' }),
      ],
    };
  };

  const partialRes = await h.app.inject({
    method: 'GET',
    url: `${BASE}/search?q=Shared+Song&platform=all`,
    headers: { cookie: auth.cookie },
  });
  assert.equal(partialRes.statusCode, 200);
  const partialBody = partialRes.json();
  assert.equal(partialBody.partial, true);
  // Deduplicated sharedId001 between youtube_music and youtube, enriched with duration 195!
  assert.equal(partialBody.results.length, 2);
  assert.equal(partialBody.results[0].sourceId, 'sharedId001');
  assert.equal(partialBody.results[0].platform, 'youtube_music');
  assert.equal(partialBody.results[0].duration, 195);
  const scProvider = partialBody.providers.find((p) => p.platform === 'soundcloud');
  assert.equal(scProvider.ok, false);

  // Case 2: Single provider fails -> 502
  const failRes = await h.app.inject({
    method: 'GET',
    url: `${BASE}/search?q=Fail+Track&platform=soundcloud`,
    headers: { cookie: auth.cookie },
  });
  assert.equal(failRes.statusCode, 502);

  // Case 3: Timeout -> 504
  h.state.ytDlpHandler = async (_input, _flags, signal) => {
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
  const timeoutRes = await h.app.inject({
    method: 'GET',
    url: `${BASE}/search?q=Slow+Track&platform=youtube`,
    headers: { cookie: auth.cookie },
  });
  assert.equal(timeoutRes.statusCode, 504);
});

test('deduplicates concurrent identical requests and supports per-caller cancellation', async () => {
  let extractorCalls = 0;
  const service = createMusicSearchService({
    runYtDlp: async (_input, _flags, signal) => {
      extractorCalls += 1;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 60);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('Aborted'));
          },
          { once: true },
        );
      });
      return { entries: [makeYtEntry(1, { id: 'concId00001', title: 'Concurrent Track' })] };
    },
  });

  const c1 = new AbortController();
  const c2 = new AbortController();
  const p1 = service.search({ query: 'Concurrent Track', platform: 'youtube' }, c1.signal);
  const p2 = service.search({ query: 'Concurrent Track', platform: 'youtube' }, c2.signal);

  // Cancel caller 1 while caller 2 continues
  c1.abort();
  await assert.rejects(p1, /cancelada/);
  const res2 = await p2;
  assert.equal(res2.results.length, 1);
  assert.equal(extractorCalls, 1);
});

test('enforces authentication, guild isolation, voice-independent search, and rate limits', async (t) => {
  const h = await createTestHarness(t);
  const auth = h.createUserSession(USER);

  // 1. Unauthenticated -> 401
  const unauth = await h.app.inject({
    method: 'GET',
    url: `${BASE}/search?q=Feid`,
  });
  assert.equal(unauth.statusCode, 401);

  // 2. Unauthorized guild (guild isolation) -> 403
  const forbiddenGuild = await h.app.inject({
    method: 'GET',
    url: `/api/guilds/${OTHER_GUILD}/search?q=Feid`,
    headers: { cookie: auth.cookie },
  });
  assert.equal(forbiddenGuild.statusCode, 403);

  // 3. Member not in voice channel can still search and save to favorites/playlists, but cannot play
  h.state.inVoice = false;
  const searchNoVoice = await h.app.inject({
    method: 'GET',
    url: `${BASE}/search?q=Feid&platform=youtube`,
    headers: { cookie: auth.cookie },
  });
  assert.equal(searchNoVoice.statusCode, 200);
  const foundTrack = searchNoVoice.json().results[0];

  const favRes = await h.app.inject({
    method: 'POST',
    url: `${BASE}/favorites`,
    headers: {
      cookie: auth.cookie,
      origin: ORIGIN,
      'x-csrf-token': auth.csrf,
    },
    payload: {
      url: foundTrack.url,
      title: foundTrack.title,
      artist: foundTrack.artist,
      duration: foundTrack.duration,
      thumbnail: foundTrack.thumbnail,
      source: foundTrack.source,
    },
  });
  assert.equal(favRes.statusCode, 200);

  const playNoVoice = await h.app.inject({
    method: 'POST',
    url: `${BASE}/actions`,
    headers: {
      cookie: auth.cookie,
      origin: ORIGIN,
      'x-csrf-token': auth.csrf,
    },
    payload: {
      action: 'play',
      query: foundTrack.url,
      track: {
        url: foundTrack.url,
        title: foundTrack.title,
        artist: foundTrack.artist,
        duration: foundTrack.duration,
        thumbnail: foundTrack.thumbnail,
        source: foundTrack.source,
      },
    },
  });
  assert.equal(playNoVoice.statusCode, 403);

  // 4. Rate limit on search endpoint (max 30 per minute)
  let status429 = false;
  for (let i = 0; i < 35; i++) {
    const r = await h.app.inject({
      method: 'GET',
      url: `${BASE}/search?q=Feid&platform=youtube`,
      headers: { cookie: auth.cookie },
    });
    if (r.statusCode === 429) {
      status429 = true;
      break;
    }
  }
  assert.equal(status429, true);
});
