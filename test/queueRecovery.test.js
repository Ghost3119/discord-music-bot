const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Collection, ChannelType } = require('discord.js');
const { Song, Queue } = require('distube');
const { QueueRecovery } = require('../dist/music/queueRecovery');
const { registerDisTubeEvents } = require('../dist/music/events');
const { getPlaybackState } = require('../dist/music/playbackState');

const guildId = '1082065100111872170';
const voiceId = '1082065100569059471';
const textId = '1082065100569059472';

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-queue-test-'));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return path.join(directory, 'queues.json');
}

function makeSong(id) {
  return new Song({ plugin: null, source: 'youtube', playFromSource: true, id, name: `Song ${id}`, duration: 200,
    url: `https://www.youtube.com/watch?v=${id}` }, { metadata: { searchSource: 'youtube' } });
}

function distubeMock() {
  const distube = new EventEmitter();
  distube.queues = { collection: new Map() };
  distube.getQueue = (id) => distube.queues.collection.get(id);
  distube.handler = { _getPluginFromURL: async () => ({ type: 'extractor' }) };
  return distube;
}

function makeQueue() {
  return {
    id: guildId, stopped: false, voiceChannel: { id: voiceId }, textChannel: { id: textId },
    songs: [makeSong('AAAAAAAAAAA'), makeSong('BBBBBBBBBBB')],
    currentTime: 75, volume: 80, paused: true, autoplay: true, repeatMode: 2,
    setVolume(value) { this.volume = value; },
    setRepeatMode: Queue.prototype.setRepeatMode,
    toggleAutoplay() { this.autoplay = !this.autoplay; },
    addToQueue(songs) { this.songs.push(...songs); },
    async seek(position) { this.currentTime = position; },
    pause() { this.paused = true; },
  };
}

test('queue checkpoints preserve order and playback settings without saving stream credentials', (t) => {
  const file = workspace(t);
  const distube = distubeMock();
  const queue = makeQueue();
  queue.songs[0].stream.url = 'https://audio.test/?token=secret-stream-token';
  distube.queues.collection.set(guildId, queue);
  const store = new QueueRecovery({}, distube, file);
  t.after(() => store.stop());
  distube.queues.collection.set(guildId, queue);
  distube.emit('playSong', queue, queue.songs[0]);
  const data = fs.readFileSync(file, 'utf8');
  const [saved] = JSON.parse(data);
  assert.deepEqual(saved.songs.map((song) => song.id), ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
  assert.equal(saved.position, 75);
  assert.equal(saved.volume, 80);
  assert.equal(saved.paused, true);
  assert.equal(saved.autoplay, true);
  assert.doesNotMatch(data, /secret-stream-token/);
  store.stop();
  distube.emit('deleteQueue', queue);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 1);
});

test('manually stopped queues are removed from the recovery file', (t) => {
  const file = workspace(t);
  const distube = distubeMock();
  const queue = makeQueue();
  const store = new QueueRecovery({}, distube, file);
  t.after(() => store.stop());
  distube.emit('playSong', queue, queue.songs[0]);
  distube.emit('deleteQueue', queue);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
});

test('blocked checkpoints restore pending songs without requesting a stream or starting radio', async t => {
  t.mock.method(console, 'log', () => {});
  const file = workspace(t), original = distubeMock(), queue = makeQueue();
  original.queues.collection.set(guildId, queue);
  const store = new QueueRecovery({}, original, file); store.stop();
  const data = JSON.parse(fs.readFileSync(file, 'utf8')); data[0].blocked = true;
  fs.writeFileSync(file, JSON.stringify(data));
  const distube = distubeMock(); let started = 0;
  distube.queues.playSong = async () => { started++; };
  const dispose = registerDisTubeEvents(distube, undefined, { interval: 0 }); t.after(dispose);
  const voice = { id: voiceId, guildId, type: ChannelType.GuildVoice, joinable: true, speakable: true,
    members: new Collection([['user', { user: { bot: false } }]]) };
  distube.play = async (_voice, playlist) => {
    const restored = { ...makeQueue(), songs: playlist.songs, paused: false, voice: { play: async () => {}, pause() {} },
      textChannel: { id: textId, send: async () => ({ id: 'panel', edit: async () => {} }) } };
    restored.play = () => distube.queues.playSong(restored);
    distube.queues.collection.set(guildId, restored);
    distube.emit('initQueue', restored);
    await restored.play();
  };
  const restoredStore = new QueueRecovery({ channels: { fetch: async id => id === voiceId ? voice : null } }, distube, file);
  t.after(() => restoredStore.stop()); await restoredStore.restore();
  const restored = distube.getQueue(guildId);
  assert.equal(started, 0); assert.equal(getPlaybackState(restored).blocked, true); assert.equal(restored.paused, true);
  assert.deepEqual(restored.songs.map(song => song.id), ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].blocked, true);
});

