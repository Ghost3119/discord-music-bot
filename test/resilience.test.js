const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const test = require('node:test');
const { Song } = require('distube');
const { guardedEvent } = require('../dist/runtime/safety');
const { handleInteraction } = require('../dist/events/interactionCreate');
const { registerDisTubeEvents } = require('../dist/music/events');
const { YtDlpSearchPlugin, rankSearchCandidates } = require('../dist/music/ytDlpSearchPlugin');
const { PlaybackRecovery } = require('../dist/music/playbackRecovery');
const { ExtractionPool, retryTransient, runYtDlp } = require('../dist/music/ytDlpRunner');
const { registerEmptyVoice } = require('../dist/music/emptyVoice');
const { PlayerPanels } = require('../dist/music/playerPanel');

const tick = () => new Promise((resolve) => setImmediate(resolve));
function song(plugin, id = 'AAAAAAAAAAA') {
  return new Song({ plugin, source: 'youtube', playFromSource: true, id, name: 'Artist Song', url: `https://www.youtube.com/watch?v=${id}` });
}

test('event boundaries absorb synchronous throws and rejected async handlers', async (t) => {
  const messages = [];
  t.mock.method(console, 'error', (...args) => messages.push(args));
  guardedEvent('sync', () => { throw new Error('sync error'); })();
  guardedEvent('async', async () => { throw new Error('async error'); })();
  await tick();
  assert.equal(messages.length, 2);
});

test('a failed button and a failed error reply never escape the interaction boundary', async (t) => {
  t.mock.method(console, 'error', () => {});
  let replies = 0;
  const message = { id: 'player-1', edit: async () => {} };
  const queue = { id: 'guild-1', songs: [song(null)], currentTime: 0, paused: false, voiceChannel: { id: 'voice-1' },
    textChannel: { id: 'text-1', send: async () => message }, pause: async () => { throw new Error('pause failed'); } };
  const distube = { getQueue: () => queue };
  const panels = new PlayerPanels(distube, 0);
  t.after(() => panels.dispose());
  await panels.show(queue);
  const interaction = {
    isButton: () => true, isRepliable: () => true,
    guild: { id: 'guild-1', members: { cache: new Map([['user-1', { voice: { channel: { id: 'voice-1' } } }]]) } },
    client: { distube }, member: { voice: {} }, user: { id: 'user-1' }, customId: 'btn_pause_resume', message,
    replied: false, deferred: false,
    reply: async () => { replies += 1; throw new Error('Missing Permissions'); },
    deferReply: async () => { interaction.deferred = true; },
    editReply: async () => { replies += 1; throw new Error('Missing Permissions'); },
  };
  await assert.doesNotReject(handleInteraction(interaction));
  assert.equal(replies, 1);
});

for (const code of [10062, 40060]) {
  for (const kind of ['button', 'command']) {
    test(`an unavailable ${kind} interaction ${code} is not acknowledged a second time`, async t => {
      const warnings = []; t.mock.method(console, 'warn', value => warnings.push(value));
      t.mock.method(console, 'error', () => {});
      let replies = 0, edits = 0;
      const value = { guild: { id: 'guild-1' }, guildId: 'guild-1', client: { distube: { getQueue: () => undefined } },
        customId: 'btn_queue', commandName: 'nowplaying', message: { id: 'obsolete', edit: async () => { edits++; } },
        isButton: () => kind === 'button', isAutocomplete: () => false, isChatInputCommand: () => kind === 'command',
        isRepliable: () => true, deferred: false, replied: false,
        reply: async () => { replies++; throw Object.assign(new Error('unavailable'), { code }); } };
      await assert.doesNotReject(handleInteraction(value));
      assert.equal(replies, 1); assert.equal(edits, 0); assert.equal(warnings.length, 1);
      assert.match(warnings[0], new RegExp(String(code)));
    });
  }
}

test('every playback notification handles missing Discord permissions', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  const distube = new EventEmitter();
  distube.plugins = [];
  const dispose = registerDisTubeEvents(distube);
  t.after(dispose);
  const current = song(null);
  const queue = { id: 'guild-1', voice: {}, songs: [current], textChannel: { id: 'text-1', send: async () => { throw new Error('Missing Permissions'); } } };
  for (const [event, args] of [
    ['playSong', [queue, current]], ['addSong', [queue, current]],
    ['addList', [queue, { songs: [], name: 'List' }]], ['disconnect', [queue]],
    ['noRelated', [queue]], ['error', [new Error('audio failed'), queue, current]],
  ]) {
    distube.emit(event, ...args);
    await tick();
  }
  assert.equal(errors.filter(([label]) => String(label).startsWith('[DisTube') || ['[Panel de reproducción]', '[Aviso de recuperación]'].includes(label)).length, 6);
});

test('streams get a permanent error observer before voice playback can fail', async (t) => {
  t.mock.method(console, 'error', () => {});
  const distube = new EventEmitter();
  registerDisTubeEvents(distube);
  const stream = new EventEmitter();
  const queue = { voice: { play: async (input) => {
    assert.equal(input.listenerCount('error'), 1);
    throw new Error('voice startup failed');
  } } };
  distube.emit('initQueue', queue);
  const protectedPlay = queue.voice.play;
  distube.emit('initQueue', queue);
  assert.equal(queue.voice.play, protectedPlay, 'Reusing a voice connection must not accumulate wrappers');
  await assert.rejects(queue.voice.play(stream), /voice startup failed/);
  assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error('closed'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })));
});

