const test = require('node:test');
const assert = require('node:assert/strict');
const { createLyricsService } = require('../dist/web/lyrics/service');
const { matchLyrics, cleanLyricsQuery } = require('../dist/web/lyrics/matching');
const QUERY = { title: 'Canción de prueba', artist: 'Artista de prueba', duration: 120 };
// Original, synthetic lyrics only. No real song catalogue is included in the repository.
const RECORD = { id: 1, trackName: QUERY.title, artistName: QUERY.artist, albumName: 'Álbum', duration: 120, instrumental: false, plainLyrics: 'Una línea de prueba\nOtra línea propia', syncedLyrics: '[00:01.00]Una línea de prueba\n[00:02.00]Otra línea propia' };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(t, fetch, options = {}) {
  const service = createLyricsService({ fetch, requestDelayMs: 0, ...options });
  t.after(() => service.close());
  return service;
}

test('lyrics matching validates exact normalized title, artist, duration and source attribution', () => {
  const result = matchLyrics(QUERY, [RECORD]);
  assert.equal(result.status, 'synced');
  assert.deepEqual(result.lines, [{ timeMs: 1000, text: 'Una línea de prueba' }, { timeMs: 2000, text: 'Otra línea propia' }]);
  assert.deepEqual(result.source, { name: 'LRCLIB', url: 'https://lrclib.net', recordId: 1 });
  assert.equal(matchLyrics({ ...QUERY, title: 'CANCION de prueba' }, [RECORD]).status, 'synced');
  assert.equal(matchLyrics({ ...QUERY, duration: 122 }, [RECORD]).status, 'synced');
  assert.equal(matchLyrics({ ...QUERY, duration: 122.01 }, [RECORD]).status, 'ambiguous');
});

test('lyrics normalization strips presentation labels without discarding alternate musical versions', () => {
  const query = { ...QUERY, title: `Artista de prueba - ${QUERY.title} (Official Music Video)`, artist: 'Artista de prueba - Topic' };
  assert.deepEqual(cleanLyricsQuery(query), QUERY);
  assert.equal(matchLyrics(query, [RECORD]).status, 'synced');
  for (const version of ['Remix', 'Cover', 'Live', 'Acoustic', 'Sped Up', 'Slowed', 'Nightcore']) {
    assert.equal(matchLyrics(QUERY, [{ ...RECORD, trackName: `${QUERY.title} (${version})` }]).status, 'ambiguous', version);
    assert.equal(matchLyrics({ ...QUERY, title: `${QUERY.title} (${version})` }, [RECORD]).status, 'ambiguous', version);
  }
});

test('partial metadata, wrong artist, missing duration and incompatible album are ambiguous', () => {
  assert.equal(matchLyrics({ ...QUERY, title: 'Canción' }, [RECORD]).status, 'ambiguous');
  assert.equal(matchLyrics({ ...QUERY, artist: 'Otra persona' }, [RECORD]).status, 'ambiguous');
  assert.equal(matchLyrics({ ...QUERY, duration: 0 }, [RECORD]).status, 'ambiguous');
  assert.equal(matchLyrics({ ...QUERY, album: 'Otro álbum' }, [RECORD]).status, 'ambiguous');
  assert.equal(matchLyrics({ ...QUERY, album: 'Album' }, [RECORD]).status, 'synced');
});

test('competing exact records with different lyrics are ambiguous; identical records are deterministic', () => {
  const other = { ...RECORD, id: 2, syncedLyrics: '[00:01.00]Texto distinto' };
  assert.equal(matchLyrics(QUERY, [RECORD, other]).status, 'ambiguous');
  assert.equal(matchLyrics(QUERY, [{ ...RECORD, id: 2 }, RECORD]).source.recordId, 1);
  assert.equal(matchLyrics(QUERY, []).status, 'not_found');
});

test('plain, instrumental and malformed timed lyrics remain distinct', () => {
  assert.equal(matchLyrics(QUERY, [{ ...RECORD, syncedLyrics: null }]).status, 'plain');
  assert.equal(matchLyrics(QUERY, [{ ...RECORD, instrumental: true, syncedLyrics: null, plainLyrics: null }]).status, 'instrumental');
  assert.equal(matchLyrics(QUERY, [{ ...RECORD, syncedLyrics: '[broken]No timestamps' }]).status, 'plain');
  assert.equal(matchLyrics(QUERY, [{ ...RECORD, syncedLyrics: '[broken]No timestamps', plainLyrics: null }]).status, 'temporary_error');
});