test('late deletion of an old queue cannot erase its successor checkpoint', t => {
  const file = workspace(t), distube = distubeMock(), old = makeQueue(), current = makeQueue();
  current.songs = [makeSong('CCCCCCCCCCC')]; distube.queues.collection.set(guildId, current);
  const store = new QueueRecovery({}, distube, file); t.after(() => store.stop());
  distube.emit('playSong', current, current.songs[0]); distube.emit('deleteQueue', old);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].songs[0].id, 'CCCCCCCCCCC');
});

test('a new process restores the queue, position, pause, repeat and volume', async (t) => {
  const file = workspace(t);
  const original = distubeMock();
  const queue = makeQueue();
  original.queues.collection.set(guildId, queue);
  const oldStore = new QueueRecovery({}, original, file);
  oldStore.stop();

  const distube = distubeMock();
  const voice = { id: voiceId, type: ChannelType.GuildVoice, guildId, joinable: true, speakable: true,
    members: new Collection([['user', { user: { bot: false } }]]) };
  const text = { id: textId, guildId, isTextBased: () => true };
  const client = { channels: { fetch: async (id) => id === voiceId ? voice : text } };
  distube.play = async (_voice, playlist, options) => {
    assert.equal(options.textChannel, text);
    const restored = { ...makeQueue(), songs: playlist.songs, volume: 50, paused: false, autoplay: false, repeatMode: 0, currentTime: 0 };
    distube.queues.collection.set(guildId, restored);
    distube.emit('initQueue', restored);
    assert.equal(restored.volume, 80, 'Saved volume applies before playback starts');
    distube.emit('playSong', restored, playlist.songs[0]);
  };
  const store = new QueueRecovery(client, distube, file);
  t.after(() => store.stop());
  await store.restore();
  const restored = distube.getQueue(guildId);
  assert.deepEqual(restored.songs.map((song) => song.id), ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
  assert.equal(restored.currentTime, 75);
  assert.equal(restored.paused, true);
  assert.equal(restored.autoplay, true);
  assert.equal(restored.repeatMode, 2);
  store.stop();
});

test('restoration does not join an empty channel or replay an old checkpoint', async (t) => {
  const file = workspace(t);
  const original = distubeMock();
  original.queues.collection.set(guildId, makeQueue());
  new QueueRecovery({}, original, file).stop();
  const distube = distubeMock();
  distube.play = async () => assert.fail('An empty channel must not be joined');
  const client = { channels: { fetch: async () => ({ type: ChannelType.GuildVoice, guildId, members: new Collection(), joinable: true, speakable: true }) } };
  const store = new QueueRecovery(client, distube, file);
  await store.restore();
  store.stop();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
});

test('corrupt checkpoints and disk write failures do not crash playback', (t) => {
  const errors = []; t.mock.method(console, 'error', (...args) => errors.push(args));
  const file = workspace(t);
  fs.writeFileSync(file, '{invalid-json');
  const distube = distubeMock();
  const store = new QueueRecovery({}, distube, file);
  assert.doesNotThrow(() => store.stop());
  const unwritable = new QueueRecovery({}, distube, path.dirname(file));
  const queue = makeQueue(); distube.queues.collection.set(guildId, queue);
  assert.doesNotThrow(() => distube.emit('playSong', queue, queue.songs[0]));
  assert.doesNotThrow(() => unwritable.stop());
  assert.ok(errors.some(args => String(args[0]).includes('No se pudieron leer')));
  assert.ok(errors.some(args => String(args[0]).includes('No se pudo guardar')));
});

test('an unavailable first track does not discard the remaining restored queue', async (t) => {
  t.mock.method(console, 'log', () => {});
  const file = workspace(t);
  const original = distubeMock();
  original.queues.collection.set(guildId, makeQueue());
  new QueueRecovery({}, original, file).stop();
  const distube = distubeMock();
  const voice = { type: ChannelType.GuildVoice, guildId, joinable: true, speakable: true,
    members: new Collection([['user', { user: { bot: false } }]]) };
  distube.play = async (_voice, playlist) => {
    assert.equal(playlist.songs.length, 2, 'All saved tracks must be enqueued before playback starts');
    const restored = { ...makeQueue(), songs: playlist.songs.slice(1), currentTime: 0,
      seek: async () => assert.fail('The position of the failed first track must not be applied to its successor') };
    distube.queues.collection.set(guildId, restored);
    distube.emit('initQueue', restored);
  };
  const client = { channels: { fetch: async (id) => id === voiceId ? voice : null } };
  const store = new QueueRecovery(client, distube, file);
  await store.restore();
  assert.deepEqual(distube.getQueue(guildId).songs.map((song) => song.id), ['BBBBBBBBBBB']);
  store.stop();
});

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function savedFixture(t) {
  const file = workspace(t), original = distubeMock();
  original.queues.collection.set(guildId, makeQueue());
  new QueueRecovery({}, original, file).stop();
  const distube = distubeMock();
  const voice = { id: voiceId, guildId, type: ChannelType.GuildVoice, joinable: true, speakable: true,
    members: new Collection([['user', { user: { bot: false } }]]) };
  const client = { channels: { fetch: async id => id === voiceId ? voice : null } };
  return { file, distube, voice, client };
}

test('late playback events cannot overwrite a successor checkpoint', t => {
  const file = workspace(t), distube = distubeMock(), old = makeQueue(), current = makeQueue();
  current.songs = [makeSong('CCCCCCCCCCC')]; distube.queues.collection.set(guildId, current);
  const store = new QueueRecovery({}, distube, file); t.after(() => store.stop());
  distube.emit('playSong', current, current.songs[0]);
  for (const event of ['playSong', 'addSong', 'addList', 'finishSong']) distube.emit(event, old, old.songs[0]);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].songs[0].id, 'CCCCCCCCCCC');
});