test('audio recovery resumes only a song that actually started playing', () => {
  const plugin = new YtDlpSearchPlugin();
  const current = song(plugin);
  current.duration = 200;
  const queue = { songs: [], stopped: false, currentTime: 120, _beginTime: 0 };
  const recovery = new PlaybackRecovery();
  recovery.retry(queue, current, { code: 'ECONNRESET' }, plugin);
  assert.equal(queue._beginTime, 0, 'A previous track playback time must not seek a new track');
  queue.songs.shift();
  recovery.markStarted(queue, current);
  recovery.retry(queue, current, { code: 'ECONNRESET' }, plugin);
  assert.equal(queue._beginTime, 119);
});

test('a different song by the requested artist is rejected in favor of the Music match', async () => {
  const plugin = new YtDlpSearchPlugin();
  plugin.fetchInfo = async (input) => {
    if (input.startsWith('ytsearch')) return { entries: [{ _type: 'url', title: 'Es de la Mafia', url: 'https://youtube.com/wrong' }] };
    if (input.endsWith('wrong')) return { id: 'wrong', title: 'Es de la Mafia', uploader: 'La Mafia del Amor', webpage_url: input };
    if (input.startsWith('https://music')) return { entries: [{ _type: 'url', title: 'Multiorgásmica', url: 'https://youtube.com/correct' }] };
    return { id: 'correct', title: 'Multiorgásmica', uploader: 'La Mafia del Amor', webpage_url: input };
  };
  assert.equal((await plugin.searchSong('la mafia del amor multiorgasmica', {})).id, 'correct');
});

