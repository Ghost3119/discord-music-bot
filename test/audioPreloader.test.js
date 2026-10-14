const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { Song, Queue, DisTube, InfoExtractorPlugin } = require('distube');
const { Client, GatewayIntentBits } = require('discord.js');
const { AudioPreloader, PreparationSlots, streamValidUntil } = require('../dist/music/audioPreloader');
const { PlaybackRecovery } = require('../dist/music/playbackRecovery');
const { PlaybackHealth } = require('../dist/music/playbackHealth');
const { getPlaybackState } = require('../dist/music/playbackState');
const { checkpointQueue } = require('../dist/music/queueChanges');
const { registerDisTubeEvents } = require('../dist/music/events');
const { getAudioPreloader } = require('../dist/music/audioPreloader');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
const { PREBUFFER_MAX_BYTES } = require('../dist/music/prebufferedStream');
const { editQueue } = require('../dist/music/queueActions');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const broken = () => Object.assign(new Error('FFmpeg failed'), { errorCode: 'FFMPEG_EXITED' });

class FakeBuffer extends EventEmitter {
  constructor() { super(); this.audioResource = { playbackDuration: 0 }; this.usable = false; this.bufferedBytes = 1024; this.kills = 0; this.starts = 0; }
  spawn() { if (!this.starts) this.starts++; }
  async prepare(signal) { signal.throwIfAborted(); this.spawn(); this.usable = true; }
  kill() { if (this.kills) return; this.kills++; this.usable = false; }
  async dispose() { this.kill(); }
}
function fixture(t, options = {}) {
  for (const method of ['info', 'log', 'warn', 'error']) t.mock.method(console, method, () => {});
  let now = 1_000_000; t.mock.method(Date, 'now', () => now);
  const plugin = new YtDlpSearchPlugin(), d = new EventEmitter(), queues = new Map(), buffers = [], logs = [], calls = [];
  d.plugins = [plugin]; d.getQueue = id => queues.get(id);
  d.options = { ffmpeg: { path: require('ffmpeg-static') } };
  plugin.fetchInfo = async (input, flags, signal, priority) => { calls.push({ input, flags, signal, priority }); return { url: `https://audio.test/${calls.length}?token=secret` }; };
  const recovery = new PlaybackRecovery(), health = new PlaybackHealth(d, undefined, undefined, undefined, { interval: 0, clock: () => now });
  const resolutions = options.resolutionSlots ?? new PreparationSlots(), slots = options.bufferSlots ?? new PreparationSlots();
  const p = new AudioPreloader(d, recovery, { interval: 0, clock: () => now, resolutionSlots: resolutions, bufferSlots: slots,
    factory: () => { const b = new FakeBuffer(); buffers.push(b); return b; }, log: (event, fields) => logs.push({ event, ...fields }), ...options });
  t.after(() => { p.dispose(); health.dispose(); recovery.dispose(); });
  function song(id) { return new Song({ plugin, source: 'youtube', id, name: `Artist ${id}`, duration: 200,
    playFromSource: true, url: `https://www.youtube.com/watch?v=${id}` }); }
  function queue(id = 'guild', sameNext = 'BBBBBBBBBBB') {
    const q = { id, distube: d, songs: [song('AAAAAAAAAAA'), song(sameNext)], currentTime: 175,
      volume: 50, repeatMode: 0, autoplay: false, paused: false, stopped: false,
      voice: { stream: { audioResource: { playbackDuration: 1000 } }, isDisconnected: false },
      ffmpegArgs: { global: {}, input: {}, output: {} }, filters: { ffmpegArgs: {} } };
    queues.set(id, q); health.init(q); p.watch(q); return q;
  }
  async function prepare() { p.tick(); await flush(); p.tick(); await flush(); }
  return { p, plugin, d, queues, buffers, slots, resolutions, calls, logs, queue, song, health, prepare, advance: ms => { now += ms; } };
}