test('shutdown cancels restoration waiting for a channel without deleting its checkpoint', async t => {
  const f = savedFixture(t), gate = deferred();
  f.client.channels.fetch = async id => id === voiceId ? gate.promise : null;
  let starts = 0; f.distube.play = async () => { starts++; };
  const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
  const restore = store.restore(); store.stop(); gate.resolve(f.voice); await restore;
  assert.equal(starts, 0);
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).length, 1);
});

test('shutdown cancels restoration waiting for a plugin', async t => {
  const f = savedFixture(t), entered = deferred(), gate = deferred();
  f.distube.handler._getPluginFromURL = async () => { entered.resolve(); return gate.promise; };
  let starts = 0; f.distube.play = async () => { starts++; };
  const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
  const restore = store.restore(); await entered.promise; store.stop(); gate.resolve({ type: 'extractor' }); await restore;
  assert.equal(starts, 0);
});

test('a manual session created during channel lookup keeps its own settings and songs', async t => {
  const f = savedFixture(t), gate = deferred();
  f.client.channels.fetch = async id => id === voiceId ? gate.promise : null;
  let starts = 0; f.distube.play = async () => { starts++; };
  const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
  const restore = store.restore(), current = makeQueue();
  current.volume = 35; current.repeatMode = 0; current.autoplay = false;
  current.songs = [makeSong('CCCCCCCCCCC')];
  f.distube.queues.collection.set(guildId, current); f.distube.emit('initQueue', current);
  gate.resolve(f.voice); await restore;
  assert.equal(starts, 0); assert.equal(current.volume, 35); assert.equal(current.repeatMode, 0);
  assert.equal(current.autoplay, false); assert.equal(current.songs.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8'))[0].songs[0].id, 'CCCCCCCCCCC');
});

test('a successor created while restored playback finishes keeps its own settings', async t => {
  const f = savedFixture(t), current = makeQueue();
  current.volume = 35; current.repeatMode = 0; current.paused = false; current.autoplay = false;
  current.songs = [makeSong('CCCCCCCCCCC')];
  f.distube.play = async (_voice, playlist) => {
    const restored = { ...makeQueue(), songs: playlist.songs };
    f.distube.queues.collection.set(guildId, restored); f.distube.emit('initQueue', restored);
    restored.stopped = true;
    f.distube.queues.collection.set(guildId, current); f.distube.emit('initQueue', current);
  };
  const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop()); await store.restore();
  assert.equal(current.volume, 35); assert.equal(current.repeatMode, 0);
  assert.equal(current.paused, false); assert.equal(current.autoplay, false);
});

