const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { Song, Playlist } = require('distube');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
const { PlaybackRecovery } = require('../dist/music/playbackRecovery');
const { RecoveryNotices, createRecoveryNotice } = require('../dist/music/recoveryNotices');
const { registerDisTubeEvents } = require('../dist/music/events');

const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const audioError = { errorCode: 'FFMPEG_EXITED', message: 'ffmpeg exited with code 3436169992' };
function track(plugin, id = 'original', extra = {}, options = {}) {
  return new Song({ plugin, source: 'youtube', playFromSource: true, id, name: 'Artist Song', duration: 200,
    url: `https://www.youtube.com/watch?v=${id}`, ...extra }, options);
}
function quiet(t) {
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'error', () => {});
}
function reachAlternative(recovery, queue, original, plugin) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(queue.songs.shift(), original);
    assert.equal(recovery.retry(queue, original, audioError, plugin), attempt);
    assert.equal(queue.songs[0], original, 'The failed head must be retained synchronously');
  }
}

test('alternative discovery prefers another source and preserves request metadata and playlist', async () => {
  const plugin = new YtDlpSearchPlugin();
  const original = track(plugin, 'original', { name: 'Artist Song (Official Music Video)' }, { metadata: { searchSource: 'youtube' } });
  new Playlist({ id: 'playlist', source: 'youtube', songs: [original] }, { metadata: original.metadata });
  const calls = [];
  plugin.fetchInfo = async (input, flags, signal) => {
    calls.push(input); assert.equal(signal.aborted, false);
    if (input.startsWith('scsearch')) {
      assert.equal(input, 'scsearch5:Artist Song');
      return { entries: [{ id: 'alternative', title: 'Artist Song', webpage_url: 'https://soundcloud.com/artist/song' }] };
    }
    assert.equal(flags.noPlaylist, true);
    return { id: 'alternative', title: 'Song', uploader: 'Artist', duration: 205,
      webpage_url: input, url: 'https://audio.test/valid' };
  };
  const alternative = await plugin.findAlternative(original);
  assert.equal(alternative.source, 'soundcloud');
  assert.equal(alternative.metadata, original.metadata);
  assert.equal(alternative.playlist, original.playlist);
  assert.equal(alternative.stream.url, 'https://audio.test/valid');
  assert.equal(await plugin.getStreamURL(alternative), 'https://audio.test/valid');
  assert.equal(calls.length, 2, 'Playback uses the freshly extracted URL');
});

test('alternative discovery rejects the same video under another URL and finds a different upload', async () => {
  const plugin = new YtDlpSearchPlugin();
  const original = track(plugin);
  const hydrated = [];
  plugin.fetchInfo = async (input, flags) => {
    if (input.startsWith('scsearch')) return { entries: [] };
    if (flags.flatPlaylist) return { entries: [
      { id: 'original', title: 'Artist Song', url: 'https://youtu.be/original' },
      { id: 'different', title: 'Artist Song', url: 'https://youtube.com/different' },
    ] };
    hydrated.push(input);
    return { id: 'different', title: 'Artist Song audio', duration: 200, webpage_url: input, url: 'https://audio.test/new' };
  };
  assert.equal((await plugin.findAlternative(original)).id, 'different');
  assert.deepEqual(hydrated, ['https://youtube.com/different']);
});

for (const [label, changes] of [
  ['another song', { title: 'Artist Different' }], ['a cover', { title: 'Artist Song cover' }],
  ['a remix', { title: 'Artist Song remix' }], ['an incompatible duration', { duration: 400 }],
  ['unknown duration', { duration: null }], ['a live stream', { is_live: true }],
  ['restricted content', { age_limit: 18 }], ['missing audio', { url: undefined }],
]) {
  test(`alternative discovery rejects ${label}`, async () => {
    const plugin = new YtDlpSearchPlugin();
    plugin.fetchInfo = async (input, flags) => flags.flatPlaylist
      ? { entries: [{ id: 'candidate', title: 'Artist Song', webpage_url: `https://candidate.test/${input.slice(0, 2)}` }] }
      : { id: 'candidate', title: 'Artist Song', duration: 200, webpage_url: input, url: 'https://audio.test/new', ...changes };
    assert.equal(await plugin.findAlternative(track(plugin)), null);
  });
}