test('resolves early, buffers in the final 30 seconds and hands off the exact resource once', async t => {
  const f = fixture(t), q = f.queue(), current = q.voice.stream, next = q.songs[1]; q.currentTime = 50;
  f.p.tick(); await flush();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].priority, 'background'); assert.equal(f.buffers.length, 0);
  q.currentTime = 175; f.p.tick(); await flush();
  assert.equal(f.buffers.length, 1); assert.equal(q.voice.stream, current); assert.equal(q.songs[1], next);
  q.songs.shift();
  const result = await f.p.take(q, next);
  assert.equal(result.stream, f.buffers[0]); assert.equal(result.stream.audioResource.playbackDuration, 0);
  assert.equal(f.calls.length, 1, 'Prebuffering must reuse the URL extraction');
  assert.equal(f.slots.active, 0); assert.equal(await f.p.take(q, next), undefined);
  q.voice.stream = result.stream; f.p.started(q, result.stream, 'buffer');
  assert.equal(f.p.metrics.reusedBuffer, 1); assert.equal(f.p.metrics.bufferSuccessPercent, 100);
  result.stream.kill();
});

test('skip during pending prebuffer cancels FFmpeg and reuses its already resolved URL', async t => {
  const gate = deferred(); let buffer, signal;
  const f = fixture(t, { factory: () => { buffer = new FakeBuffer(); buffer.prepare = async s => {
    signal = s; buffer.spawn(); await new Promise((resolve, reject) => { gate.promise.then(resolve); s.addEventListener('abort', () => reject(s.reason), { once: true }); });
  }; return buffer; } }), q = f.queue(), next = q.songs[1];
  await f.prepare(); q.songs.shift();
  const result = await f.p.take(q, next); await flush();
  assert.equal(result.stream, undefined); assert.match(result.url, /audio.test/);
  assert.equal(signal.aborted, true); assert.equal(buffer.kills, 1); assert.equal(f.slots.active, 0); assert.equal(f.calls.length, 1);
  gate.resolve();
});

test('stop cancels a pending extraction and a late result cannot affect a new session', async t => {
  const f = fixture(t), q = f.queue(), gate = deferred(); let signal;
  f.plugin.fetchInfo = async (_input, _flags, s) => { signal = s; return gate.promise; };
  f.p.tick(); await flush(); q.stopped = true; f.p.end(q); await flush();
  assert.equal(signal.aborted, true); assert.equal(f.resolutions.active, 0);
  const replacement = f.queue('guild');
  f.plugin.fetchInfo = async () => ({ url: 'https://audio.test/fresh' });
  await f.prepare(); gate.resolve({ url: 'https://audio.test/stale' }); await flush();
  replacement.songs.shift(); const result = await f.p.take(replacement, replacement.songs[0]);
  assert.equal(result.url, 'https://audio.test/fresh'); assert.equal(getPlaybackState(replacement).failures.length, 0);
  result.stream.kill();
});

test('two guilds share extraction while cancellation of one preserves the other', async t => {
  const f = fixture(t), a = f.queue('a'), b = f.queue('b'), gate = deferred(); let signal, starts = 0;
  f.plugin.fetchInfo = async (_input, _flags, s) => { starts++; signal = s; return gate.promise; };
  f.p.tick(); await flush(); assert.equal(starts, 1);
  f.p.cancel(a, 'stop'); await flush(); assert.equal(signal.aborted, false);
  gate.resolve({ url: 'https://audio.test/shared' }); await flush(); f.p.tick(); await flush();
  b.songs.shift(); const result = await f.p.take(b, b.songs[0]);
  assert.equal(result.url, 'https://audio.test/shared'); assert.equal(starts, 1);
  assert.equal(getPlaybackState(a).blocked, false); assert.equal(getPlaybackState(b).blocked, false);
  result.stream?.kill();
});

