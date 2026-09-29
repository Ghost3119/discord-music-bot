const assert = require('node:assert/strict');
const test = require('node:test');
const { MessageFlags } = require('discord.js');
const { Song } = require('distube');
const { recommend } = require('../dist/commands/recommend');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');

function makeSong(id) {
  return new Song({
    plugin: null,
    source: 'youtube',
    playFromSource: true,
    id,
    name: id,
    url: `https://www.youtube.com/watch?v=${id}`,
  });
}

function makeInteraction(queue, plugin, amount = 2, userChannelId = 'voice-1') {
  const replies = [];
  const edits = [];
  let deferred = false;
  const distube = {
    plugins: [plugin],
    getQueue: () => queue,
  };
  const interaction = {
    guild: {
      id: 'guild-1',
      members: { cache: new Map([['user-1', { voice: { channel: userChannelId ? { id: userChannelId } : null } }]]) },
    },
    user: { id: 'user-1' },
    client: { distube },
    options: { getInteger: () => amount },
    reply: async (payload) => { replies.push(payload); },
    deferReply: async () => { deferred = true; },
    editReply: async (payload) => { edits.push(payload); },
  };
  return { interaction, distube, replies, edits, wasDeferred: () => deferred };
}

test('/recommend requires a playing queue and the same voice channel', async () => {
  const plugin = new YtDlpSearchPlugin();
  const noQueue = makeInteraction(null, plugin);
  await recommend.execute(noQueue.interaction);
  assert.equal(noQueue.replies[0].flags, MessageFlags.Ephemeral);
  assert.equal(noQueue.wasDeferred(), false);

  const queue = { songs: [makeSong('AAAAAAAAAAA')], voiceChannel: { id: 'voice-1' } };
  const wrongChannel = makeInteraction(queue, plugin, 2, 'voice-2');
  await recommend.execute(wrongChannel.interaction);
  assert.equal(wrongChannel.replies[0].flags, MessageFlags.Ephemeral);
  assert.equal(wrongChannel.wasDeferred(), false);
});

test('/recommend uses another queue seed when needed and excludes already played songs', async () => {
  const current = makeSong('AAAAAAAAAAA');
  const last = makeSong('BBBBBBBBBBB');
  const queue = {
    songs: [current, last],
    previousSongs: [makeSong('CCCCCCCCCCC')],
    voiceChannel: { id: 'voice-1' },
    stopped: false,
    addToQueue(songs) { this.songs.push(...songs); },
  };
  const plugin = new YtDlpSearchPlugin();
  const seeds = [];
  plugin.getRecommendations = async (seed) => {
    seeds.push(seed.id);
    return seed === current
      ? [makeSong('CCCCCCCCCCC'), makeSong('DDDDDDDDDDD')]
      : [makeSong('DDDDDDDDDDD'), makeSong('EEEEEEEEEEE')];
  };
  const { interaction, edits, wasDeferred } = makeInteraction(queue, plugin);

  await recommend.execute(interaction);

  assert.equal(wasDeferred(), true);
  assert.deepEqual(seeds, ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
  assert.deepEqual(queue.songs.map((song) => song.id), [
    'AAAAAAAAAAA', 'BBBBBBBBBBB', 'DDDDDDDDDDD', 'EEEEEEEEEEE',
  ]);
  assert.match(edits[0].embeds[0].data.description, /Añadidas \*\*2\*\*/);
});

test('/recommend does not append songs if the queue ends during lookup', async () => {
  const queue = {
    songs: [makeSong('AAAAAAAAAAA')],
    previousSongs: [],
    voiceChannel: { id: 'voice-1' },
    stopped: false,
    addToQueue() { assert.fail('A stopped queue must not be modified'); },
  };
  const plugin = new YtDlpSearchPlugin();
  plugin.getRecommendations = async () => {
    queue.stopped = true;
    return [makeSong('BBBBBBBBBBB')];
  };
  const { interaction, edits } = makeInteraction(queue, plugin);

  await recommend.execute(interaction);

  assert.match(edits[0].embeds[0].data.description, /La cola terminó/);
});