test('metadata recovery checks artist separately even when a long title mostly matches', async () => {
  const plugin = new YtDlpSearchPlugin();
  const original = track(null, 'spotify', { source: 'spotify', playFromSource: false,
    name: 'One Two Three Four Five Six Seven Eight Nine Ten', uploader: { name: 'Rightartist' } });
  original.stream.song = track(plugin);
  plugin.fetchInfo = async (input, flags) => {
    if (flags.flatPlaylist) { assert.match(input, /Rightartist/); return { entries: [{ id: 'candidate', title: original.name, webpage_url: 'https://candidate.test/song' }] }; }
    return { id: 'candidate', title: original.name, uploader: 'Wrongartist', duration: 200,
      webpage_url: input, url: 'https://audio.test/new' };
  };
  assert.equal(await plugin.findAlternative(original), null);
});

test('discovery is bounded to six candidates and honours cancellation', async () => {
  const plugin = new YtDlpSearchPlugin();
  let hydrated = 0;
  plugin.fetchInfo = async (input, flags) => {
    if (flags.flatPlaylist) return { entries: Array.from({ length: 5 }, (_, id) => ({
      id: `${input}:${id}`, title: 'Artist Song', webpage_url: `https://candidate.test/${encodeURIComponent(input)}/${id}`,
    })) };
    hydrated++;
    return { title: 'Artist Song remix', duration: 200, webpage_url: input, url: 'https://audio.test/new' };
  };
  assert.equal(await plugin.findAlternative(track(plugin)), null);
  assert.equal(hydrated, 6);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(plugin.findAlternative(track(plugin), abort.signal), { name: 'AbortError' });
  assert.equal(hydrated, 6);
});

test('a blocked alternative provider falls back without repeatedly querying that provider', async () => {
  const plugin = new YtDlpSearchPlugin();
  let blocked = 0;
  plugin.fetchInfo = async (input, flags) => {
    if (input.startsWith('scsearch')) { blocked++; throw new Error('HTTP Error 403: Forbidden'); }
    if (flags.flatPlaylist) return { entries: [{ id: 'new', title: 'Artist Song', webpage_url: 'https://youtube.com/new' }] };
    return { id: 'new', title: 'Artist Song', duration: 200, webpage_url: input, url: 'https://audio.test/new' };
  };
  assert.equal((await plugin.findAlternative(track(plugin))).source, 'youtube');
  assert.equal((await plugin.findAlternative(track(plugin))).source, 'youtube');
  assert.equal(blocked, 1);
});

test('recovery replaces only the failed head, shares lookup and keeps the retry limit for its replacement', async t => {
  quiet(t);
  const plugin = new YtDlpSearchPlugin();
  const original = track(plugin), next = track(plugin, 'next'), alternative = track(plugin, 'alternative');
  const queue = { songs: [original, next], stopped: false, currentTime: 80, _beginTime: 79 };
  const recovery = new PlaybackRecovery(); t.after(() => recovery.dispose());
  const lookup = deferred(); let calls = 0;
  plugin.findAlternative = async () => { calls++; return lookup.promise; };
  reachAlternative(recovery, queue, original, plugin);
  const first = recovery.prepareAlternative(queue, original, plugin);
  const second = recovery.prepareAlternative(queue, original, plugin);
  lookup.resolve(alternative);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(calls, 1);
  assert.deepEqual(queue.songs, [alternative, next]);
  assert.equal(queue._beginTime, 0, 'A different recording starts at the beginning');
  queue.songs.shift();
  assert.equal(recovery.retry(queue, alternative, audioError, plugin), 0);
  assert.deepEqual(queue.songs, [next]);
});

for (const throws of [false, true]) {
  test(`a ${throws ? 'rejected' : 'fruitless'} lookup skips only the failed head`, async t => {
    quiet(t);
    const plugin = new YtDlpSearchPlugin(), original = track(plugin), next = track(plugin, 'next');
    const queue = { songs: [original, next], stopped: false, _beginTime: 40 };
    const statuses = [];
    const recovery = new PlaybackRecovery(status => statuses.push(status.stage)); t.after(() => recovery.dispose());
    plugin.findAlternative = async () => { if (throws) throw new Error('failed'); return null; };
    reachAlternative(recovery, queue, original, plugin);
    assert.equal(await recovery.prepareAlternative(queue, original, plugin), false);
    assert.deepEqual(queue.songs, [next]);
    assert.equal(statuses.at(-1), 'failed');
    assert.equal(queue._beginTime, 0);
  });
}

