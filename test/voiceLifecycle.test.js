const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { Client, GatewayIntentBits } = require('discord.js');
const { DisTube, Song } = require('distube');
const ffmpeg = require('ffmpeg-static');
const { registerDisTubeEvents } = require('../dist/music/events');
const { getPlaybackState } = require('../dist/music/playbackState');
const { getPlaybackHealth } = require('../dist/music/playbackHealth');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');

const guildId = '1082065100111872170';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(t) {
  const errors = []; t.mock.method(console, 'error', (...args) => errors.push(args));
  t.mock.method(console, 'log', () => {}); t.mock.method(console, 'info', () => {}); t.mock.method(console, 'warn', () => {});
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] }); t.after(() => client.destroy());
  const plugin = new YtDlpSearchPlugin(); plugin.invalidateStream = () => {}; plugin.findAlternative = async () => null;
  const distube = new DisTube(client, { plugins: [plugin], ffmpeg: { path: ffmpeg } }); distube.setMaxListeners(10);
  const streams = [], voice = new EventEmitter(); Object.assign(voice, { id: guildId, emittedError: false, playbackTime: 0, volume: 50,
    channel: { id: '1082065100569059471', guildId, guild: { members: { me: null } } },
    join: async () => voice, pause() {}, unpause() {},
    play: async stream => { streams.push(stream); voice.stream = stream; voice.emittedError = false; }, stop: () => { voice.emit('finish'); } });
  distube.voices.create = () => voice;
  let now = Date.now();
  const dispose = registerDisTubeEvents(distube, undefined, { interval: 0, clock: () => now }); t.after(dispose);
  const queue = await distube.queues.create(voice.channel);
  const song = id => new Song({ plugin, source: 'youtube', id, name: id, duration: 200,
    playFromSource: true, url: `https://www.youtube.com/watch?v=${id}` });
  queue.songs = [song('AAAAAAAAAAA'), song('BBBBBBBBBBB')];
  distube.handler.attachStreamInfo = async current => { current.stream.url = 'https://unused.test/audio'; };
  t.after(() => { for (const stream of streams) stream.kill(); if (!queue.stopped) queue.remove(); });
  const health = getPlaybackHealth(distube);
  function advance(frames) { now += 2000; if (frames !== undefined) voice.stream.audioResource.playbackDuration = frames; health.tick(); }
  return { distube, queue, voice, plugin, errors, song, advance, state: getPlaybackState(queue), history: health.history };
}

test('a late voice error after stopping the native Queue is contained without restarting playback', { timeout: 10000 }, async t => {
  const f = await fixture(t); await f.queue.play(); await f.queue.stop();
  assert.doesNotThrow(() => f.voice.emit('error', new Error('late-voice-error')));
  await tick(); assert.equal(f.distube.getQueue(guildId), undefined);
  assert.equal(f.history.list(guildId).length, 0);
});

test('voice cleanup failures are caught at the event boundary and still remove the exhausted queue', async t => {
  const f = await fixture(t); f.queue.songs.splice(1); await f.queue.play();
  f.voice.stop = () => { throw new Error('voice-stop-failure'); };
  f.voice.emit('error', new Error('This video is private')); await tick();
  assert.equal(f.queue.stopped, true); assert.equal(f.distube.getQueue(guildId), undefined);
  assert.equal(f.history.list(guildId)[0].result, 'failed');
  assert.ok(f.errors.some(args => String(args[0]).includes('Error de reproducción de voz')));
});

test('duplicate errors and an old finish event cannot consume extra recovery attempts or skip the next song', async t => {
  const f = await fixture(t); await f.queue.play(); const original = f.queue.songs[0], gate = deferred();
  f.distube.handler.attachStreamInfo = async current => { await gate.promise; current.stream.url = 'https://unused.test/renewed'; };
  f.voice.emit('error', new Error('HTTP 403 Forbidden'));
  f.voice.emit('error', new Error('HTTP 403 Forbidden')); f.voice.emit('finish');
  assert.equal(f.state.attempt, 1); assert.equal(f.queue.songs[0], original); assert.equal(f.queue.songs.length, 2);
  assert.equal(f.history.list(guildId).length, 0);
  gate.resolve(); await tick(); assert.equal(f.state.busy, 0);
});

test('native skip during renewed audio starts the next track and records the original as skipped', async t => {
  const f = await fixture(t); await f.queue.play();
  f.voice.emit('error', new Error('HTTP 403 Forbidden')); await tick();
  assert.equal(f.state.mode, 'recovering'); const oldStream = f.voice.stream;
  const next = await f.queue.skip(); await tick();
  assert.equal(next.id, 'BBBBBBBBBBB'); assert.equal(f.queue.songs[0], next);
  assert.notEqual(f.voice.stream, oldStream); assert.equal(f.state.mode, 'preparing');
  assert.equal(f.state.attempt, 0); assert.equal(f.history.list(guildId)[0].result, 'skipped');
});

