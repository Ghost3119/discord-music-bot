const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { Playlist } = require('distube');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
const { runYtDlp } = require('../dist/music/ytDlpRunner');

const tick = () => new Promise(resolve => setImmediate(resolve));

test('a 500-entry YouTube playlist resolves from flat metadata and defers audio extraction', async () => {
  const plugin = new YtDlpSearchPlugin(), calls = [];
  let hydratedEntries = 0;
  const entries = Array.from({ length: 500 }, (_, index) => ({
    _type: 'url', ie_key: 'Youtube', id: String(index).padStart(11, '0'),
    title: `Song ${index}`, url: `https://www.youtube.com/watch?v=${String(index).padStart(11, '0')}`,
    duration: index ? 200 : null, live_status: index ? null : 'is_live',
    uploader: 'Artist', uploader_url: 'https://www.youtube.com/@artist',
    thumbnails: [{ url: `https://i.ytimg.com/vi/${String(index).padStart(11, '0')}/hqdefault.jpg` }],
  }));
  plugin.fetchInfo = async (input, flags) => {
    calls.push({ input, flags });
    if (flags.noPlaylist) return { url: 'https://audio.test/selected-song' };
    assert.equal(flags.playlistEnd, 500);
    // Model yt-dlp's documented extraction contract: without flat mode it
    // resolves every URL entry; flat mode preserves the listed metadata.
    if (!flags.flatPlaylist) hydratedEntries += entries.length;
    return { id: 'PLtest', title: 'Large list', extractor: 'youtube:tab', webpage_url: input, entries };
  };
  const metadata = { searchSource: 'youtube' };
  const playlist = await plugin.resolve('https://www.youtube.com/playlist?list=PLtest', { metadata });
  assert.ok(playlist instanceof Playlist);
  assert.equal(playlist.songs.length, 500);
  assert.equal(hydratedEntries, 0, 'Resolving a playlist must avoid 500 unnecessary per-video extractions');
  assert.equal(calls.length, 1);
  for (const [index, song] of playlist.songs.entries()) {
    assert.equal(song.name, `Song ${index}`);
    assert.equal(song.source, 'youtube');
    assert.equal(song.url, entries[index].url);
    assert.equal(song.thumbnail, entries[index].thumbnails[0].url);
    assert.equal(song.duration, index ? 200 : 0);
    assert.equal(Boolean(song.isLive), !index);
    assert.equal(song.uploader.name, 'Artist');
    assert.equal(song.metadata, metadata);
    assert.equal(song.stream.url, undefined);
  }
  assert.equal(await plugin.getStreamURL(playlist.songs[1]), 'https://audio.test/selected-song');
  assert.equal(calls.length, 2, 'Only the selected song needs a stream extraction');
});

test('an interactive search takes the next global slot ahead of queued playlist prewarming', async t => {
  const childProcess = require('node:child_process');
  const spawned = [], pending = new Set();
  t.mock.method(childProcess, 'spawn', (_path, args, options) => {
    const input = args[0], child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const finish = () => {
      if (!pending.delete(finish)) return;
      const title = input.replace(/^(ytsearch|scsearch)\d*:/, '');
      child.stdout.emit('data', JSON.stringify({ entries: [{ id: input, title, extractor: 'youtube',
        webpage_url: `https://www.youtube.com/watch?v=${encodeURIComponent(input)}` }] }));
      child.emit('close', 0);
    };
    options.signal.addEventListener('abort', () => {
      if (pending.delete(finish)) child.emit('error', options.signal.reason);
    }, { once: true });
    pending.add(finish); spawned.push({ input, finish });
    return child;
  });
  const blockers = Array.from({ length: 3 }, (_, index) => runYtDlp(`blocker-${index}`));
  const plugin = new YtDlpSearchPlugin();
  const batches = ['A', 'B', 'C'].map(name => plugin.warmSearchCache([`Warm ${name} 1`, `Warm ${name} 2`], {}));
  const interactive = plugin.searchSong('Interactive artist song', {});
  const all = Promise.all([...blockers, ...batches, interactive]);
  try {
    assert.equal(spawned.length, 3, 'The global pool must stay bounded while all servers warm caches');
    spawned[0].finish();
    await tick();
    assert.equal(spawned[3]?.input, 'ytsearch5:Interactive artist song', 'Background batches must yield the next slot to an interactive search');
  } finally {
    while (pending.size) {
      for (const finish of [...pending]) finish();
      await tick();
    }
    await all;
  }
});

test('prewarming in many guilds cannot consume every global waiting position', async t => {
  const childProcess = require('node:child_process'), spawned = [], pending = new Set();
  t.mock.method(console, 'warn', () => {});
  t.mock.method(childProcess, 'spawn', (_path, args, options) => {
    const input = args[0], child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const finish = () => {
      if (!pending.delete(finish)) return;
      child.stdout.emit('data', JSON.stringify({ entries: [{ id: input, title: input,
        extractor: 'youtube', webpage_url: `https://www.youtube.com/watch?v=${encodeURIComponent(input)}` }] }));
      child.emit('close', 0);
    };
    options.signal.addEventListener('abort', () => {
      if (pending.delete(finish)) child.emit('error', options.signal.reason);
    }, { once: true });
    pending.add(finish); spawned.push({ input, finish });
    return child;
  });
  const blockers = Array.from({ length: 3 }, (_, index) => runYtDlp(`blocker-${index}`));
  const plugin = new YtDlpSearchPlugin();
  const batches = Array.from({ length: 25 }, (_, guild) => plugin.warmSearchCache([`Guild ${guild} warm1`, `Guild ${guild} warm2`], {}));
  let foregroundError;
  const interactive = plugin.searchSong('Interactive saturated artist', {}).catch(error => { foregroundError = error; });
  const all = Promise.all([...blockers, ...batches, interactive]);
  try {
    await tick();
    assert.equal(foregroundError, undefined, 'Optional prewarming must leave waiting capacity for interactive extraction');
    assert.equal(spawned.length, 3, 'Many guilds must still share three process slots');
    spawned[0].finish();
    await tick();
    assert.equal(spawned[3]?.input, 'ytsearch5:Interactive saturated artist');
  } finally {
    while (pending.size) {
      for (const finish of [...pending]) finish();
      await tick();
    }
    await all;
  }
});