test('a result arriving after a manual change cannot replace the new head', async t => {
  quiet(t);
  const plugin = new YtDlpSearchPlugin(), original = track(plugin), next = track(plugin, 'next');
  const queue = { songs: [original, next], stopped: false };
  const recovery = new PlaybackRecovery(); t.after(() => recovery.dispose());
  const lookup = deferred(); plugin.findAlternative = () => lookup.promise;
  reachAlternative(recovery, queue, original, plugin);
  const pending = recovery.prepareAlternative(queue, original, plugin);
  queue.songs.shift();
  lookup.resolve(track(plugin, 'alternative'));
  assert.equal(await pending, false);
  assert.deepEqual(queue.songs, [next]);
  assert.equal(recovery.alternativeFailed(queue, original), false);
});

test('success requires audio progress, not just a playSong event or a seek position', async t => {
  quiet(t);
  const plugin = new YtDlpSearchPlugin(), original = track(plugin);
  const resource = { playbackDuration: 0 };
  const queue = { songs: [], stopped: false, currentTime: 80, voice: { stream: { audioResource: resource } } };
  const stages = [];
  const recovery = new PlaybackRecovery(status => stages.push(status.stage), 5); t.after(() => recovery.dispose());
  recovery.retry(queue, original, audioError, plugin);
  recovery.markStarted(queue, original);
  await wait(20);
  assert.deepEqual(stages, ['renew']);
  resource.playbackDuration = 20;
  await wait(20);
  assert.deepEqual(stages, ['renew', 'recovered']);
  recovery.dispose(); await wait(10);
  assert.equal(stages.length, 2);
});

test('recovery notices send once and edit yellow progress into green success', async () => {
  const notices = new RecoveryNotices();
  const original = track(null), sends = [], edits = [];
  const queue = { songs: [original], textChannel: { send: async payload => {
    sends.push(payload); return { edit: async payload => edits.push(payload) };
  } } };
  const status = { queue, original, song: original, code: 'SOURCE_BLOCKED', attempt: 1, stage: 'renew' };
  await notices.update(status);
  await notices.update({ ...status, stage: 'alternative', attempt: 3 });
  await notices.update({ ...status, stage: 'recovered', attempt: 3 });
  assert.equal(sends.length, 1); assert.equal(edits.length, 2);
  assert.equal(sends[0].embeds[0].data.color, 0xF0B232);
  assert.equal(edits[1].embeds[0].data.color, 0x3BA55D);
  assert.match(edits[1].embeds[0].data.description, /Audio recuperado en YouTube/);
  assert.deepEqual(sends[0].allowedMentions.parse, []);
  notices.dispose();
});

test('a status changed during send edits the same message to its latest result', async () => {
  const notices = new RecoveryNotices(), sending = deferred(), edits = [];
  const original = track(null); let sends = 0;
  const queue = { songs: [], textChannel: { send: async () => { sends++; return sending.promise; } } };
  const status = { queue, original, song: original, code: 'SOURCE_BLOCKED', attempt: 1, stage: 'renew' };
  const pending = notices.update(status); await tick();
  const latest = notices.update({ ...status, stage: 'failed', attempt: 3 });
  sending.resolve({ edit: async payload => edits.push(payload) });
  await Promise.all([pending, latest]);
  assert.equal(sends, 1); assert.equal(edits.length, 1);
  assert.match(edits[0].embeds[0].data.description, /No quedan canciones/);
  notices.dispose();
});

test('notice permission failures are contained and do not create replacement messages', async t => {
  quiet(t);
  const notices = new RecoveryNotices(), original = track(null); let sends = 0;
  const queue = { songs: [], textChannel: { send: async () => { sends++; throw new Error('Missing Permissions'); } } };
  const status = { queue, original, song: original, code: 'SOURCE_BLOCKED', attempt: 1, stage: 'renew' };
  await assert.doesNotReject(notices.update(status));
  await assert.doesNotReject(notices.update({ ...status, stage: 'failed' }));
  assert.equal(sends, 1); notices.dispose();
  const description = createRecoveryNotice({ ...status, original: track(null, 'test', { name: '**test**' }), stage: 'failed' }).data.description;
  assert.match(description, /\\\*\\\*test\\\*\\\*/);
});

