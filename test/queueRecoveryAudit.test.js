const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChannelType, Collection } = require('discord.js');
const { Song, Queue } = require('distube');
const { QueueRecovery } = require('../dist/music/queueRecovery');
const { PlaybackHealth } = require('../dist/music/playbackHealth');
const { getPlaybackState } = require('../dist/music/playbackState');
const { registerDisTubeEvents } = require('../dist/music/events');

const guildId = '1082065100111872170';
const voiceId = '1082065100569059471';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function song(id = 'AAAAAAAAAAA') {
  return new Song({ plugin: null, source: 'youtube', playFromSource: true, id, name: id,
    duration: 200, url: `https://www.youtube.com/watch?v=${id}` });
}
function queue(songs = [song(), song('BBBBBBBBBBB')]) {
  return { id: guildId, stopped: false, songs, volume: 80, repeatMode: 2, autoplay: true, paused: false,
    voiceChannel: { id: voiceId }, currentTime: 75, voice: { pause() {}, unpause() {}, async play() {} },
    setVolume(value) { this.volume = value; }, setRepeatMode: Queue.prototype.setRepeatMode,
    toggleAutoplay() { this.autoplay = !this.autoplay; },
    async seek(value) { this.currentTime = value; }, async pause() { this.paused = true; },
    async stop() { this.stopped = true; this.distube.queues.collection.delete(guildId); this.distube.emit('deleteQueue', this); },
  };
}
function distube() {
  const d = new EventEmitter(); d.queues = { collection: new Map() };
  d.getQueue = id => d.queues.collection.get(id);
  d.handler = { _getPluginFromURL: async () => ({ type: 'extractor' }) };
  return d;
}
function fixture(t, recoveryState = {}) {
  t.mock.method(console, 'log', () => {}); t.mock.method(console, 'info', () => {}); t.mock.method(console, 'warn', () => {});
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-restore-audit-'));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, 'queues.json'), original = distube(), old = queue();
  original.queues.collection.set(guildId, old);
  const health = new PlaybackHealth(original, undefined, undefined, undefined, { interval: 0 });
  health.init(old); Object.assign(getPlaybackState(old), recoveryState);
  new QueueRecovery({}, original, file).stop(); health.dispose();
  const d = distube();
  const voice = { id: voiceId, guildId, type: ChannelType.GuildVoice, joinable: true, speakable: true,
    members: new Collection([['human', { user: { bot: false } }]]) };
  const client = { channels: { fetch: async () => voice } };
  return { file, d, client, saved: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}
function restoredHealth(t, f) {
  const health = new PlaybackHealth(f.d, undefined, undefined, undefined, { interval: 0 });
  t.after(() => health.dispose());
  f.d.play = async (_voice, playlist) => {
    const q = queue(playlist.songs); q.currentTime = 0; f.d.queues.collection.set(guildId, q);
    f.d.emit('initQueue', q); health.init(q);
  };
  return health;
}

test('a restart preserves an unfinished breaker probe before requesting restored audio', async t => {
  const f = fixture(t, { probe: true, failures: [Date.now() - 1000] });
  const health = restoredHealth(t, f), play = f.d.play; let probeBeforeAudio;
  f.d.play = async (...args) => { await play(...args); probeBeforeAudio = getPlaybackState(f.d.getQueue(guildId)).probe; };
  const store = new QueueRecovery(f.client, f.d, f.file); t.after(() => store.stop()); await store.restore();
  const q = f.d.getQueue(guildId), failed = q.songs.shift();
  health.recovery({ queue: q, song: failed, original: failed, stage: 'failed', attempt: 3, code: 'SOURCE_BLOCKED' });
  assert.equal(getPlaybackState(q).blocked, true, 'An exhausted restored probe must block on its first failure');
  assert.equal(probeBeforeAudio, true);
  assert.equal(q.songs[0], failed);
});

test('recent failure streak survives restart and the next exhaustion blocks the queue', async t => {
  const recent = [Date.now() - 2000, Date.now() - 1000], f = fixture(t, { failures: recent });
  const health = restoredHealth(t, f), store = new QueueRecovery(f.client, f.d, f.file);
  t.after(() => store.stop()); await store.restore();
  const q = f.d.getQueue(guildId);
  assert.deepEqual(getPlaybackState(q).failures, recent);
  const failed = q.songs.shift();
  health.recovery({ queue: q, song: failed, original: failed, stage: 'failed', attempt: 3, code: 'SOURCE_BLOCKED' });
  assert.equal(getPlaybackState(q).blocked, true);
});

test('stop while restored playback is pending removes the checkpoint before the next restart', async t => {
  const f = fixture(t), entered = deferred(), gate = deferred();
  const dispose = registerDisTubeEvents(f.d, undefined, { interval: 0 }); t.after(dispose);
  f.d.play = async (_voice, playlist) => {
    const q = queue(playlist.songs); q.distube = f.d;
    f.d.queues.collection.set(guildId, q); f.d.emit('initQueue', q);
    entered.resolve(q); await gate.promise;
  };
  const store = new QueueRecovery(f.client, f.d, f.file); t.after(() => store.stop());
  const restoring = store.restore(), q = await entered.promise;
  await q.stop();
  const immediatelySaved = f.saved(); gate.resolve(); await restoring;
  assert.deepEqual(immediatelySaved, [], 'Manual stop must remove the snapshot even before restore settles');
  assert.deepEqual(f.saved(), []);
  let starts = 0; f.d.play = async () => { starts++; };
  store.stop();
  const nextBoot = new QueueRecovery(f.client, f.d, f.file); t.after(() => nextBoot.stop()); await nextBoot.restore();
  assert.equal(starts, 0);
});

test('settings changed by a user during restored playback survive restoration', async t => {
  const f = fixture(t), entered = deferred(), gate = deferred();
  f.d.play = async (_voice, playlist) => {
    const q = queue(playlist.songs); f.d.queues.collection.set(guildId, q); f.d.emit('initQueue', q);
    entered.resolve(q); await gate.promise;
  };
  const store = new QueueRecovery(f.client, f.d, f.file); t.after(() => store.stop());
  const restoring = store.restore(), q = await entered.promise;
  q.setVolume(35); q.setRepeatMode(0); q.toggleAutoplay(); gate.resolve(); await restoring;
  assert.equal(q.volume, 35); assert.equal(q.repeatMode, 0); assert.equal(q.autoplay, false);
  assert.equal(f.saved()[0].volume, 35); assert.equal(f.saved()[0].repeatMode, 0); assert.equal(f.saved()[0].autoplay, false);
});

test('legacy checkpoints without breaker history restore normally', async t => {
  const f = fixture(t), data = f.saved();
  delete data[0].probe; delete data[0].failures;
  fs.writeFileSync(f.file, JSON.stringify(data));
  restoredHealth(t, f);
  const store = new QueueRecovery(f.client, f.d, f.file); t.after(() => store.stop()); await store.restore();
  assert.equal(f.d.getQueue(guildId).songs.length, 2);
  assert.equal(getPlaybackState(f.d.getQueue(guildId)).probe, false);
  assert.deepEqual(getPlaybackState(f.d.getQueue(guildId)).failures, []);
});

test('restoration keeps only recent failures and discards timestamps ahead of its clock', async t => {
  const now = Date.now(), recent = now - 1000, f = fixture(t), data = f.saved();
  data[0].failures = [now - 300_001, recent, now + 60_000];
  fs.writeFileSync(f.file, JSON.stringify(data));
  restoredHealth(t, f);
  const store = new QueueRecovery(f.client, f.d, f.file); t.after(() => store.stop()); await store.restore();
  assert.deepEqual(getPlaybackState(f.d.getQueue(guildId)).failures, [recent]);
});

test('an automatic startup deletion still preserves the snapshot for a subsequent restart', async t => {
  const f = fixture(t);
  f.d.play = async (_voice, playlist) => {
    const q = queue(playlist.songs); f.d.queues.collection.set(guildId, q); f.d.emit('initQueue', q);
    q.stopped = true; f.d.queues.collection.delete(guildId); f.d.emit('deleteQueue', q);
  };
  const store = new QueueRecovery(f.client, f.d, f.file); t.after(() => store.stop()); await store.restore();
  assert.equal(f.saved().length, 1);
  assert.equal(f.saved()[0].songs.length, 2);
});