test('provider uses an explicit HTTPS origin, escaped structured parameters, identity header and no redirects', async t => {
  let request;
  const service = harness(t, async (url, options) => { request = { url: new URL(url), options }; return json([RECORD]); });
  assert.equal((await service.findLyrics(QUERY)).status, 'synced');
  assert.equal(request.url.origin, 'https://lrclib.net');
  assert.equal(request.url.pathname, '/api/search');
  assert.equal(request.url.searchParams.get('track_name'), QUERY.title);
  assert.equal(request.options.redirect, 'error');
  assert.match(request.options.headers['User-Agent'], /^SONORA v1\.0 \(https:\/\/github.com\/Ghost3119\/discord-music-bot\)$/);
  await service.findLyrics({ ...QUERY, title: 'http://127.0.0.1/private?token=example' });
  assert.equal(request.url.origin, 'https://lrclib.net');
  assert.equal(request.url.searchParams.get('track_name'), 'http://127.0.0.1/private?token=example');
});

test('provider retries at most once with clean presentation metadata; ordinary not-found makes one request', async t => {
  const titles = [];
  const service = harness(t, async url => { titles.push(new URL(url).searchParams.get('track_name')); return json(titles.length === 1 ? [] : [RECORD]); });
  assert.equal((await service.findLyrics({ ...QUERY, title: `${QUERY.title} (Official Audio)` })).status, 'synced');
  assert.deepEqual(titles, [`${QUERY.title} (Official Audio)`, QUERY.title]);
  let calls = 0;
  const missing = harness(t, async () => { calls++; return json([]); });
  assert.equal((await missing.findLyrics(QUERY)).status, 'not_found');
  assert.equal(calls, 1);
});

test('provider deduplicates concurrent subscribers and cache values cannot be mutated by a caller', async t => {
  const pending = deferred(); let calls = 0;
  const service = harness(t, async () => { calls++; await pending.promise; return json([RECORD]); });
  const first = service.findLyrics(QUERY), second = service.findLyrics(QUERY);
  await tick();
  assert.equal(calls, 1);
  pending.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 'synced'); assert.equal(b.status, 'synced');
  a.lines[0].text = 'Caller mutation';
  assert.equal((await service.findLyrics(QUERY)).lines[0].text, 'Una línea de prueba');
  assert.equal(calls, 1);
});

test('cancelling one shared subscriber preserves the other; cancelling every subscriber aborts upstream', async t => {
  let pending = deferred(); let upstream;
  const service = harness(t, async (_url, options) => { upstream = options.signal; await pending.promise; return json([RECORD]); });
  const controller = new AbortController();
  const first = service.findLyrics(QUERY, controller.signal), second = service.findLyrics(QUERY);
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(upstream.aborted, false);
  pending.resolve(); assert.equal((await second).status, 'synced');
  pending = deferred();
  const stop = new AbortController();
  const next = service.findLyrics({ ...QUERY, title: 'Otra' }, stop.signal);
  await tick();
  stop.abort(); await assert.rejects(next, { name: 'AbortError' });
  assert.equal(upstream.aborted, true);
});

test('different tracks are serialized and pending admission is bounded', async t => {
  const release = deferred(); let calls = 0;
  const service = harness(t, async () => { calls++; if (calls === 1) await release.promise; return json([]); }, { maxPending: 2 });
  const a = service.findLyrics(QUERY), b = service.findLyrics({ ...QUERY, title: 'B' });
  assert.equal((await service.findLyrics({ ...QUERY, title: 'C' })).status, 'temporary_error');
  assert.equal(calls, 1);
  release.resolve(); await Promise.all([a, b]); assert.equal(calls, 2);
});

test('provider honors 429 Retry-After globally and performs no automatic retry storm', async t => {
  let time = 10_000, calls = 0;
  const service = harness(t, async () => { calls++; return calls === 1 ? new Response('edge response is not JSON', { status: 429, headers: { 'Retry-After': '2' } }) : json([RECORD]); }, { now: () => time });
  const result = await service.findLyrics(QUERY);
  assert.deepEqual(result, { status: 'temporary_error', retryAfterMs: 2000 });
  assert.equal((await service.findLyrics({ ...QUERY, title: 'Another' })).status, 'temporary_error');
  assert.equal(calls, 1);
  time += 2001;
  assert.equal((await service.findLyrics(QUERY)).status, 'synced'); assert.equal(calls, 2);
});

test('HTTP-date Retry-After from 503 is honored without relying on an error body', async t => {
  const time = Date.parse('2026-10-16T00:00:00Z'); let calls = 0;
  const service = harness(t, async () => { calls++; return new Response('busy', { status: 503, headers: { 'Retry-After': new Date(time + 5000).toUTCString() } }); }, { now: () => time });
  assert.equal((await service.findLyrics(QUERY)).retryAfterMs, 5000);
  await service.findLyrics({ ...QUERY, title: 'Other' }); assert.equal(calls, 1);
});