test('an empty channel disconnect timer is cancelled when a person returns', async (t) => {
  const client = new EventEmitter();
  const distube = new EventEmitter();
  let humans = false;
  let stopped = 0;
  const queue = { id: 'guild', voiceChannel: { members: { some: () => humans } }, stop: async () => { stopped += 1; } };
  distube.getQueue = () => queue;
  const dispose = registerEmptyVoice(client, distube, 15);
  t.after(dispose);
  client.emit('voiceStateUpdate', {}, { guild: { id: 'guild' } });
  humans = true;
  client.emit('voiceStateUpdate', {}, { guild: { id: 'guild' } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(stopped, 0);
  humans = false;
  client.emit('voiceStateUpdate', {}, { guild: { id: 'guild' } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(stopped, 1);
});

test('audio recovery renews twice and offers one alternative attempt without losing the next song', () => {
  const plugin = new YtDlpSearchPlugin();
  const failed = song(plugin);
  const next = song(plugin, 'BBBBBBBBBBB');
  const queue = { stopped: false, songs: [next] };
  const recovery = new PlaybackRecovery();
  const error = { errorCode: 'FFMPEG_EXITED' };
  failed.stream.url = 'expired-audio';
  assert.equal(recovery.retry(queue, failed, error, plugin), 1);
  assert.equal(failed.stream.url, undefined);
  assert.deepEqual(queue.songs, [failed, next]);
  queue.songs.shift();
  assert.equal(recovery.retry(queue, failed, error, plugin), 2);
  queue.songs.shift();
  assert.equal(recovery.retry(queue, failed, error, plugin), 3);
  assert.equal(recovery.needsAlternative(queue, failed), true);
  queue.songs.shift();
  assert.equal(recovery.retry(queue, failed, error, plugin), 0);
  assert.deepEqual(queue.songs, [next]);
  recovery.dispose();
});

test('permanent failures and stopped queues are never reinserted', () => {
  const plugin = new YtDlpSearchPlugin();
  const current = song(plugin);
  const recovery = new PlaybackRecovery();
  const queue = { stopped: false, songs: [] };
  for (const code of ['PRIVATE_CONTENT', 'SOURCE_RATE_LIMITED', 'VOICE_MISSING_PERMS', 'FFMPEG_NOT_INSTALLED']) {
    assert.equal(recovery.retry(queue, current, { errorCode: code }, plugin), 0);
  }
  queue.stopped = true;
  assert.equal(recovery.retry(queue, current, { errorCode: 'FFMPEG_EXITED' }, plugin), 0);
  assert.equal(queue.songs.length, 0);
});

test('renewing a cached stream obtains a fresh URL and deduplicates concurrent requests', async () => {
  const plugin = new YtDlpSearchPlugin();
  const current = song(plugin);
  let calls = 0;
  plugin.fetchInfo = async (_input, flags) => {
    assert.equal(flags.noPlaylist, true);
    calls += 1;
    return { url: `https://audio.test/${calls}` };
  };
  assert.equal(await plugin.getStreamURL(current), 'https://audio.test/1');
  current.stream.url = 'https://audio.test/1';
  plugin.invalidateStream(current, 0);
  const results = await Promise.all([plugin.getStreamURL(current), plugin.getStreamURL(current)]);
  assert.deepEqual(results, ['https://audio.test/2', 'https://audio.test/2']);
  assert.equal(calls, 2);
});

test('search tries another candidate when the best result is unavailable', async () => {
  const plugin = new YtDlpSearchPlugin();
  const inputs = [];
  plugin.fetchInfo = async (input) => {
    inputs.push(input);
    if (input.startsWith('ytsearch')) return { entries: [
      { _type: 'url', title: 'Artist Song', url: 'https://youtube.com/first' },
      { _type: 'url', title: 'Artist Song audio', url: 'https://youtube.com/second' },
    ] };
    if (input.endsWith('first')) throw new Error('Video unavailable');
    return { id: 'BBBBBBBBBBB', extractor: 'youtube', title: 'Artist Song audio', webpage_url: input, url: 'https://audio.test/valid' };
  };
  const result = await plugin.searchSong('Artist Song', {});
  assert.equal(result.id, 'BBBBBBBBBBB');
  assert.equal(inputs.length, 3);
  assert.equal(await plugin.getStreamURL(result), 'https://audio.test/valid');
  assert.equal(inputs.length, 3);
});

test('a blocked source falls back to SoundCloud and enters a cooldown', async () => {
  const plugin = new YtDlpSearchPlugin();
  const inputs = [];
  plugin.fetchInfo = async (input) => {
    inputs.push(input);
    if (!input.startsWith('scsearch')) throw new Error('HTTP Error 429: Too Many Requests');
    return { entries: [{ id: 'sc-track', title: 'Artist Song', webpage_url: 'https://soundcloud.com/artist/song' }] };
  };
  assert.equal((await plugin.searchSong('Artist Song', {})).source, 'soundcloud');
  assert.equal((await plugin.searchSong('Artist Another Song', {})).source, 'soundcloud');
  assert.equal(inputs.filter((input) => input.startsWith('ytsearch')).length, 1);
  assert.equal(inputs.some((input) => input.startsWith('https://music')), false);
});

test('candidate ranking keeps the requested version ahead of unsolicited covers and remixes', () => {
  const candidates = [
    { title: 'Artist Song live cover' }, { title: 'Artist Song remix' }, { title: 'Song', uploader: 'Artist' },
  ];
  assert.equal(rankSearchCandidates('Artist Song', candidates)[0], candidates[2]);
  assert.equal(rankSearchCandidates('Artist Song remix', candidates)[0], candidates[1]);
});

test('transient retries are bounded and private or rate-limited content is not retried', async () => {
  let attempts = 0;
  const signal = new AbortController().signal;
  const waits = [];
  await assert.rejects(retryTransient(async () => {
    attempts += 1;
    throw Object.assign(new Error('network'), { code: 'ECONNRESET' });
  }, signal, 2, async (ms) => { waits.push(ms); }));
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [500, 1000]);
  for (const message of ['This video is private', 'HTTP Error 429: Too Many Requests']) {
    attempts = 0;
    await assert.rejects(retryTransient(async () => { attempts += 1; throw new Error(message); }, signal));
    assert.equal(attempts, 1);
  }
});

test('the extraction pool limits parallel work and cancels queued operations', async () => {
  const pool = new ExtractionPool(1, 1);
  let release;
  const first = pool.run(() => new Promise((resolve) => { release = resolve; }), new AbortController().signal);
  const abort = new AbortController();
  const waiting = pool.run(async () => assert.fail('Cancelled work must not run'), abort.signal);
  await assert.rejects(pool.run(async () => {}, new AbortController().signal), { code: 'MUSIC_BUSY' });
  const rejected = assert.rejects(waiting);
  abort.abort();
  await rejected;
  release('done');
  assert.equal(await first, 'done');
  assert.equal(await pool.run(async () => 'next', new AbortController().signal), 'next');
});

test('yt-dlp user cancellation kills the extraction and preserves its reason without retrying', async (t) => {
  const childProcess = require('node:child_process');
  const controller = new AbortController();
  let starts = 0;
  t.mock.method(childProcess, 'spawn', (_path, args, options) => {
    starts += 1;
    assert.ok(args.includes('--socket-timeout'));
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    options.signal.addEventListener('abort', () => {
      child.emit('error', Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }));
    }, { once: true });
    queueMicrotask(() => controller.abort());
    return child;
  });
  await assert.rejects(runYtDlp('test', {}, controller.signal), error => error === controller.signal.reason && error.name === 'AbortError');
  assert.equal(starts, 1);
});

test('uncaught exceptions and unhandled rejections exit once for supervisor recovery', async () => {
  const safety = require.resolve('../dist/runtime/safety');
  for (const trigger of ["setImmediate(() => { throw new Error('fatal-marker'); })", "Promise.reject(new Error('fatal-marker'))"]) {
    const script = `require(${JSON.stringify(safety)}).installProcessHandlers(code => process.exit(code)); ${trigger};`;
    await assert.rejects(promisify(execFile)(process.execPath, ['-e', script], { windowsHide: true, timeout: 5000 }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /fatal-marker/);
      return true;
    });
  }
});