test('a blocked native queue retains its head when a late voice error or finish arrives', async t => {
  const f = await fixture(t); await f.queue.play(); const songs = [...f.queue.songs];
  getPlaybackHealth(f.distube).restoreBlocked(f.queue);
  f.voice.emit('error', new Error('HTTP 403 Forbidden')); f.voice.emit('finish'); await tick();
  assert.deepEqual(f.queue.songs, songs); assert.equal(f.state.blocked, true);
  assert.equal(f.history.list(guildId).length, 0);
});

test('a callback from an ended native queue cannot alter a successor using the same voice', async t => {
  const f = await fixture(t); await f.queue.play(); const oldCallback = f.queue._listeners.error;
  await f.queue.stop();
  const successor = await f.distube.queues.create(f.voice.channel); t.after(() => { if (!successor.stopped) successor.remove(); });
  const next = f.song('CCCCCCCCCCC'); successor.songs = [next]; await successor.play();
  oldCallback(new Error('HTTP 403 Forbidden')); await tick();
  assert.equal(f.distube.getQueue(guildId), successor); assert.deepEqual(successor.songs, [next]);
  assert.equal(f.voice.listenerCount('error'), 2, 'one permanent observer and one active queue handler');
});

test('repeated native sessions release queue handlers and monitor state while retaining a single late-error observer', async t => {
  const f = await fixture(t); const health = getPlaybackHealth(f.distube);
  let queue = f.queue;
  for (let i = 0; i < 100; i++) {
    await queue.stop();
    assert.equal(f.voice.listenerCount('error'), 1); assert.equal(f.voice.listenerCount('finish'), 0);
    assert.equal(health.queues.size, 0); assert.equal(queue._taskQueue.remaining, 0);
    if (i < 99) { queue = await f.distube.queues.create(f.voice.channel); queue.songs = [f.song('AAAAAAAAAAA')]; }
  }
});

test('the watchdog uses the same bounded recovery in a native queue and advances once after exhaustion', async t => {
  const f = await fixture(t); await f.queue.play(); const originalStream = f.voice.stream;
  let alternatives = 0; f.plugin.findAlternative = async () => { alternatives++; return null; };
  f.advance(2000);
  for (let i = 0; i < 4; i++) f.advance(); await tick();
  assert.equal(f.state.attempt, 1); assert.notEqual(f.voice.stream, originalStream);
  for (let renewal = 0; renewal < 2; renewal++) {
    for (let i = 0; i < 6; i++) f.advance();
    await tick();
  }
  assert.equal(alternatives, 1); assert.equal(f.queue.songs.length, 1); assert.equal(f.queue.songs[0].id, 'BBBBBBBBBBB');
  assert.equal(f.state.attempt, 0); assert.equal(f.history.list(guildId).length, 1);
  assert.equal(f.history.list(guildId)[0].result, 'failed'); assert.equal(f.queue._taskQueue.remaining, 0);
});

test('native pause and seek reset observation without creating false watchdog recoveries', async t => {
  const f = await fixture(t); await f.queue.play(); f.advance(2000); await f.queue.pause();
  for (let i = 0; i < 300; i++) f.advance();
  assert.equal(f.state.attempt, 0); assert.equal(f.state.mode, 'paused');
  await f.queue.resume(); await f.queue.seek(30);
  for (let i = 0; i < 5; i++) f.advance();
  assert.equal(f.state.attempt, 0); assert.equal(f.history.list(guildId).length, 0);
  f.advance(); await tick(); assert.equal(f.state.attempt, 1);
});

test('a finish arriving while native skip waits for the task lock cannot skip the new head twice', async t => {
  const f = await fixture(t); f.queue.songs.push(f.song('CCCCCCCCCCC')); await f.queue.play();
  await f.queue._taskQueue.queuing();
  const skipping = f.queue.skip(); await tick(); f.voice.emit('finish');
  f.queue._taskQueue.resolve(); await skipping; await tick();
  assert.equal(f.queue.songs[0].id, 'BBBBBBBBBBB'); assert.equal(f.queue.songs.length, 2);
  assert.equal(f.history.list(guildId)[0].result, 'skipped');
});

test('a finish from the old resource cannot end a song after native seek installs new audio', async t => {
  const f = await fixture(t); await f.queue.play(); const original = f.queue.songs[0];
  await f.queue._taskQueue.queuing();
  const seeking = f.queue.seek(30); await tick(); f.voice.emit('finish');
  f.queue._taskQueue.resolve(); await seeking; await tick();
  assert.equal(f.queue.songs[0], original); assert.equal(f.history.list(guildId).length, 0);
});

test('duplicate native finish callbacks share one pending transition and advance only once', async t => {
  const f = await fixture(t); f.queue.songs.push(f.song('CCCCCCCCCCC')); await f.queue.play();
  await f.queue._taskQueue.queuing(); f.voice.emit('finish'); f.voice.emit('finish');
  f.queue._taskQueue.resolve(); await tick();
  assert.equal(f.queue.songs[0].id, 'BBBBBBBBBBB'); assert.equal(f.queue.songs.length, 2);
  assert.equal(f.history.list(guildId).length, 1); assert.equal(f.queue._taskQueue.remaining, 0);
});