test('stopping recovery removes all event listeners and is idempotent', t => {
  const file = workspace(t), distube = distubeMock();
  for (let i = 0; i < 25; i++) {
    const store = new QueueRecovery({}, distube, file); store.stop(); store.stop();
    assert.equal(distube.eventNames().length, 0);
  }
});

test('concurrent restore requests share one startup operation', async t => {
  const f = savedFixture(t), gate = deferred();
  let lookups = 0, starts = 0;
  f.client.channels.fetch = async id => { if (id !== voiceId) return null; lookups++; return gate.promise; };
  f.distube.play = async (_voice, playlist) => {
    starts++;
    const restored = { ...makeQueue(), songs: playlist.songs };
    f.distube.queues.collection.set(guildId, restored); f.distube.emit('initQueue', restored);
  };
  const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
  const first = store.restore(), second = store.restore(); gate.resolve(f.voice); await Promise.all([first, second]);
  assert.equal(lookups, 1); assert.equal(starts, 1);
});

test('a manual session stopped during lookup is not revived by the old checkpoint', async t => {
  const f = savedFixture(t), gate = deferred();
  f.client.channels.fetch = async id => id === voiceId ? gate.promise : null;
  let starts = 0; f.distube.play = async () => { starts++; };
  const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
  const restore = store.restore(), current = makeQueue();
  f.distube.queues.collection.set(guildId, current); f.distube.emit('initQueue', current);
  f.distube.emit('playSong', current, current.songs[0]);
  current.stopped = true; f.distube.queues.collection.delete(guildId); f.distube.emit('deleteQueue', current);
  gate.resolve(f.voice); await restore;
  assert.equal(starts, 0); assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')), []);
});

test('shutdown checkpoints a manual session even while old restoration is pending', async t => {
  const f = savedFixture(t), gate = deferred();
  f.client.channels.fetch = async id => id === voiceId ? gate.promise : null;
  let starts = 0; f.distube.play = async () => { starts++; };
  const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
  const restore = store.restore(), current = makeQueue(); current.songs = [makeSong('CCCCCCCCCCC')];
  f.distube.queues.collection.set(guildId, current); f.distube.emit('initQueue', current);
  store.stop(); gate.resolve(f.voice); await restore;
  assert.equal(starts, 0); assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8'))[0].songs[0].id, 'CCCCCCCCCCC');
});

test('a successor created during restored seek is not paused by the old restoration', async t => {
  const f = savedFixture(t), entered = deferred(), gate = deferred();
  const current = makeQueue(); current.paused = false; current.songs = [makeSong('CCCCCCCCCCC')];
  let pauses = 0;
  f.distube.play = async (_voice, playlist) => {
    const restored = { ...makeQueue(), songs: playlist.songs, paused: false,
      seek: async () => { entered.resolve(restored); await gate.promise; }, pause: () => { pauses++; } };
    f.distube.queues.collection.set(guildId, restored); f.distube.emit('initQueue', restored);
  };
  const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
  const restore = store.restore(), old = await entered.promise;
  old.stopped = true; f.distube.queues.collection.set(guildId, current); f.distube.emit('initQueue', current);
  gate.resolve(); await restore;
  assert.equal(pauses, 0); assert.equal(current.paused, false);
});
