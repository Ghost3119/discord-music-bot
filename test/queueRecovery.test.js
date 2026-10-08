const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Collection, ChannelType } = require('discord.js');
const { Song } = require('distube');
const { QueueRecovery } = require('../dist/music/queueRecovery');

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
    setRepeatMode(value) { this.repeatMode = value; },
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
  t.mock.method(console, 'error', () => {});
  const file = workspace(t);
  fs.writeFileSync(file, '{invalid-json');
  const distube = distubeMock();
  const store = new QueueRecovery({}, distube, file);
  assert.doesNotThrow(() => store.stop());
  const unwritable = new QueueRecovery({}, distube, path.dirname(file));
  assert.doesNotThrow(() => distube.emit('playSong', makeQueue(), makeSong('AAAAAAAAAAA')));
  assert.doesNotThrow(() => unwritable.stop());
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
  };
  const client = { channels: { fetch: async (id) => id === voiceId ? voice : null } };
  const store = new QueueRecovery(client, distube, file);
  await store.restore();
  assert.deepEqual(distube.getQueue(guildId).songs.map((song) => song.id), ['BBBBBBBBBBB']);
  store.stop();
});
