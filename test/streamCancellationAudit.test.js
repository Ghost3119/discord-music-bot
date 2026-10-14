const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { Song, TaskQueue } = require('distube');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
const { registerDisTubeEvents } = require('../dist/music/events');

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const audioError = Object.assign(new Error('ffmpeg stream failed'), { errorCode: 'FFMPEG_EXITED' });

function harness(t) {
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'error', () => {});
  const distube = new EventEmitter();
  const plugin = new YtDlpSearchPlugin();
  const queues = new Map();
  const now = { value: 1_000_000 };
  t.mock.method(Date, 'now', () => now.value);
  distube.plugins = [plugin];
  distube.getQueue = id => queues.get(id);
  distube.queues = { playSong: async () => {} };
  distube.handler = { attachStreamInfo: async song => { song.stream.url = await plugin.getStreamURL(song); } };
  distube.options = { ffmpeg: { path: 'unused' } };
  t.after(registerDisTubeEvents(distube));
  function queue(id, urlId = id) {
    const song = new Song({ plugin, source: 'youtube', playFromSource: true, id: urlId,
      name: 'Artist Song', duration: 200, url: `https://www.youtube.com/watch?v=${urlId}` });
    const next = new Song({ plugin, source: 'youtube', playFromSource: true, id: `${id}-next`, name: 'Next' });
    let lock = Promise.resolve();
    const q = { id, songs: [song, next], stopped: false, currentTime: 10, voice: new EventEmitter(),
      _taskQueue: new TaskQueue(), play: async () => {},
      remove: () => { q.stopped = true; q.songs = []; queues.delete(id); distube.emit('deleteQueue', q); },
      skip: async () => { await lock; q.songs.shift(); },
      stop: async () => { await lock; q.remove(); },
      seek: async () => { await lock; },
      ffmpegArgs: { global: {}, input: {}, output: {} }, filters: { ffmpegArgs: {} },
    };
    q.voice.play = async () => assert.fail('Cancelled preparation must not play audio');
    q.voice.stop = () => {};
    queues.set(id, q); distube.emit('initQueue', q);
    return { queue: q, song, lockUntil: promise => { lock = promise; } };
  }
  function renew(q, song, attempt) {
    for (let i = 0; i < attempt; i++) {
      assert.equal(q.songs.shift(), song);
      distube.emit('error', audioError, q, song);
      assert.equal(q.songs[0], song);
    }
    now.value += 3_000; // Expire the renewal backoff without waiting for wall time.
  }
  return { plugin, distube, queue, renew };
}

for (const attempt of [1, 2]) {
  for (const control of ['skip', 'stop', 'seek']) {
    test(`renewal ${attempt}: ${control} aborts the extraction before waiting for the queue lock`, async t => {
      const f = harness(t), item = f.queue('guild');
      const extraction = deferred(), entered = deferred();
      let signal;
      f.plugin.fetchInfo = async (_input, _flags, cancellation) => {
        signal = cancellation;
        entered.resolve();
        return extraction.promise;
      };
      f.renew(item.queue, item.song, attempt);
      const pending = f.distube.queues.playSong(item.queue);
      item.lockUntil(pending);
      await entered.promise;
      const operation = item.queue[control](15);
      try {
        assert.equal(signal?.aborted, true, 'The unshared yt-dlp extraction must receive an aborted signal');
      } finally {
        extraction.resolve({ url: 'https://audio.test/cancelled' });
        await Promise.all([pending, operation]);
      }
    });
  }
}

test('cancelling one guild releases its stream waiter while the other guild keeps the shared extraction', async t => {
  const f = harness(t), a = f.queue('a', 'shared'), b = f.queue('b', 'shared');
  const extraction = deferred();
  let signal, calls = 0;
  f.plugin.fetchInfo = async (_input, _flags, cancellation) => {
    calls++;
    signal = cancellation;
    return extraction.promise;
  };
  const firstController = new AbortController(), secondController = new AbortController();
  let aFinished = false;
  const first = f.plugin.getStreamURL(a.song, firstController.signal).finally(() => { aFinished = true; });
  const handledFirst = first.catch(error => error);
  const second = f.plugin.getStreamURL(b.song, secondController.signal);
  await tick();
  firstController.abort();
  await tick();
  try {
    assert.equal(calls, 1, 'Both guilds share the URL extraction');
    assert.equal(aFinished, true, 'The cancelled guild must stop waiting without awaiting another guild');
    assert.equal(signal?.aborted, false, 'Another guild still needs the shared extraction');
  } finally {
    extraction.resolve({ url: 'https://audio.test/shared' });
    await Promise.all([handledFirst, second]);
  }
  assert.equal(await second, 'https://audio.test/shared');
  assert.equal(await f.plugin.getStreamURL(b.song), 'https://audio.test/shared');
  assert.equal(calls, 1, 'The remaining guild can cache the completed extraction');
});

test('cancelling renewal backoff avoids extraction and leaves a later seek on the same song usable', async t => {
  const f = harness(t), { song } = f.queue('guild'), controller = new AbortController();
  let calls = 0;
  f.plugin.fetchInfo = async () => { calls++; return { url: 'https://audio.test/fresh-seek' }; };
  f.plugin.invalidateStream(song, 60_000);
  const pending = f.plugin.getStreamURL(song, controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(calls, 0, 'Cancelling during backoff must not enqueue an extraction');
  assert.equal(await f.plugin.getStreamURL(song), 'https://audio.test/fresh-seek');
  assert.equal(calls, 1);
});

test('the last cancelled stream consumer aborts extraction without deleting or caching over a fresh request', async t => {
  const f = harness(t), { song } = f.queue('guild');
  const old = deferred(), fresh = deferred(), signals = [];
  f.plugin.fetchInfo = async (_input, _flags, signal) => {
    signals.push(signal);
    return signals.length === 1 ? old.promise : fresh.promise;
  };
  const a = new AbortController(), b = new AbortController();
  const first = assert.rejects(f.plugin.getStreamURL(song, a.signal), { name: 'AbortError' });
  const second = assert.rejects(f.plugin.getStreamURL(song, b.signal), { name: 'AbortError' });
  a.abort();
  assert.equal(signals[0].aborted, false);
  b.abort();
  assert.equal(signals[0].aborted, true);
  await Promise.all([first, second]);
  const next = f.plugin.getStreamURL(song);
  assert.equal(signals.length, 2, 'A new seek must start fresh after all old consumers cancel');
  old.resolve({ url: 'https://audio.test/stale' });
  await tick();
  const joined = f.plugin.getStreamURL(song);
  assert.equal(signals.length, 2, 'Late cleanup of the old request must preserve its replacement');
  fresh.resolve({ url: 'https://audio.test/fresh' });
  assert.deepEqual(await Promise.all([next, joined]), ['https://audio.test/fresh', 'https://audio.test/fresh']);
  assert.equal(await f.plugin.getStreamURL(song), 'https://audio.test/fresh', 'Cancelled results must never overwrite the cache');
});
