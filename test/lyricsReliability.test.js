const test = require('node:test');
const assert = require('node:assert/strict');
const { createLyricsService } = require('../dist/web/lyrics/service');
const { matchLyrics, cleanLyricsQuery } = require('../dist/web/lyrics/matching');
const QUERY = { title: 'Facts (Charlie Heat Version)', artist: 'Kanye West', duration: 200 };
// Public metadata, exclusively synthetic lyric content.
const RECORD = { id: 1, trackName: QUERY.title, artistName: QUERY.artist, albumName: 'Album', duration: 200, instrumental: false, plainLyrics: 'Texto original de prueba', syncedLyrics: '[00:01]Texto original de prueba' };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function service(t, fetch, options = {}) {
  const result = createLyricsService({ fetch, requestDelayMs: 0, ...options });
  t.after(() => result.close()); return result;
}

test('realistic search body above 256KiB and null-duration siblings preserve a valid exact record', async t => {
  const records = Array.from({ length: 20 }, (_, index) => ({ ...RECORD, id: index + 1, duration: index > 17 ? null : 200, plainLyrics: 'Texto propio '.repeat(1300), syncedLyrics: null, lyricsfile: 'additional provider metadata' }));
  assert.ok(Buffer.byteLength(JSON.stringify(records)) > 262144);
  const result = await service(t, async () => json(records)).findLyrics(QUERY);
  assert.equal(result.status, 'plain');
  assert.equal(result.source.recordId, 1);
});

test('a malformed sibling does not poison valid records; all malformed records remain invalid', async t => {
  const mixed = service(t, async () => json([{ ...RECORD, duration: '200' }, RECORD]));
  assert.equal((await mixed.findLyrics(QUERY)).status, 'synced');
  const invalid = service(t, async () => json([{ ...RECORD, duration: '200' }]));
  assert.equal((await invalid.findLyrics(QUERY)).reason, 'invalid_response');
});

test('imprecise duration returns unique plain content and never unverified timestamps', () => {
  const result = matchLyrics({ ...QUERY, duration: 208, durationReliable: false }, [RECORD]);
  assert.equal(result.status, 'plain');
  assert.equal(result.diagnostics.decision, 'duration_plain_fallback');
  assert.equal(matchLyrics({ ...QUERY, duration: 208, durationReliable: false }, [RECORD, { ...RECORD, id: 2, plainLyrics: 'Different synthetic content' }]).status, 'ambiguous');
  assert.equal(matchLyrics({ ...QUERY, duration: 208 }, [RECORD]).status, 'ambiguous');
  assert.equal(matchLyrics({ ...QUERY, duration: 300 }, [RECORD]).status, 'ambiguous');
});

test('album live markers and named alternative versions cannot silently acquire studio timestamps', () => {
  assert.equal(matchLyrics(QUERY, [{ ...RECORD, albumName: 'Live at Festival 2024' }]).status, 'ambiguous');
  assert.equal(matchLyrics({ ...QUERY, title: 'Facts (Other Version)' }, [RECORD]).status, 'ambiguous');
  assert.equal(matchLyrics(QUERY, [{ ...RECORD, trackName: 'Facts' }]).status, 'ambiguous');
});

test('distribution labels, Unicode and explicit collaboration delimiters normalize conservatively', () => {
  const query = { title: 'Beyoncé - Canción (Official Audio)', artist: 'Beyoncé - Topic', duration: 100 };
  assert.deepEqual(cleanLyricsQuery(query), { title: 'Canción', artist: 'Beyoncé', duration: 100 });
  assert.equal(matchLyrics({ title: 'Canción feat. Guest', artist: 'Beyoncé', duration: 100 }, [{ ...RECORD, trackName: 'Canción (feat. Guest)', artistName: 'Beyoncé', duration: 100 }]).status, 'synced');
});

test('manual search and selection use fixed destinations, metadata-only results and shared caches', async t => {
  const requests = [];
  const api = service(t, async url => { requests.push(new URL(url)); return json(new URL(url).pathname === '/api/search' ? [RECORD, { ...RECORD, id: 2, duration: null }] : RECORD); });
  const [a, b] = await Promise.all([api.searchLyrics(QUERY), api.searchLyrics(QUERY)]);
  assert.deepEqual(a, b); assert.equal(a.status, 'results'); assert.equal(a.candidates[1].duration, null);
  assert.equal(JSON.stringify(a).includes(RECORD.plainLyrics), false);
  assert.equal(requests.length, 1);
  const selected = await api.selectLyrics(1);
  assert.equal(selected.status, 'synced'); assert.equal(selected.source.recordId, 1);
  assert.equal((await api.selectLyrics(1)).status, 'synced'); assert.equal(requests.length, 2);
  assert.equal(requests[1].href, 'https://lrclib.net/api/get/1');
  assert.equal((await api.selectLyrics('https://internal')).reason, 'invalid_response');
  assert.equal(requests.length, 2);
});

