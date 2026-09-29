const assert = require('node:assert/strict');
const test = require('node:test');
const { MessageFlags } = require('discord.js');
const { autoplay } = require('../dist/commands/autoplay');

function makeInteraction(queue, userChannelId = 'voice-1') {
  const replies = [];
  const interaction = {
    guild: {
      id: 'guild-1',
      members: { cache: new Map([['user-1', { voice: { channel: userChannelId ? { id: userChannelId } : null } }]]) },
    },
    user: { id: 'user-1' },
    client: { distube: { getQueue: () => queue } },
    reply: async (payload) => { replies.push(payload); },
  };
  return { interaction, replies };
}

test('/autoplay rejects an empty queue', async () => {
  const { interaction, replies } = makeInteraction(null);

  await autoplay.execute(interaction);

  assert.equal(replies.length, 1);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  assert.match(replies[0].embeds[0].data.description, /No hay música/);
});

test('/autoplay only accepts someone in the bot voice channel', async () => {
  let toggles = 0;
  const queue = {
    songs: [{}],
    voiceChannel: { id: 'voice-1' },
    toggleAutoplay: () => { toggles += 1; return true; },
  };
  const { interaction, replies } = makeInteraction(queue, 'voice-2');

  await autoplay.execute(interaction);

  assert.equal(toggles, 0);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  assert.match(replies[0].embeds[0].data.description, /mismo canal/);
});

test('/autoplay toggles the queue on and off', async () => {
  const queue = {
    songs: [{}],
    voiceChannel: { id: 'voice-1' },
    autoplay: false,
    toggleAutoplay() { this.autoplay = !this.autoplay; return this.autoplay; },
  };
  const { interaction, replies } = makeInteraction(queue);

  await autoplay.execute(interaction);
  assert.equal(queue.autoplay, true);
  assert.match(replies[0].embeds[0].data.description, /activada/);

  await autoplay.execute(interaction);
  assert.equal(queue.autoplay, false);
  assert.match(replies[1].embeds[0].data.description, /desactivada/);
});