test('a notice arriving just as the previous write completes is not stranded', async () => {
  const notices = new RecoveryNotices(), original = track(null), edits = [];
  let late;
  const queue = { songs: [], textChannel: { send: () => Promise.resolve({ edit: async payload => edits.push(payload) }).then(message => {
    queueMicrotask(() => queueMicrotask(() => { late = notices.update({ ...status, stage: 'failed' }); }));
    return message;
  }) } };
  const status = { queue, original, song: original, code: 'SOURCE_BLOCKED', attempt: 1, stage: 'renew' };
  await notices.update(status);
  await late;
  assert.equal(edits.length, 1);
  assert.match(edits[0].embeds[0].data.description, /No pude reproducir/);
  notices.dispose();
});

function eventHarness(t, withNext = true, skipFails = false) {
  quiet(t);
  const distube = new EventEmitter(), plugin = new YtDlpSearchPlugin();
  const original = track(plugin), next = track(plugin, 'next'), played = [];
  let lock = Promise.resolve();
  distube.plugins = [plugin];
  const queue = { id: 'guild', songs: withNext ? [original, next] : [original], stopped: false,
    voice: { play: async () => {}, stop: () => {} },
    remove: () => { queue.stopped = true; queue.songs = []; distube.emit('deleteQueue', queue); },
    skip: async () => { await lock; if (skipFails) throw new Error('NO_UP_NEXT'); queue.songs.shift(); },
    stop: async () => { await lock; queue.remove(); },
  };
  distube.getQueue = () => queue.stopped ? undefined : queue;
  const native = async q => { played.push(q.songs[0]); };
  distube.queues = { playSong: native };
  queue.play = () => distube.queues.playSong(queue);
  t.after(registerDisTubeEvents(distube));
  distube.emit('initQueue', queue);
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(queue.songs.shift(), original);
    distube.emit('error', audioError, queue, original);
    assert.equal(queue.songs[0], original);
  }
  return { distube, plugin, original, next, played, queue, lockUntil: pending => { lock = pending; } };
}

test('the playback hook waits for lookup then plays the replacement once', async t => {
  const { distube, plugin, queue, played, next } = eventHarness(t);
  const lookup = deferred(), alternative = track(plugin, 'alternative');
  plugin.findAlternative = () => lookup.promise;
  const pending = distube.queues.playSong(queue);
  const duplicate = distube.queues.playSong(queue);
  await tick(); assert.equal(played.length, 0);
  lookup.resolve(alternative); await Promise.all([pending, duplicate]);
  assert.deepEqual(played, [alternative]); assert.deepEqual(queue.songs, [alternative, next]);
});

test('an empty failed recovery removes the queue without waiting for its own task lock', async t => {
  const { distube, plugin, queue, played } = eventHarness(t, false);
  plugin.findAlternative = async () => null;
  queue.stop = () => assert.fail('stop() would deadlock an already held queue lock');
  await distube.queues.playSong(queue);
  assert.equal(queue.stopped, true); assert.equal(played.length, 0);
});

test('a failed recovery plays the next queued song', async t => {
  const { distube, plugin, queue, played, next } = eventHarness(t);
  plugin.findAlternative = async () => null;
  await distube.queues.playSong(queue);
  assert.deepEqual(played, [next]); assert.deepEqual(queue.songs, [next]);
});

for (const control of ['skip', 'stop']) {
  test(`${control} aborts lookup before waiting for the playback lock`, { timeout: 2000 }, async t => {
    const { distube, plugin, queue, played, next, lockUntil } = eventHarness(t);
    let aborted = false;
    plugin.findAlternative = (_song, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
    });
    const pending = distube.queues.playSong(queue);
    lockUntil(pending);
    await tick();
    await queue[control]();
    await pending;
    assert.equal(aborted, true); assert.equal(played.length, 0);
    assert.deepEqual(queue.songs, control === 'skip' ? [next] : []);
  });
}

test('a rejected skip after cancelling lookup cannot leave the failed song stuck', { timeout: 2000 }, async t => {
  const { distube, plugin, queue, played, lockUntil } = eventHarness(t, false, true);
  plugin.findAlternative = (_song, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const pending = distube.queues.playSong(queue);
  lockUntil(pending);
  await tick();
  await assert.rejects(queue.skip(), /NO_UP_NEXT/);
  await pending;
  assert.equal(queue.stopped, true); assert.equal(played.length, 0);
});