test('manual operations share provider cooldown and subscriber cancellation', async t => {
  let release; const pending = new Promise(resolve => { release = resolve; }); let calls = 0; let upstream;
  const api = service(t, async (_url, options) => { calls++; upstream = options.signal; await pending; return json([RECORD]); });
  const controller = new AbortController();
  const a = api.searchLyrics(QUERY, controller.signal), b = api.searchLyrics(QUERY);
  await tick(); controller.abort(); await assert.rejects(a, { name: 'AbortError' }); assert.equal(upstream.aborted, false);
  release(); assert.equal((await b).status, 'results'); assert.equal(calls, 1);
  let limitedCalls = 0;
  const limited = service(t, async () => { limitedCalls++; return new Response('', { status: 429, headers: { 'Retry-After': '10' } }); });
  assert.equal((await limited.searchLyrics(QUERY)).reason, 'rate_limited');
  assert.equal((await limited.selectLyrics(1)).reason, 'rate_limited'); assert.equal(limitedCalls, 1);
});

test('DNS failures have a connection reason without exposing private details', async t => {
  const api = service(t, async () => { throw Object.assign(new TypeError('fetch failed: private-host'), { cause: { code: 'ENOTFOUND' } }); });
  const result = await api.findLyrics(QUERY);
  assert.equal(result.reason, 'connection'); assert.equal(JSON.stringify(result).includes('private-host'), false);
});

test('interrupted HTTP 200 streams remain connection errors, not schema failures', async t => {
  const api = service(t, async () => new Response(new ReadableStream({ pull(controller) {
    controller.error(Object.assign(new TypeError('terminated: private-address'), { cause: { code: 'UND_ERR_SOCKET' } }));
  } }), { headers: { 'Content-Type': 'application/json' } }));
  const result = await api.findLyrics(QUERY);
  assert.equal(result.reason, 'connection'); assert.equal(JSON.stringify(result).includes('private-address'), false);
});

test('search and individual endpoints enforce distinct advertised and streamed byte bounds', async t => {
  for (const streamed of [false, true]) {
    const api = service(t, async () => streamed
      ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1048577)); controller.close(); } }), { headers: { 'Content-Type': 'application/json' } })
      : new Response('[]', { headers: { 'Content-Type': 'application/json', 'Content-Length': '1048577' } }));
    assert.equal((await api.searchLyrics(QUERY)).reason, 'invalid_response');
  }
  const individual = service(t, async () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '262145' } }));
  assert.equal((await individual.selectLyrics(1)).reason, 'invalid_response');
});

test('reliability flags isolate automatic caches and manual result values are cloned', async t => {
  let calls = 0;
  const api = service(t, async () => { calls++; return json([RECORD]); });
  assert.equal((await api.findLyrics({ ...QUERY, duration: 208, durationReliable: false })).status, 'plain');
  assert.equal((await api.findLyrics({ ...QUERY, duration: 208 })).status, 'ambiguous');
  assert.equal(calls, 2);
  const a = await api.searchLyrics(QUERY); a.candidates[0].title = 'Caller mutation';
  assert.equal((await api.searchLyrics(QUERY)).candidates[0].title, QUERY.title);
  assert.equal(calls, 3);
});

test('manual selection validates the fetched ID and preserves plain, instrumental and missing states', async t => {
  const wrong = service(t, async () => json({ ...RECORD, id: 9 }));
  assert.equal((await wrong.selectLyrics(1)).reason, 'invalid_response');
  const plain = service(t, async () => json({ ...RECORD, syncedLyrics: null }));
  assert.equal((await plain.selectLyrics(1)).status, 'plain');
  const instrumental = service(t, async () => json({ ...RECORD, instrumental: true, syncedLyrics: null, plainLyrics: null }));
  assert.equal((await instrumental.selectLyrics(1)).status, 'instrumental');
  const absent = service(t, async () => new Response('', { status: 404 }));
  assert.equal((await absent.selectLyrics(1)).status, 'not_found');
});

test('valid empty-content records mean lyrics absent; malformed nonempty timestamps remain invalid', async t => {
  for (const [syncedLyrics, plainLyrics, status] of [[null, null, 'not_found'], ['  ', '', 'not_found'], ['[broken]Synthetic content', null, 'temporary_error']]) {
    const record = { ...RECORD, syncedLyrics, plainLyrics };
    assert.equal(matchLyrics(QUERY, [record]).status, status);
    assert.equal((await service(t, async () => json(record)).selectLyrics(1)).status, status);
  }
});

test('identical exact content with competing timestamps downgrades to plain rather than choosing timing', () => {
  const otherTiming = { ...RECORD, id: 2, syncedLyrics: '[00:08]Texto original de prueba' };
  const result = matchLyrics(QUERY, [RECORD, otherTiming]);
  assert.equal(result.status, 'plain');
  assert.equal(result.plainLyrics, RECORD.plainLyrics);
  assert.equal(result.diagnostics.decision, 'conflicting_timestamps');
  assert.match(result.warning, /sincronizaciones distintas/);
  assert.equal(matchLyrics(QUERY, [RECORD, { ...otherTiming, syncedLyrics: '[00:08]Different original text' }]).status, 'ambiguous');
  assert.equal(matchLyrics(QUERY, [RECORD, { ...otherTiming, plainLyrics: 'Different plain text' }]).status, 'ambiguous');
  assert.equal(matchLyrics(QUERY, [RECORD, { ...otherTiming, plainLyrics: null }]).status, 'ambiguous');
});
