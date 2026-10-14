const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Song } = require('distube');
const { MessageFlags } = require('discord.js');
const { PlaybackHealth } = require('../dist/music/playbackHealth');
const { getPlaybackState, initPlaybackState } = require('../dist/music/playbackState');
const { HistoryStore, publicMusicUrl } = require('../dist/music/history');
const { historyView } = require('../dist/music/historyView');
const { editQueue } = require('../dist/music/queueActions');
const { registerCheckpoint } = require('../dist/music/queueChanges');
const { createPlayerButtons, queueEstimates, queueRemaining, createQueueEmbed } = require('../dist/utils/embed');
const { registerDisTubeEvents } = require('../dist/music/events');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
const { estado, historial } = require('../dist/commands/diagnostics');
const { handleButton } = require('../dist/events/buttonHandler');
const { handleInteraction } = require('../dist/events/interactionCreate');
const { play } = require('../dist/commands/play');
const { recommend } = require('../dist/commands/recommend');

const guildId = '1082065100111872170';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function song(id = 'AAAAAAAAAAA', plugin = null) { return new Song({ plugin, source: 'youtube', id, name: `Artist ${id}`, duration: 200,
  playFromSource: true, url: `https://www.youtube.com/watch?v=${id}` }); }
function quiet(t) { t.mock.method(console, 'info', () => {}); t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {}); }
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-ops-'));
  t.after(() => { assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
function lock() {
  let tail = Promise.resolve(); const releases = [];
  return { async queuing() { const previous = tail; tail = new Promise(resolve => releases.push(resolve)); await previous; }, resolve() { releases.shift()(); } };
}
function fixture(t, options = {}) {
  quiet(t);
  let now = 1_000_000;
  const current = song(), queue = { id: guildId, songs: [current, song('BBBBBBBBBBB')], currentTime: 50, paused: false, stopped: false,
    autoplay: true, repeatMode: 0, voiceChannel: { id: 'voice', name: 'Lounge' }, _taskQueue: lock(),
    voice: { stream: { audioResource: { playbackDuration: 0 } }, pause() {}, unpause() {} }, play: async () => {} };
  const distube = new EventEmitter(); distube.getQueue = id => id === queue.id && !queue.stopped ? queue : undefined;
  const stalls = [], history = new HistoryStore();
  const health = new PlaybackHealth(distube, history, () => {}, async q => { stalls.push(q); }, { interval: 0, clock: () => now, ...options });
  health.init(queue); health.started(queue, current); t.after(() => health.dispose());
  function advance(ms = 2000, frames) {
    now += ms; if (frames !== undefined) queue.voice.stream.audioResource.playbackDuration = frames; health.tick();
  }
  return { queue, distube, health, history, stalls, advance, state: getPlaybackState(queue), now: () => now };
}

test('the monitor recovers after 8 seconds of stalled frames, once per stall', t => {
  const f = fixture(t); f.advance(2000, 20);
  for (let i = 0; i < 3; i++) f.advance(); assert.equal(f.stalls.length, 0);
  f.advance(); assert.equal(f.stalls.length, 1);
  for (let i = 0; i < 20; i++) f.advance(); assert.equal(f.stalls.length, 1);
});
test('first audio gets 12 seconds, without another eight seconds of grace', t => {
  const f = fixture(t);
  for (let i = 0; i < 5; i++) f.advance(); assert.equal(f.stalls.length, 0);
  f.advance(); assert.equal(f.stalls.length, 1);
});
test('paused time, active extraction and disconnected voice do not trigger the monitor', t => {
  const f = fixture(t); f.queue.paused = true;
  for (let i = 0; i < 100; i++) f.advance();
  f.queue.paused = false; f.state.busy = 1;
  for (let i = 0; i < 100; i++) f.advance();
  f.state.busy = 0; f.queue.voice.isDisconnected = true;
  for (let i = 0; i < 100; i++) f.advance();
  assert.equal(f.stalls.length, 0); assert.equal(f.state.mode, 'disconnected');
});
test('continuous audio resets a failure streak; short completed songs do too', t => {
  const f = fixture(t); f.state.failures = [f.now()]; f.state.probe = true;
  for (let i = 1; i <= 15; i++) f.advance(2000, i * 2000);
  assert.deepEqual(f.state.failures, []); assert.equal(f.state.probe, false);
  f.state.failures = [f.now()]; f.health.completed(f.queue, f.queue.songs[0]); assert.deepEqual(f.state.failures, []);
});
test('three exhausted requests block playback and preserve the failed head and pending songs', t => {
  const f = fixture(t), original = song('CCCCCCCCCCC'), next = song('DDDDDDDDDDD');
  f.queue.songs = [song(), song('BBBBBBBBBBB'), original, next];
  const refs = [];
  for (let i = 0; i < 3; i++) {
    const failed = f.queue.songs.shift();
    const status = { queue: f.queue, original: failed, song: failed, stage: 'failed', attempt: 3, code: 'SOURCE_BLOCKED' };
    f.health.recovery(status); refs.push(f.state.lastError.reference);
    f.health.recovery(status); // duplicate terminal notification must not count twice
  }
  assert.equal(new Set(refs).size, 3);
  assert.equal(f.state.failures.length, 3); assert.equal(f.state.blocked, true);
  assert.equal(f.queue.paused, true); assert.deepEqual(f.queue.songs, [original, next]);
  assert.equal(f.history.list(guildId).length, 3);
});
test('manual retry creates one fresh request and a failed probe blocks immediately', async t => {
  const f = fixture(t); f.health.restoreBlocked(f.queue);
  const original = f.queue.songs[0]; original.stream.url = 'expired';
  let calls = 0; f.queue.play = async () => { calls++; f.state.busy++; };
  await Promise.all([f.health.retryBlocked(f.queue), f.health.retryBlocked(f.queue)]);
  assert.equal(calls, 1); assert.notEqual(f.queue.songs[0], original); assert.equal(f.queue.songs[0].stream.url, undefined);
  const failed = f.queue.songs.shift();
  f.health.recovery({ queue: f.queue, original: failed, song: failed, stage: 'failed', attempt: 3, code: 'SOURCE_BLOCKED' });
  assert.equal(f.state.blocked, true); assert.equal(f.state.failures.length, 1);
});
test('an old or stopped queue is never recovered by its timer', t => {
  const f = fixture(t); f.distube.getQueue = () => ({ id: guildId });
  for (let i = 0; i < 20; i++) f.advance(); assert.equal(f.stalls.length, 0);
  assert.equal(f.state.mode, 'ended');
});

test('an hour of advancing audio and repeated session cleanup leave no stale monitor work', t => {
  const f = fixture(t);
  for (let i = 1; i <= 1800; i++) f.advance(2000, i * 2000);
  assert.equal(f.stalls.length, 0);
  f.health.end(f.queue);
  for (let i = 0; i < 100; i++) {
    const queue = { ...f.queue, id: String(i), stopped: false };
    f.health.init(queue); f.health.end(queue);
  }
  assert.equal(f.health.queues.size, 0);
});

test('failures in one guild do not block a second guild', t => {
  const f = fixture(t), second = { ...f.queue, id: '2082065100111872170', songs: [song()] };
  f.health.init(second);
  for (let i = 0; i < 3; i++) {
    const failed = song(String(i).repeat(11));
    f.health.recovery({ queue: f.queue, original: failed, song: failed, stage: 'failed', attempt: 3, code: 'SOURCE_BLOCKED' });
  }
  assert.equal(f.state.blocked, true); assert.equal(getPlaybackState(second).blocked, false);
});
test('monitor and breaker can be independently disabled', t => {
  const f = fixture(t, { monitor: false, breaker: false });
  for (let i = 0; i < 10; i++) f.advance(); assert.equal(f.stalls.length, 0);
  for (let i = 0; i < 5; i++) { const failed = song(String(i).repeat(11)); f.health.recovery({ queue: f.queue, original: failed, song: failed, stage: 'failed', attempt: 0, code: 'PRIVATE_CONTENT' }); }
  assert.equal(f.state.blocked, false);
});

test('history aliases alternatives and records each request exactly once without stream credentials', async t => {
  const file = path.join(temp(t), 'history.json'), store = new HistoryStore(file);
  const original = song(), alternative = song('BBBBBBBBBBB'), queue = { id: guildId };
  original.stream.url = 'https://audio.test/?token=audio-secret';
  original.url += '&token=url-secret';
  store.begin(queue, original); store.alias(queue, original, alternative);
  assert.equal(store.finish(queue, alternative, 'completed'), true);
  assert.equal(store.finish(queue, original, 'failed'), false);
  await store.flush();
  const data = fs.readFileSync(file, 'utf8'); assert.doesNotMatch(data, /audio-secret|url-secret|audio\.test/);
  const entry = new HistoryStore(file).list(guildId)[0]; assert.equal(entry.title, original.name); assert.equal(entry.alternative, alternative.name);
  assert.equal(entry.url, 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
});
test('history keeps 100 entries per guild and ignores corrupt input', async t => {
  quiet(t); const file = path.join(temp(t), 'history.json'), store = new HistoryStore(file), queue = { id: guildId };
  for (let i = 0; i < 130; i++) store.finish(queue, song(String(i).padStart(11, 'A')), 'completed');
  await store.flush(); assert.equal(store.list(guildId).length, 100);
  assert.equal(new HistoryStore(file).list(guildId).length, 100);
  fs.writeFileSync(file, '{broken'); assert.deepEqual(new HistoryStore(file).list(guildId), []);
});

test('history expires old entries and bounds serialized storage across many guilds', t => {
  const file = path.join(temp(t), 'history.json'), now = Date.now();
  const entries = Array.from({ length: 2000 }, (_, i) => ({ id: i.toString(16).padStart(16, '0'),
    guildId: String(BigInt(guildId) + BigInt(i)), title: '🎵'.repeat(100), source: 'youtube', time: now,
    result: 'completed', code: '', reference: '', searchSource: 'youtube', alternative: '🎵'.repeat(100),
    url: `https://soundcloud.com/${'a'.repeat(125)}/${'b'.repeat(125)}` }));
  entries[0].time = now - 8 * 24 * 60 * 60_000;
  fs.writeFileSync(file, JSON.stringify(entries));
  const store = new HistoryStore(file), kept = store.entries;
  assert.equal(store.list(guildId).length, 0);
  assert.ok(kept.length > 0 && kept.length < 1999);
  assert.ok(Buffer.byteLength(JSON.stringify(kept)) <= 2_500_000);
});

test('history disk failures keep the in-memory history available without rejected writes', async t => {
  quiet(t); const directory = temp(t), file = path.join(directory, 'parent'); fs.writeFileSync(file, 'not a directory');
  const store = new HistoryStore(path.join(file, 'history.json'));
  store.finish({ id: guildId }, song(), 'failed', 'SOURCE_BLOCKED'); await store.flush();
  assert.equal(store.list(guildId).length, 1);
  await store.close();
});
test('history rejects unsafe sources, prevents double retries and scopes entries to their guild', () => {
  for (const input of ['https://audio.test/?token=secret', 'javascript:alert(1)', 'https://evil.test/youtube.com/watch?v=AAAAAAAAAAA', 'https://user:pass@youtube.com/watch?v=AAAAAAAAAAA']) assert.equal(publicMusicUrl(input), undefined);
  const store = new HistoryStore(), queue = { id: guildId };
  store.finish(queue, song(), 'failed', 'SOURCE_BLOCKED');
  const entry = store.list(guildId)[0]; assert.equal(store.claim('other', entry.id), undefined);
  assert.ok(store.claim(guildId, entry.id)); assert.equal(store.claim(guildId, entry.id), undefined);
});
test('history pages keep Discord component IDs unique at both boundaries', () => {
  const store = new HistoryStore(); for (let i = 0; i < 17; i++) store.finish({ id: guildId }, song(), 'completed');
  for (const page of [0, 1, 3, 99]) {
    const payload = historyView(store, guildId, page), ids = payload.components.flatMap(row => row.toJSON().components.map(button => button.custom_id));
    assert.equal(new Set(ids).size, ids.length); assert.ok(ids.every(id => id.length <= 100));
    assert.ok(payload.components.every(row => row.components.length <= 5));
  }
});

test('queue edits serialize, protect the current song and checkpoint the final order', async t => {
  const f = fixture(t), current = f.queue.songs[0]; f.queue.songs.push(song('CCCCCCCCCCC'), song('DDDDDDDDDDD'));
  const saved = []; t.after(registerCheckpoint(f.distube, q => saved.push(q.songs.map(s => s.id))));
  await Promise.all([editQueue(f.distube, f.queue, { type: 'move', from: 3, to: 1 }), editQueue(f.distube, f.queue, { type: 'remove', position: 2 })]);
  assert.deepEqual(f.queue.songs.map(s => s.id), ['AAAAAAAAAAA', 'DDDDDDDDDDD', 'CCCCCCCCCCC']);
  assert.equal(f.queue.songs[0], current); assert.equal(saved.length, 2); assert.equal(f.state.revision, 2);
  await editQueue(f.distube, f.queue, { type: 'clear' }); assert.deepEqual(f.queue.songs, [current]);
});
test('queue edits reject invalid indices and changed authorization after waiting', async t => {
  const f = fixture(t), original = [...f.queue.songs];
  await assert.rejects(editQueue(f.distube, f.queue, { type: 'remove', position: 0 }), /Posición/);
  await assert.rejects(editQueue(f.distube, f.queue, { type: 'move', from: 1, to: 8 }), /Posiciones/);
  await assert.rejects(editQueue(f.distube, f.queue, { type: 'clear' }, () => false), /canal de voz/);
  assert.deepEqual(f.queue.songs, original);
  await editQueue(f.distube, f.queue, { type: 'shuffle' }); assert.equal(f.queue.songs[0], original[0]);
});
test('estimates use remaining time, become unknown beyond a live track, and explain pause/repeat', t => {
  const f = fixture(t); f.state.mode = 'playing'; f.queue.songs.push(song('CCCCCCCCCCC'));
  assert.deepEqual(queueEstimates(f.queue), [0, 150, 350]); assert.match(queueRemaining(f.queue), /09:10/);
  f.queue.paused = true; assert.match(queueRemaining(f.queue), /reanudación/);
  assert.match(createQueueEmbed(f.queue).data.description, /al reanudar/);
  f.queue.songs[1].isLive = true; assert.deepEqual(queueEstimates(f.queue), [0, 150, null]);
  f.queue.repeatMode = 1; assert.deepEqual(queueEstimates(f.queue), [null, null, null]);
  f.queue.repeatMode = 0; f.state.blocked = true; f.state.mode = 'blocked'; assert.deepEqual(queueEstimates(f.queue), [null, null, null]);
  const buttons = createPlayerButtons(true, false, false, true).toJSON().components;
  assert.equal(buttons[0].label, 'Reintentar'); assert.equal(buttons[1].disabled, true); assert.equal(buttons[3].disabled, false);
});

function buttonInteraction(distube, customId) {
  const replies = [], edits = [], voice = { id: 'voice', permissionsFor: () => ({ has: () => true }) };
  const member = { voice: { channel: voice } };
  const interaction = { customId, guildId, guild: { id: guildId, members: { cache: new Map([['user', member]]) } }, user: { id: 'user' },
    client: { distube, user: { id: 'bot' }, isReady: () => true, ws: { ping: 42 } }, deferred: false, replied: false,
    reply: async p => { replies.push(p); interaction.replied = true; }, deferReply: async p => { replies.push(p); interaction.deferred = true; },
    deferUpdate: async () => { interaction.deferred = true; }, editReply: async p => { edits.push(p); }, isRepliable: () => true,
  };
  return { interaction, replies, edits, member };
}
test('/estado and /historial remain private and do not run searches when there is no queue', async t => {
  quiet(t); const distube = new EventEmitter(); distube.getQueue = () => undefined;
  const health = new PlaybackHealth(distube, new HistoryStore(), undefined, undefined, { interval: 0 }); t.after(() => health.dispose());
  const f = buttonInteraction(distube, ''); await estado.execute(f.interaction); await historial.execute(f.interaction);
  assert.equal(f.replies.length, 2); assert.ok(f.replies.every(reply => reply.flags === MessageFlags.Ephemeral));
  assert.match(JSON.stringify(f.replies), /Sin cola/);
});
test('history retry uses public origin, works without a queue and suppresses concurrent clicks', async t => {
  quiet(t); const distube = new EventEmitter(), played = []; distube.getQueue = () => undefined; distube.plugins = [];
  distube.play = async (...args) => { played.push(args); };
  const store = new HistoryStore(); store.finish({ id: guildId }, song(), 'failed', 'SOURCE_BLOCKED');
  const health = new PlaybackHealth(distube, store, undefined, undefined, { interval: 0 }); t.after(() => health.dispose());
  const id = store.list(guildId)[0].id, a = buttonInteraction(distube, `hist_retry:${guildId}:${id}`), b = buttonInteraction(distube, `hist_retry:${guildId}:${id}`);
  await Promise.all([handleButton(a.interaction), handleButton(b.interaction)]);
  assert.equal(played.length, 1); assert.equal(played[0][1], song().url);
  assert.equal(a.replies[0].flags, MessageFlags.Ephemeral); assert.match(b.replies[0].content, /30 segundos/);
});
test('an outsider cannot control playback through slash commands', async t => {
  const f = fixture(t), interaction = buttonInteraction(f.distube, '').interaction;
  interaction.guild.members.cache.get('user').voice.channel.id = 'different';
  interaction.commandName = 'stop'; interaction.isButton = () => false; interaction.isAutocomplete = () => false; interaction.isChatInputCommand = () => true;
  let stops = 0; f.queue.stop = async () => { stops++; };
  await handleInteraction(interaction); assert.equal(stops, 0);
});

test('invalid queue positions complete the deferred reply with an explicit error', async t => {
  const f = fixture(t), b = buttonInteraction(f.distube, '');
  b.interaction.commandName = 'remove'; b.interaction.options = { getInteger: () => 99 };
  b.interaction.isButton = () => false; b.interaction.isAutocomplete = () => false; b.interaction.isChatInputCommand = () => true;
  await handleInteraction(b.interaction);
  assert.equal(b.edits.length, 1); assert.match(b.edits[0].content, /INVALID_QUEUE_POSITION/);
});
test('a delayed /play lookup does not revive an ended session', async t => {
  const f = fixture(t), plugin = new YtDlpSearchPlugin(), lookup = deferred(); f.distube.plugins = [plugin];
  plugin.searchSong = () => lookup.promise;
  let calls = 0; f.distube.play = async () => { calls++; };
  const b = buttonInteraction(f.distube, ''); b.interaction.options = { getString: key => key === 'query' ? 'Artist Song' : 'youtube' };
  const pending = play.execute(b.interaction); await tick(); f.queue.stopped = true; lookup.resolve(song()); await pending;
  assert.equal(calls, 0); assert.match(JSON.stringify(b.edits), /cambió/);
});

test('late recommendations cannot refill a cleared queue or act after a voice-channel change', async t => {
  for (const change of ['clear', 'voice']) {
    const f = fixture(t), plugin = new YtDlpSearchPlugin(), lookup = deferred(); f.distube.plugins = [plugin];
    f.queue.previousSongs = []; let added = 0; f.queue.addToQueue = () => { added++; };
    plugin.getRecommendations = () => lookup.promise;
    const b = buttonInteraction(f.distube, ''); b.interaction.options = { getInteger: () => 1 };
    const pending = recommend.execute(b.interaction); await tick();
    if (change === 'clear') await editQueue(f.distube, f.queue, { type: 'clear' });
    else b.member.voice.channel.id = 'other';
    lookup.resolve([song('CCCCCCCCCCC')]); await pending;
    assert.equal(added, 0); assert.match(JSON.stringify(b.edits), /cambió/);
  }
});

function engine(t) {
  quiet(t); const distube = new EventEmitter(), queue = { id: guildId, songs: [song()], stopped: false, paused: false, autoplay: false,
    currentTime: 0, volume: 80, repeatMode: 0, ffmpegArgs: { global: {}, input: {}, output: {} }, filters: { ffmpegArgs: {} },
    voice: { play: async stream => { queue.voice.stream = stream; }, stop() {}, pause() {}, unpause() {} },
    remove() { queue.stopped = true; queue.songs = []; distube.emit('deleteQueue', queue); },
    stop: async () => { queue.remove(); }, _taskQueue: lock(),
  };
  distube.getQueue = () => queue.stopped ? undefined : queue;
  distube.plugins = []; distube.options = { ffmpeg: { path: require('ffmpeg-static') } };
  distube.queues = { playSong: async () => assert.fail('The unsafe native start must not run'), handleSongFinish: async () => {} };
  distube.handler = { attachStreamInfo: async current => { current.stream.url = 'https://audio.test/stream'; } };
  t.after(registerDisTubeEvents(distube, undefined, { interval: 0 }));
  t.after(() => queue.voice.stream?.kill());
  queue.play = () => distube.queues.playSong(queue);
  distube.emit('initQueue', queue);
  return { distube, queue };
}

test('disposing playback observers releases listeners before another registration', t => {
  quiet(t); const distube = new EventEmitter();
  const playSong = async () => {}, handleSongFinish = async () => {};
  distube.queues = { playSong, handleSongFinish };
  for (let i = 0; i < 20; i++) {
    const dispose = registerDisTubeEvents(distube, undefined, { interval: 0 });
    assert.equal(distube.listenerCount('playSong'), 1);
    dispose(); assert.equal(distube.eventNames().length, 0);
    assert.equal(distube.queues.playSong, playSong); assert.equal(distube.queues.handleSongFinish, handleSongFinish);
  }
});
test('the stream engine verifies ownership after extraction before starting FFmpeg', async t => {
  const f = engine(t), lookup = deferred(); let starts = 0;
  f.distube.handler.attachStreamInfo = async current => { await lookup.promise; current.stream.url = 'https://audio.test/stream'; };
  f.queue.voice.play = async () => { starts++; };
  const pending = f.queue.play(); await tick(); f.queue.remove(); lookup.resolve(); await pending;
  assert.equal(starts, 0);
});
test('blocked queues never enter native playback or finish/radio handling', async t => {
  const f = engine(t), state = getPlaybackState(f.queue); state.blocked = true; state.mode = 'blocked';
  f.distube.handler.attachStreamInfo = async () => assert.fail('Blocked queue requested audio');
  await f.queue.play(); await f.distube.queues.handleSongFinish(f.queue); assert.equal(f.queue.songs.length, 1);
});
test('stream extraction failures skip safely under a held task lock without waiting on stop', async t => {
  const f = engine(t); f.distube.handler.attachStreamInfo = async () => { throw new Error('This video is private'); };
  f.queue.stop = async () => assert.fail('stop() would wait on the current task lock');
  await f.queue._taskQueue.queuing();
  try { await f.queue.play(); } finally { f.queue._taskQueue.resolve(); }
  assert.equal(f.queue.stopped, true);
});
test('a real DisTubeStream is created without launching a second bot or external connection', async t => {
  const f = engine(t); await f.queue.play();
  assert.ok(f.queue.voice.stream.audioResource); assert.equal(f.queue.voice.stream.process, undefined);
  assert.equal(getPlaybackState(f.queue).mode, 'preparing');
});

test('the stream engine exhausts recovery for three requests and preserves the remaining playlist', async t => {
  const f = engine(t), plugin = new YtDlpSearchPlugin(); f.distube.plugins = [plugin];
  f.queue.songs = ['AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC', 'DDDDDDDDDDD'].map(id => song(id, plugin));
  let extracts = 0, alternatives = 0;
  plugin.getStreamURL = async () => { extracts++; throw new Error('HTTP error 403 Forbidden'); };
  f.distube.handler.attachStreamInfo = async current => { current.stream.url = await plugin.getStreamURL(current); };
  plugin.findAlternative = async () => { alternatives++; return null; };
  await f.queue._taskQueue.queuing();
  try { await f.queue.play(); } finally { f.queue._taskQueue.resolve(); }
  const state = getPlaybackState(f.queue);
  assert.equal(extracts, 9); assert.equal(alternatives, 3);
  assert.equal(state.blocked, true); assert.equal(f.queue.paused, true); assert.equal(state.failures.length, 3);
  assert.deepEqual(f.queue.songs.map(s => s.id), ['CCCCCCCCCCC', 'DDDDDDDDDDD']);
  const { getPlaybackHealth } = require('../dist/music/playbackHealth');
  assert.equal(getPlaybackHealth(f.distube).history.list(guildId).length, 3);
});

test('a new track starts with a fresh attempt indicator while retaining the last incident', t => {
  const f = fixture(t), failed = f.queue.songs.shift();
  f.health.recovery({ queue: f.queue, original: failed, song: failed, stage: 'failed', attempt: 3, code: 'SOURCE_BLOCKED' });
  const reference = f.state.lastError.reference;
  f.health.beforePlay(f.queue, f.queue.songs[0]); f.health.afterPlay(f.queue);
  assert.equal(f.state.attempt, 0); assert.equal(f.state.mode, 'preparing'); assert.equal(f.state.lastError.reference, reference);
});
