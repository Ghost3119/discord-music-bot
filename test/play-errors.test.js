const assert = require('node:assert/strict');
const test = require('node:test');
const { Song, DisTubeError } = require('distube');
const { play } = require('../dist/commands/play');
const { search } = require('../dist/commands/search');
const searchHelper = require('../dist/utils/searchHelper');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');

function makeInteraction(plugin, query = 'la mafia del amor multiorgasmica', missingPermission) {
  const edits = [];
  const replies = [];
  const played = [];
  const member = { voice: { channel: { permissionsFor: () => ({ has: (flag) => flag !== missingPermission }) } } };
  const interaction = {
    guild: { id: 'guild-1', members: { cache: new Map([['user-1', member]]) } },
    user: { id: 'user-1' },
    client: { user: { id: 'bot-1' }, distube: { plugins: [plugin], play: async (...args) => { played.push(args); } } },
    options: { getString: (key) => key === 'query' ? query : 'youtube' },
    deferred: false,
    deferReply: async () => { interaction.deferred = true; },
    editReply: async (message) => { edits.push(message); },
    reply: async (message) => { replies.push(message); },
  };
  return { interaction, edits, replies, played };
}

test('/play preserves the real platform error instead of reporting no results', async (t) => {
  t.mock.method(console, 'error', () => {});
  const plugin = new YtDlpSearchPlugin();
  plugin.searchSong = async () => { throw new Error("Sign in to confirm you're not a bot"); };
  const { interaction, edits, played } = makeInteraction(plugin);
  await play.execute(interaction);
  assert.match(edits.at(-1).embeds[0].data.description, /Código: `SOURCE_BLOCKED`/);
  assert.equal(played.length, 0);
});

test('/play reports genuinely empty results separately', async (t) => {
  t.mock.method(console, 'error', () => {});
  const plugin = new YtDlpSearchPlugin();
  plugin.searchSong = async () => null;
  const { interaction, edits, played } = makeInteraction(plugin);
  await play.execute(interaction);
  assert.match(edits.at(-1).embeds[0].data.description, /Código: `CANNOT_RESOLVE_SONG`/);
  assert.equal(played.length, 0);
});

test('/play passes a resolved song and its playback metadata to DisTube', async () => {
  const plugin = new YtDlpSearchPlugin();
  plugin.searchSong = async (query, options) => {
    assert.equal(query, 'la mafia del amor multiorgasmica');
    assert.equal(options.metadata.searchSource, 'youtube');
    return new Song({ plugin, source: 'youtube', playFromSource: true, id: 'wM6UVv8DB68', name: 'Multiorgásmica' }, options);
  };
  const { interaction, played } = makeInteraction(plugin);
  await play.execute(interaction);
  assert.ok(played[0][1] instanceof Song);
  assert.equal(played[0][2].metadata.searchSource, 'youtube');
});

test('/play keeps URL handling in DisTube and explains voice failures', async (t) => {
  t.mock.method(console, 'error', () => {});
  const plugin = new YtDlpSearchPlugin();
  plugin.searchSong = async () => assert.fail('URLs should not be searched');
  const url = 'https://open.spotify.com/track/test';
  const { interaction, edits } = makeInteraction(plugin, url);
  interaction.client.distube.play = async (_channel, input) => {
    assert.equal(input, url);
    throw new DisTubeError('VOICE_FULL');
  };
  await play.execute(interaction);
  assert.match(edits.at(-1).embeds[0].data.description, /Código: `VOICE_FULL`/);
});

test('/play and /search list only the missing voice permissions', async () => {
  for (const command of [play, search]) {
    const { interaction, replies } = makeInteraction(new YtDlpSearchPlugin(), 'query', 'Speak');
    await command.execute(interaction);
    assert.match(replies[0].embeds[0].data.description, /permisos en el canal de voz:\*\* Hablar/);
    assert.doesNotMatch(replies[0].embeds[0].data.description, /Conectar/);
    assert.equal(interaction.deferred, false);
  }
});

test('/search reports a failed lookup as a network error, not an empty result', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(searchHelper, 'searchSongs', async () => { throw Object.assign(new Error('network'), { code: 'ETIMEDOUT' }); });
  const { interaction, edits } = makeInteraction(new YtDlpSearchPlugin());
  await search.execute(interaction);
  assert.match(edits.at(-1).embeds[0].data.description, /Código: `NETWORK_TIMEOUT`/);
});