test('identical songs share URLs but never share an AudioResource between guilds', async t => {
  const f = fixture(t), a = f.queue('a'), b = f.queue('b'); await f.prepare();
  assert.equal(f.calls.length, 1); assert.equal(f.buffers.length, 2);
  a.songs.shift(); b.songs.shift();
  const first = await f.p.take(a, a.songs[0]), second = await f.p.take(b, b.songs[0]);
  assert.notEqual(first.stream, second.stream); assert.notEqual(first.stream.audioResource, second.stream.audioResource);
  first.stream.kill(); assert.equal(second.stream.usable, true); second.stream.kill();
});

for (const change of ['shuffle', 'remove', 'move', 'clear', 'insert', 'loop', 'autoplay', 'volume', 'filters']) {
  test(`${change} invalidates a mismatching preparation before it can be played`, async t => {
    const f = fixture(t), q = f.queue();
    q._taskQueue = { async queuing() {}, resolve() {} };
    if (['shuffle', 'remove', 'move'].includes(change)) q.songs.push(f.song('CCCCCCCCCCC'));
    await f.prepare(); const buffer = f.buffers[0], old = q.songs[1];
    if (change === 'shuffle') { t.mock.method(Math, 'random', () => 0); await editQueue(f.d, q, { type: 'shuffle' }); }
    else if (change === 'remove') await editQueue(f.d, q, { type: 'remove', position: 1 });
    else if (change === 'move') await editQueue(f.d, q, { type: 'move', from: 2, to: 1 });
    else if (change === 'clear') await editQueue(f.d, q, { type: 'clear' });
    else if (change === 'loop') Queue.prototype.setRepeatMode.call(q, 1);
    else if (change === 'autoplay') Queue.prototype.toggleAutoplay.call(q);
    else if (change === 'volume') q.volume = 25;
    else if (change === 'filters') q.filters.ffmpegArgs = { af: 'atempo=1.1' };
    else q.songs.splice(1, change === 'insert' ? 0 : 1, f.song('CCCCCCCCCCC'));
    checkpointQueue(f.d, q); await flush();
    assert.equal(buffer.kills, 1); assert.equal(f.slots.active, 0);
    if (q.songs[1] === old) q.songs.shift();
    assert.equal(await f.p.take(q, old), undefined);
  });
}

test('bounded speculative renewals and one alternative do not change playback or breaker history', async t => {
  let factories = 0;
  const f = fixture(t, { factory: () => { factories++; const b = new FakeBuffer();
    if (factories <= 3) b.prepare = async () => { throw broken(); }; return b; } }), q = f.queue(), original = q.songs[1], current = q.voice.stream;
  let alternatives = 0; const alternative = f.song('CCCCCCCCCCC');
  f.plugin.findAlternative = async (_song, _signal, priority) => { assert.equal(priority, 'background'); alternatives++; return alternative; };
  await f.prepare();
  assert.equal(factories, 4); assert.equal(alternatives, 1); assert.equal(q.voice.stream, current); assert.equal(q.songs[1], original);
  assert.deepEqual(getPlaybackState(q).failures, []); assert.equal(f.health.history.list(q.id).length, 0);
  q.songs.shift(); const result = await f.p.take(q, original);
  assert.equal(result.replacement, alternative); assert.equal(f.p.metrics.failures, 0);
  result.stream.kill();
});

test('exhausted preloading leaves the current song untouched and falls back to normal playback', async t => {
  let factories = 0, alternatives = 0;
  const f = fixture(t, { factory: () => { factories++; const b = new FakeBuffer(); b.prepare = async () => { throw broken(); }; return b; } }), q = f.queue();
  f.plugin.findAlternative = async () => { alternatives++; return f.song('CCCCCCCCCCC'); };
  const current = q.voice.stream, songs = [...q.songs]; await f.prepare();
  assert.equal(factories, 4); assert.equal(alternatives, 1); assert.equal(f.slots.active, 0);
  f.p.tick(); await flush(); assert.equal(factories, 4, 'Do not start unbounded speculative recovery cycles');
  assert.equal(q.voice.stream, current); assert.deepEqual(q.songs, songs); assert.deepEqual(getPlaybackState(q).failures, []);
  q.songs.shift(); const result = await f.p.take(q, q.songs[0]);
  assert.equal(result, undefined, 'Never commit an alternative that failed its speculative audio check'); assert.equal(f.p.metrics.failures, 1);
});

