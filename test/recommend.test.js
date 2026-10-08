const assert = require('node:assert/strict');
const test = require('node:test');
const { Song } = require('distube');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
const { selectRecommendations } = require('../dist/commands/recommend');

function makeSong(id, source = 'youtube', url = `https://www.youtube.com/watch?v=${id}`) {
  return new Song({ plugin: null, source, playFromSource: true, id, name: id, url });
}

test('a YouTube Mix omits its seed and caches the playlist result', async () => {
  const plugin = new YtDlpSearchPlugin();
  const seed = makeSong('AAAAAAAAAAA');
  let calls = 0;
  plugin.fetchInfo = async (input, flags) => {
    calls += 1;
    assert.match(input, /list=RDAAAAAAAAAAA/);
    assert.equal(flags.flatPlaylist, true);
    assert.equal(flags.playlistEnd, 60);
    return { entries: [
      { id: seed.id, title: 'Seed' },
      { id: 'BBBBBBBBBBB', title: 'Another song', url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB' },
      { id: 'BBBBBBBBBBB', title: 'Duplicate' },
    ] };
  };

  const [first, second] = await Promise.all([plugin.getRelatedSongs(seed), plugin.getRelatedSongs(seed)]);
  const third = await plugin.getRelatedSongs(seed);

  assert.equal(calls, 1);
  assert.deepEqual(first.map((song) => song.id), ['BBBBBBBBBBB']);
  assert.deepEqual(second.map((song) => song.id), ['BBBBBBBBBBB']);
  assert.deepEqual(third.map((song) => song.id), ['BBBBBBBBBBB']);
  assert.equal(first[0].url, 'https://www.youtube.com/watch?v=BBBBBBBBBBB');
  assert.equal(first[0].metadata.searchSource, 'youtube');
});

test('a non-YouTube seed is resolved before requesting a Mix', async () => {
  const plugin = new YtDlpSearchPlugin();
  const seed = makeSong('soundcloud-track', 'soundcloud', 'https://soundcloud.com/artist/track');
  seed.name = 'Artist Track';
  seed.uploader.name = 'Artist';
  const inputs = [];
  plugin.fetchInfo = async (input) => {
    inputs.push(input);
    if (input.startsWith('ytsearch5:')) {
      return { entries: [{ id: 'AAAAAAAAAAA', title: 'Artist Track', webpage_url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' }] };
    }
    return { entries: [{ id: 'BBBBBBBBBBB', title: 'Recommended' }] };
  };

  const related = await plugin.getRelatedSongs(seed);
  assert.deepEqual(inputs, [
    'ytsearch5:Artist Track Artist',
    'https://www.youtube.com/watch?v=AAAAAAAAAAA&list=RDAAAAAAAAAAA',
  ]);
  assert.deepEqual(related.map((song) => song.id), ['BBBBBBBBBBB']);
});

test('manual recommendations exclude queue and history and respect amount', () => {
  const existing = makeSong('AAAAAAAAAAA');
  const byUrl = makeSong('CCCCCCCCCCC', 'youtube', 'https://www.youtube.com/watch?v=DDDDDDDDDDD');
  const candidates = [
    makeSong('AAAAAAAAAAA'),
    makeSong('DDDDDDDDDDD', 'youtube', byUrl.url),
    makeSong('BBBBBBBBBBB'),
    makeSong('BBBBBBBBBBB'),
    makeSong('EEEEEEEEEEE'),
  ];

  assert.deepEqual(
    selectRecommendations(candidates, [existing, byUrl], 2).map((song) => song.id),
    ['BBBBBBBBBBB', 'EEEEEEEEEEE'],
  );
});
