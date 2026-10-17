const test = require('node:test');
const assert = require('node:assert/strict');
const { Client, GatewayIntentBits } = require('discord.js');
const { SpotifyPlugin } = require('@distube/spotify');
const { createDisTube } = require('../dist/music/distube');

const id = '7N0ukeSc2gGCNLwhwSAvap';
const url = `https://open.spotify.com/track/${id}`;
const image = 'https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e020388063466b838bbed6c85f2';
const otherImage = 'https://i.scdn.co/image/ab67616d0000b2730388063466b838bbed6c85f2';
const track = extra => ({ type: 'track', id, name: 'Rafa Caro', artists: [{ name: 'T3R Elemento' }], duration: 248000, ...extra });

function fixture(t, data) {
  let calls = 0;
  const probe = new SpotifyPlugin();
  // Stub upstream metadata before factory construction; exercise the configured plugin.
  t.mock.method(Object.getPrototypeOf(probe.api), 'getData', async () => { calls++; return structuredClone(data); });
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  t.after(() => client.destroy());
  const distube = createDisTube(client);
  const plugin = distube.plugins.find(candidate => candidate instanceof SpotifyPlugin);
  assert.ok(plugin);
  return { plugin, get calls() { return calls; } };
}

for (const [field, metadata] of [
  ['visualIdentity.image', { visualIdentity: { image: [{ url: image, maxWidth: 300, maxHeight: 300 }] } }],
  ['coverArt.sources', { coverArt: { sources: [{ url: image }] } }],
  ['images', { images: [{ url: image }] }],
]) test(`Spotify preserves the track cover from ${field} without another lookup`, async t => {
  const f = fixture(t, track(metadata));
  const song = await f.plugin.resolve(url, { metadata: { caller: 'artwork-test' } });
  assert.equal(song.thumbnail, image);
  assert.equal(song.id, id);
  assert.equal(song.source, 'spotify');
  assert.equal(song.url, url);
  assert.equal(song.uploader.name, 'T3R Elemento');
  assert.equal(song.duration, 248);
  assert.equal(song.stream.playFromSource, false);
  assert.deepEqual(song.metadata, { caller: 'artwork-test' });
  assert.equal(f.calls, 1);
});

test('Spotify keeps the existing individual thumbnail ahead of alternate image fields', async t => {
  const f = fixture(t, track({ thumbnail: image, visualIdentity: { image: [{ url: otherImage }] } }));
  assert.equal((await f.plugin.resolve(url, {})).thumbnail, image);
});

test('resolved Spotify artwork survives library validation and SQLite persistence', async t => {
  const { openWebDatabase } = require('../dist/web/database');
  const { trackMetadata } = require('../dist/web/validation');
  const f = fixture(t, track({ visualIdentity: { image: [{ url: image }] } }));
  const song = await f.plugin.resolve(url, {});
  const metadata = trackMetadata({ url: song.url, title: song.name, artist: song.uploader.name, duration: song.duration, thumbnail: song.thumbnail });
  const db = openWebDatabase(':memory:');
  t.after(() => db.close());
  db.createSession({ id: 'u', username: 'QA', avatar: null }, Date.now(), 60000);
  const playlist = db.createPlaylist('u', 'g', 'Spotify', Date.now());
  db.addPlaylistTrack('u', 'g', playlist.id, metadata);
  assert.equal(db.getPlaylist('u', 'g', playlist.id).tracks[0].thumbnail, image);
});

for (const type of ['album', 'playlist']) test(`Spotify ${type} keeps each available track image instead of the collection cover`, async t => {
  const f = fixture(t, { type, name: 'Collection', url: `https://open.spotify.com/${type}/7N0ukeSc2gGCNLwhwSAvap`, thumbnail: 'https://mosaic.scdn.co/collection', tracks: [
    track({ visualIdentity: { image: [{ url: image }] } }),
    track({ id: '3HevcnYdnqtS0MvtyWkOg5', coverArt: { sources: [{ url: otherImage }] } }),
  ] });
  const list = await f.plugin.resolve(`https://open.spotify.com/${type}/${id}`, {});
  assert.deepEqual(list.songs.map(song => song.thumbnail), [image, otherImage]);
  assert.equal(f.calls, 1);
});

test('Spotify skips malformed and non-public image candidates without widening accepted hosts', async t => {
  const f = fixture(t, track({ visualIdentity: { image: [null, {},
    { url: 'http://i.scdn.co/cover' }, { url: 'https://untrusted.example/cover' },
    { url: 'https://i.scdn.co/cover?token=secret' }, { url: 'https://secret@i.scdn.co/cover' },
    { url: 'https://i.scdn.co:8443/cover' }, { url: 'https://i.scdn.co/cover#secret' },
    { url: image },
  ] } }));
  const song = await f.plugin.resolve(url, {});
  assert.equal(song.thumbnail, image);
  assert.doesNotMatch(song.thumbnail, /secret/);
});

for (const metadata of [{}, { visualIdentity: { image: {} }, coverArt: { sources: null } }, { visualIdentity: { image: [{ url: 'https://untrusted.example/cover' }] } }]) {
  test('Spotify with no reliable image keeps optional artwork empty', async t => {
    const f = fixture(t, track(metadata));
    const song = await f.plugin.resolve(url, {});
    assert.equal(song.thumbnail, undefined);
    assert.equal(song.stream.playFromSource, false);
    assert.equal(f.calls, 1);
  });
}