test('current-track recovery cancels speculation without spending a playback failure', async t => {
  const f = fixture(t), q = f.queue(); await f.prepare();
  getPlaybackState(q).mode = 'recovering'; checkpointQueue(f.d, q); await flush(); f.p.tick();
  assert.equal(f.buffers[0].kills, 1); assert.equal(f.slots.active, 0); assert.deepEqual(getPlaybackState(q).failures, []);
  assert.equal(f.calls.length, 1);
});

test('URL expiry renews through the shared cache and never consumes an expired preparation', async t => {
  const f = fixture(t), q = f.queue(); q.currentTime = 50; let starts = 0;
  f.plugin.fetchInfo = async () => ({ url: ++starts === 1 ? 'https://audio.test/old?expire=1016' : 'https://audio.test/new?expire=1200' });
  f.p.tick(); await flush(); f.advance(2000); f.p.tick(); await flush();
  q.songs.shift(); const result = await f.p.take(q, q.songs[0]);
  assert.equal(starts, 2); assert.match(result.url, /\/new/); assert.equal(result.stream, undefined);
  assert.equal(streamValidUntil('https://test/?Expires=1016', 1_000_000), 1_001_000);
});

test('expiry at handoff invalidates the shared URL even when no maintenance tick has run', async t => {
  const f = fixture(t), q = f.queue(); q.currentTime = 50; let starts = 0;
  f.plugin.fetchInfo = async () => ({ url: ++starts === 1 ? 'https://audio.test/old?expire=1016' : 'https://audio.test/fresh' });
  f.p.tick(); await flush(); f.advance(2000); q.songs.shift();
  assert.equal(await f.p.take(q, q.songs[0]), undefined);
  const currentUrl = await f.plugin.getStreamURL(q.songs[0]);
  assert.match(currentUrl, /\/fresh/); assert.equal(starts, 2);
});

for (const live of ['current_live', 'current_unknown', 'next_live', 'next_unknown']) {
  test(`${live} uses URL-only preparation without retaining stale live audio`, async t => {
    const f = fixture(t), q = f.queue();
    if (live === 'current_live') q.songs[0].isLive = true;
    if (live === 'current_unknown') q.songs[0].duration = 0;
    if (live === 'next_live') q.songs[1].isLive = true;
    if (live === 'next_unknown') q.songs[1].duration = 0;
    await f.prepare(); assert.equal(f.calls.length, 1); assert.equal(f.buffers.length, 0);
  });
}

test('global resource limits hold across guilds and a closing FFmpeg keeps its slot until closed', async t => {
  const closed = deferred(), made = [];
  const f = fixture(t, { factory: () => { const b = new FakeBuffer(); if (!made.length) b.dispose = async () => { b.kill(); await closed.promise; }; made.push(b); return b; } });
  const queues = ['a', 'b', 'c'].map(id => f.queue(id, id.repeat(11)));
  await f.prepare(); f.p.tick(); await flush();
  assert.equal(made.length, 2); assert.equal(f.slots.active, 2); assert.ok(f.resolutions.active <= 2);
  const first = queues.find(q => f.p.entries.get(q)?.buffer === made[0]);
  first.paused = true; checkpointQueue(f.d, first); await flush(); f.p.tick(); await flush();
  assert.equal(made.length, 2, 'Do not replace a speculative process before close');
  closed.resolve(); await flush(); f.p.tick(); await flush();
  assert.equal(made.length, 3); assert.equal(f.slots.active, 2);
  f.p.dispose(); await flush(); assert.equal(f.slots.active, 0); assert.equal(f.p.metrics.preparations, 0);
});