test('network failure, server error, non-JSON, malformed JSON and malformed shape are temporary errors', async t => {
  const responses = [
    () => Promise.reject(new Error('secret-internal-token')),
    () => new Response('secret-internal-token', { status: 500 }),
    () => new Response('<html>Not JSON</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    () => json({ redirect: 'http://127.0.0.1/private' }),
    () => json([{ ...RECORD, duration: '120' }]),
    () => json([{ ...RECORD, instrumental: true }]),
    () => json(Array(21).fill(RECORD)),
  ];
  for (const response of responses) {
    const service = harness(t, async () => response());
    const result = await service.findLyrics(QUERY);
    assert.equal(result.status, 'temporary_error'); assert.equal(JSON.stringify(result).includes('secret'), false);
  }
});

test('HTTP 404 is not-found and absent authoritative metadata avoids outbound traffic', async t => {
  let calls = 0;
  const service = harness(t, async () => { calls++; return new Response('', { status: 404 }); });
  assert.equal((await service.findLyrics(QUERY)).status, 'not_found');
  assert.equal((await service.findLyrics({ ...QUERY, duration: 0 })).status, 'ambiguous');
  assert.equal((await service.findLyrics({ ...QUERY, artist: '' })).status, 'ambiguous');
  assert.equal(calls, 1);
});

test('timeouts include a fetch or response stream that never settles', async t => {
  const never = () => new Promise(() => {});
  const service = harness(t, never, { requestTimeoutMs: 15 });
  assert.equal((await service.findLyrics(QUERY)).status, 'temporary_error');
  const streaming = harness(t, async () => new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } }), { requestTimeoutMs: 15 });
  assert.equal((await streaming.findLyrics(QUERY)).status, 'temporary_error');
});

test('lookup deadline covers queue wait; close cancels subscribers and clears future admission', async t => {
  const service = harness(t, () => new Promise(() => {}), { requestTimeoutMs: 1000, lookupTimeoutMs: 15 });
  const a = service.findLyrics(QUERY), b = service.findLyrics({ ...QUERY, title: 'B' });
  assert.equal((await a).status, 'temporary_error'); assert.equal((await b).status, 'temporary_error');
  const close = harness(t, () => new Promise(() => {}));
  const waiting = close.findLyrics(QUERY); close.close();
  await assert.rejects(waiting, { name: 'AbortError' });
  await assert.rejects(close.findLyrics(QUERY), { name: 'AbortError' });
});

test('body size limits apply to advertised and streamed bytes', async t => {
  const advertised = harness(t, async () => new Response('[]', { headers: { 'Content-Type': 'application/json', 'Content-Length': '262145' } }));
  assert.equal((await advertised.findLyrics(QUERY)).status, 'temporary_error');
  const streamed = harness(t, async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(262145)); controller.close(); } }), { headers: { 'Content-Type': 'application/json' } }));
  assert.equal((await streamed.findLyrics(QUERY)).status, 'temporary_error');
});

test('RAM cache expires, bounds entry count and uses a short negative TTL', async t => {
  let time = 1000, calls = 0;
  const service = harness(t, async () => { calls++; return json([]); }, { now: () => time, maxCacheEntries: 1, negativeTtlMs: 100, cacheTtlMs: 1000 });
  await service.findLyrics(QUERY); await service.findLyrics(QUERY); assert.equal(calls, 1);
  time += 101; await service.findLyrics(QUERY); assert.equal(calls, 2);
  await service.findLyrics({ ...QUERY, title: 'B' }); await service.findLyrics(QUERY); assert.equal(calls, 4);
});

test('all cancelled shared requests can be reopened without reusing an aborted flight', async t => {
  let calls = 0;
  const service = harness(t, async () => { calls++; if (calls === 1) return new Promise(() => {}); return json([RECORD]); });
  const controller = new AbortController();
  const first = service.findLyrics(QUERY, controller.signal); await tick(); controller.abort();
  await assert.rejects(first, { name: 'AbortError' }); await tick();
  assert.equal((await service.findLyrics(QUERY)).status, 'synced'); assert.equal(calls, 2);
});




test('cache keys preserve version, duration and album so different recordings never share lyrics', async t => {
  const requests = [];
  const service = harness(t, async url => { requests.push(new URL(url)); return json([RECORD]); });
  assert.equal((await service.findLyrics(QUERY)).status, 'synced');
  assert.equal((await service.findLyrics({ ...QUERY, title: `${QUERY.title} (Live)` })).status, 'ambiguous');
  assert.equal((await service.findLyrics({ ...QUERY, duration: 180 })).status, 'ambiguous');
  assert.equal((await service.findLyrics({ ...QUERY, album: 'Other album' })).status, 'ambiguous');
  assert.equal(requests.length, 4);
  assert.equal((await service.findLyrics(QUERY)).status, 'synced');
  assert.equal(requests.length, 4);
});
