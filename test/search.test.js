const assert = require('node:assert/strict');
const test = require('node:test');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');

const query = 'la mafia del amor multiorgasmica';
const track = {
  id: 'wM6UVv8DB68',
  title: 'Multiorgásmica',
  duration: 219,
  extractor: 'youtube',
  webpage_url: 'https://www.youtube.com/watch?v=wM6UVv8DB68',
};

test('a normal YouTube result does not need a music catalog search', async () => {
  const plugin = new YtDlpSearchPlugin();
  const inputs = [];
  plugin.fetchInfo = async (input) => {
    inputs.push(input);
    return { entries: [track] };
  };

  const song = await plugin.searchSong(query, {});
  assert.equal(song.id, track.id);
  assert.deepEqual(inputs, [`ytsearch1:${query}`]);
});

test('an empty YouTube search resolves through Music with metadata and shares its cache', async () => {
  const plugin = new YtDlpSearchPlugin();
  const inputs = [];
  const metadata = { searchSource: 'youtube' };
  plugin.fetchInfo = async (input, flags) => {
    inputs.push(input);
    if (input.startsWith('ytsearch')) return { entries: [] };
    const url = new URL(input);
    assert.equal(url.origin, 'https://music.youtube.com');
    assert.equal(url.searchParams.get('q'), query);
    assert.equal(url.hash, '#songs');
    assert.equal(flags.playlistEnd, 1);
    return { entries: [track] };
  };

  const songs = await Promise.all([
    plugin.searchSong(query, { metadata }),
    plugin.searchSong(query, { metadata }),
  ]);
  songs.push(await plugin.searchSong(query.toUpperCase(), { metadata }));

  assert.equal(inputs.length, 2);
  for (const song of songs) {
    assert.equal(song.id, track.id);
    assert.equal(song.name, track.title);
    assert.equal(song.duration, 219);
    assert.equal(song.url, track.webpage_url);
    assert.equal(song.source, 'youtube');
    assert.equal(song.metadata, metadata);
    assert.equal(song.stream.playFromSource, true);
  }
});

test('Music fallback preserves special characters and explicit YouTube search prefixes', async () => {
  const plugin = new YtDlpSearchPlugin();
  const text = 'artista & canción #1 + remix';
  plugin.fetchInfo = async (input) => {
    if (input.startsWith('ytsearch')) return { entries: [] };
    assert.equal(new URL(input).searchParams.get('q'), text);
    return { entries: [track] };
  };

  const song = await plugin.searchSong(`ytsearch1:${text}`, { metadata: { searchSource: 'soundcloud' } });
  assert.equal(song.id, track.id);
});

test('an empty SoundCloud search stays on the selected source', async () => {
  const plugin = new YtDlpSearchPlugin();
  const inputs = [];
  plugin.fetchInfo = async (input) => {
    inputs.push(input);
    return { entries: [] };
  };

  assert.equal(await plugin.searchSong(query, { metadata: { searchSource: 'soundcloud' } }), null);
  assert.deepEqual(inputs, [`scsearch1:${query}`]);
});

test('empty results are not cached and can be retried', async () => {
  const plugin = new YtDlpSearchPlugin();
  let calls = 0;
  plugin.fetchInfo = async () => {
    calls += 1;
    return { entries: [] };
  };

  assert.equal(await plugin.searchSong(query, {}), null);
  assert.equal(await plugin.searchSong(query, {}), null);
  assert.equal(calls, 4);
});

test('a failed Music lookup propagates the error and allows a later retry', async () => {
  const plugin = new YtDlpSearchPlugin();
  const failure = new Error('yt-dlp extraction failed');
  plugin.fetchInfo = async (input) => {
    if (input.startsWith('ytsearch')) return { entries: [] };
    throw failure;
  };
  await assert.rejects(plugin.searchSong(query, {}), (error) => error === failure);

  plugin.fetchInfo = async () => ({ entries: [track] });
  assert.equal((await plugin.searchSong(query, {})).id, track.id);
});