test('oversized audio is destroyed without affecting the playing track', async t => {
  let killed = 0;
  const f = fixture(t, { factory: () => { const b = new FakeBuffer(); b.bufferedBytes = PREBUFFER_MAX_BYTES + 1;
    b.dispose = async () => { b.kill(); killed++; }; return b; } }), q = f.queue(), current = q.voice.stream;
  await f.prepare(); assert.equal(killed, 1); assert.equal(f.slots.active, 0);
  assert.equal(q.voice.stream, current); assert.deepEqual(getPlaybackState(q).failures, []);
});

test('pause, buffer age and shutdown release speculative resources; nothing is persisted', async t => {
  const f = fixture(t), q = f.queue(); await f.prepare(); const first = f.buffers[0];
  q.paused = true; checkpointQueue(f.d, q); await flush(); assert.equal(first.kills, 1);
  q.paused = false; await f.prepare(); const second = f.buffers[1];
  f.advance(45_001); f.p.tick(); await flush(); assert.equal(second.kills, 1);
  f.p.dispose(); await flush(); assert.equal(f.slots.active, 0); assert.equal(getAudioPreloader(f.d), undefined);
  const starts = f.calls.length; f.p.tick(); await flush(); assert.equal(f.calls.length, starts);
});

test('transition logs wait for actual audio progress and omit temporary URLs', async t => {
  const f = fixture(t), q = f.queue(); await f.prepare();
  f.p.finished(q); q.songs.shift(); const prepared = await f.p.take(q, q.songs[0]);
  q.voice.stream = prepared.stream; f.p.started(q, prepared.stream, 'buffer'); f.p.tick();
  assert.equal(f.p.metrics.transitions, 0);
  f.advance(80); prepared.stream.audioResource.playbackDuration = 20; f.p.tick();
  assert.equal(f.p.metrics.transitions, 1); assert.equal(f.logs.find(log => log.event === 'transition').gapMs, 80);
  assert.doesNotMatch(JSON.stringify(f.logs), /secret|https?:\/\//); prepared.stream.kill();
});

test('metadata-only songs share cancelable background searches and keep their origin', async t => {
  const f = fixture(t), q = f.queue();
  class Metadata extends InfoExtractorPlugin { createSearchQuery() { return 'Artist Song'; } }
  q.songs[1] = new Song({ plugin: new Metadata(), source: 'spotify', playFromSource: false, id: 'spotify', name: 'Artist Song', duration: 200,
    url: 'https://open.spotify.com/track/test' });
  const original = q.songs[1]; let searches = 0;
  f.plugin.fetchInfo = async (input, _flags, _signal, priority) => {
    assert.equal(priority, 'background');
    if (input.startsWith('ytsearch')) { searches++; return { entries: [{ id: 'BBBBBBBBBBB', title: 'Artist Song', extractor: 'youtube', webpage_url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB' }] }; }
    return { url: 'https://audio.test/spotify-match' };
  };
  await f.prepare(); assert.equal(searches, 1); assert.equal(original.stream.song, undefined);
  q.songs.shift(); const result = await f.p.take(q, original);
  assert.equal(result.playable.source, 'youtube'); assert.equal(result.replacement, undefined); result.stream.kill();
});

async function nativeFixture(t, options = {}) {
  const f = fixture(t), client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] }); t.after(() => client.destroy());
  options.setup?.(f);
  const d = new DisTube(client, { plugins: [f.plugin], ffmpeg: { path: require('ffmpeg-static') } }); d.setMaxListeners(10);
  const played = [], voice = new EventEmitter(); Object.assign(voice, { id: '1082065100111872170', volume: 50, emittedError: false, playbackTime: 175,
    channel: { id: '1082065100569059471', guildId: '1082065100111872170', guild: { members: { me: null } } },
    join: async () => voice, pause() {}, unpause() {}, stop() { this.emit('finish'); },
    play: async stream => { played.push(stream); if (stream instanceof FakeBuffer) stream.spawn(); voice.stream = stream; } });
  d.voices.create = () => voice;
  t.after(registerDisTubeEvents(d, undefined, { interval: 0 }, { resolutionSlots: new PreparationSlots(), bufferSlots: new PreparationSlots(),
    factory: (...args) => { const b = options.factory ? options.factory(...args) : new FakeBuffer(); f.buffers.push(b); return b; }, log: () => {} }));
  const q = await d.queues.create(voice.channel); q.songs = [f.song('AAAAAAAAAAA'), f.song('BBBBBBBBBBB')];
  d.handler.attachStreamInfo = async song => { song.stream.url = await f.plugin.getStreamURL(song); };
  t.after(() => { for (const stream of played) stream.kill(); if (!q.stopped) q.remove(); });
  await q.play(); voice.stream.audioResource.playbackDuration = 175_000;
  const p = getAudioPreloader(d); p.tick(); await flush(); p.tick(); await flush();
  return { ...f, d, q, voice, p };
}

test('native Queue skip hands the prepared stream to voice exactly once without another extraction', async t => {
  const f = await nativeFixture(t), prepared = f.buffers[0], calls = f.calls.length;
  assert.ok(prepared); await f.q.skip(); await flush();
  assert.equal(f.voice.stream, prepared); assert.equal(prepared.starts, 1); assert.equal(f.calls.length, calls);
  assert.equal(f.q.songs[0].id, 'BBBBBBBBBBB'); assert.equal(f.q._taskQueue.remaining, 0);
});

test('native seek cancels the next prebuffer while preserving the current song and its lock', async t => {
  const f = await nativeFixture(t), prepared = f.buffers[0]; await f.q.seek(30); await flush();
  assert.equal(prepared.kills, 1); assert.equal(f.q.songs[0].id, 'AAAAAAAAAAA'); assert.equal(f.q._taskQueue.remaining, 0);
});

test('natural native finish uses the staged stream and preserves the following queue order', async t => {
  const f = await nativeFixture(t), prepared = f.buffers[0]; f.q.songs.push(f.song('CCCCCCCCCCC'));
  await f.d.queues.handleSongFinish(f.q);
  assert.equal(f.voice.stream, prepared); assert.deepEqual(f.q.songs.map(s => s.id), ['BBBBBBBBBBB', 'CCCCCCCCCCC']);
  assert.equal(prepared.starts, 1); assert.equal(f.q._taskQueue.remaining, 0);
});

test('a stop racing with a prepared handoff destroys the detached resource instead of reviving audio', async t => {
  const f = await nativeFixture(t), prepared = f.buffers[0], take = f.p.take.bind(f.p);
  f.p.take = async (...args) => { const result = await take(...args); await f.q.stop(); return result; };
  f.q.songs.shift(); await f.q.play();
  assert.equal(prepared.kills, 1); assert.equal(f.d.getQueue(f.q.id), undefined); assert.equal(f.p.metrics.activeBuffers, 0);
});

test('settings changed during handoff discard encoded audio and keep its URL with current settings', async t => {
  const f = await nativeFixture(t), prepared = f.buffers[0], take = f.p.take.bind(f.p), calls = f.calls.length;
  f.p.take = async (...args) => { const result = await take(...args); f.q.setVolume(25); return result; };
  f.q.songs.shift(); await f.q.play();
  assert.equal(prepared.kills, 1); assert.notEqual(f.voice.stream, prepared); assert.equal(f.q.volume, 25);
  assert.equal(f.calls.length, calls); assert.equal(f.p.metrics.reusedBuffer, 0); assert.equal(f.p.metrics.reusedUrl, 1);
});

test('an anticipated alternative is committed only at playback and retains original history lineage', async t => {
  let attempts = 0;
  const f = await nativeFixture(t, {
    setup: f => { f.plugin.findAlternative = async () => f.song('CCCCCCCCCCC'); },
    factory: () => { const b = new FakeBuffer(); if (++attempts <= 3) b.prepare = async () => { throw broken(); }; return b; },
  });
  assert.equal(f.q.songs[1].id, 'BBBBBBBBBBB'); assert.equal(getPlaybackState(f.q).failures.length, 0);
  await f.d.queues.handleSongFinish(f.q);
  assert.equal(f.q.songs[0].id, 'CCCCCCCCCCC'); assert.equal(f.voice.stream, f.buffers[3]);
  f.q.songs.push(f.song('DDDDDDDDDDD')); f.voice.stream.audioResource.playbackDuration = 1000;
  await f.d.queues.handleSongFinish(f.q);
  const history = require('../dist/music/playbackHealth').getPlaybackHealth(f.d).history.list(f.q.id);
  const original = history.find(entry => entry.title === 'Artist BBBBBBBBBBB');
  assert.equal(original.result, 'completed'); assert.equal(original.alternative, 'Artist CCCCCCCCCCC');
  assert.equal(history.filter(entry => entry.title === original.title).length, 1);
});

test('a late FFmpeg failure renews the prebuffer without leaking its global slot', async t => {
  const f = fixture(t), q = f.queue(); await f.prepare();
  f.buffers[0].failure = broken(); f.buffers[0].usable = false;
  f.p.tick(); await flush();
  assert.equal(f.buffers.length, 2); assert.equal(f.buffers[0].kills, 1); assert.equal(f.slots.active, 1);
  assert.equal(f.calls.length, 2); assert.deepEqual(getPlaybackState(q).failures, []);
});

test('stopping a pending metadata query releases work immediately and ignores its late result', async t => {
  const f = fixture(t), q = f.queue(), query = deferred();
  class Metadata extends InfoExtractorPlugin { createSearchQuery() { return query.promise; } }
  q.songs[1] = new Song({ plugin: new Metadata(), source: 'spotify', playFromSource: false, id: 'metadata', name: 'Artist Song' });
  f.p.tick(); await flush(); assert.equal(f.resolutions.active, 1);
  f.p.end(q); await flush(); assert.equal(f.resolutions.active, 0);
  query.resolve('Artist Song'); await flush(); assert.equal(f.calls.length, 0);
});

test('foreground shares a speculative search and survives cancellation of its background consumer', async t => {
  const f = fixture(t), gate = deferred(), controller = new AbortController(); let starts = 0, signal;
  f.plugin.fetchInfo = async (_input, _flags, s) => { starts++; signal = s; return gate.promise; };
  const background = f.plugin.searchSong('Artist Song', {}, controller.signal, 'background');
  const rejected = assert.rejects(background, { name: 'AbortError' });
  const foreground = f.plugin.searchSong('Artist Song', {});
  controller.abort(); await rejected; assert.equal(signal.aborted, false);
  gate.resolve({ entries: [{ id: 'BBBBBBBBBBB', title: 'Artist Song', extractor: 'youtube', webpage_url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB' }] });
  assert.equal((await foreground).id, 'BBBBBBBBBBB'); assert.equal(starts, 1);
});

test('repeat modes prepare a fresh resource for the same song without consuming its current stream', async t => {
  for (const mode of [1, 2]) {
    const f = fixture(t), q = f.queue(`loop-${mode}`); q.songs.splice(1); q.repeatMode = mode;
    const original = q.songs[0], playing = q.voice.stream; await f.prepare();
    const ready = await f.p.take(q, original);
    assert.ok(ready.stream); assert.equal(q.voice.stream, playing); assert.equal(q.songs[0], original);
    ready.stream.kill(); f.p.dispose();
  }
});

test('disabled preloading performs no speculative work or transition bookkeeping', async t => {
  const f = fixture(t, { enabled: false }), q = f.queue(); f.p.finished(q); f.p.started(q, q.voice.stream, 'fallback');
  await f.prepare(); assert.equal(f.calls.length, 0); assert.equal(f.p.metrics.tracked, 0);
  assert.equal(f.p.metrics.fallback, 0); assert.equal(await f.p.take(q, q.songs[1]), undefined);
});
