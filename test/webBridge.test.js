const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { Client, GatewayIntentBits } = require('discord.js');
const { DisTube, Song } = require('distube');
const { createMusicBridge } = require('../dist/music/webBridge');
const { requestPlayback } = require('../dist/music/playbackRequest');
const { registerDisTubeEvents } = require('../dist/music/events');
const { getPlaybackState } = require('../dist/music/playbackState');
const { registerCheckpoint } = require('../dist/music/queueChanges');
const { handleInteraction } = require('../dist/events/interactionCreate');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');

const guildId = '1082065100111872170', userId = '1082065100111872171';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t) {
  for (const method of ['log', 'info', 'warn', 'error']) t.mock.method(console, method, () => {});
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  client.user = { id: '1082065100111872172' };
  t.after(() => client.destroy());
  const plugin = new YtDlpSearchPlugin();
  const distube = new DisTube(client, { plugins: [plugin], ffmpeg: { path: require('ffmpeg-static') } });
  client.distube = distube;
  let allowed = true, missingPermission, fetches = 0;
  const member = { id: userId, user: { bot: false }, voice: {} };
  const guild = { id: guildId, name: 'Servidor privado', iconURL: () => null,
    members: { me: null, cache: new Map([[userId, member]]), fetch: async options => {
      assert.deepEqual(options, { user: userId, force: true }); fetches++;
      if (!allowed) throw new Error('Unknown Member');
      return member;
    } } };
  client.guilds.cache.set(guildId, guild);
  const channel = { id: '1082065100111872173', guildId, guild, name: 'Música', members: new Map([[userId, member]]),
    permissionsFor: () => ({ has: flag => flag !== missingPermission }) };
  guild.members.me = { voice: { channel } };
  member.voice.channel = channel;
  const voice = new EventEmitter();
  Object.assign(voice, { id: guildId, channel, volume: 50, emittedError: false, playbackTime: 10000,
    join: async () => voice, pause() {}, unpause() {}, stop() {}, play: async stream => { voice.stream = stream; } });
  distube.voices.create = () => voice;
  t.after(registerDisTubeEvents(distube, undefined, { interval: 0 }));
  const queue = await distube.queues.create(channel);
  const song = id => new Song({ plugin, source: 'youtube', id, name: `Track ${id}`, uploader: { name: 'Artist' },
    duration: 200, playFromSource: true, url: `https://www.youtube.com/watch?v=${id}` });
  queue.songs = [song('AAAAAAAAAAA'), song('BBBBBBBBBBB'), song('CCCCCCCCCCC')];
  t.after(() => { for (const q of distube.queues.collection.values()) if (!q.stopped) q.remove(); });
  return { client, distube, plugin, guild, member, channel, queue, song, bridge: createMusicBridge(client),
    deny: () => { allowed = false; }, missing: flag => { missingPermission = flag; }, get fetches() { return fetches; } };
}

test('guild access uses live Discord membership, never a cached member or a caller role', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.bridge.listGuilds(userId), [{ id: guildId, name: 'Servidor privado', icon: null }]);
  f.deny();
  assert.deepEqual(await f.bridge.listGuilds(userId), []);
  await assert.rejects(f.bridge.getState(userId, guildId), { errorCode: 'GUILD_ACCESS_DENIED' });
  await assert.rejects(f.bridge.assertGuildAccess(userId, '1082065100111872199'), { errorCode: 'GUILD_ACCESS_DENIED' });
  assert.ok(f.fetches >= 3);
});

test('snapshot projects public fields, pending queue only, and removes tokens, stream URLs and signed artwork', async t => {
  const f = await fixture(t);
  f.queue.songs[0].stream.url = 'https://audio.example/secret?token=credential';
  f.queue.songs[0].thumbnail = 'https://i.ytimg.com/vi/AAAAAAAAAAA/default.jpg?token=credential';
  f.queue.songs[0].metadata = { token: 'credential', internal: f.client };
  f.queue.songs[1].url = 'https://audio.example/signed?token=credential';
  const state = getPlaybackState(f.queue);
  state.lastError = { code: 'NETWORK_ERROR', reference: 'credential', time: Date.now() };
  state.mode = 'recovering';
  const snapshot = await f.bridge.getState(userId, guildId), serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.status, 'recovering');
  assert.equal(snapshot.current.id, 'AAAAAAAAAAA');
  assert.deepEqual(snapshot.queue.map(s => s.id), ['BBBBBBBBBBB', 'CCCCCCCCCCC']);
  assert.equal(snapshot.current.thumbnail, null);
  assert.equal(snapshot.queue[0].url, '');
  assert.equal(snapshot.incidents[0].code, 'NETWORK_ERROR');
  assert.doesNotMatch(serialized, /credential|stream|internal|_taskQueue/);
});

for (const action of ['pause', 'resume', 'skip', 'stop', 'volume', 'repeat', 'shuffle', 'remove', 'move']) {
  test(`${action} rechecks the user's voice after acquiring the actual native queue lock`, async t => {
    const f = await fixture(t), original = f.queue.songs.map(s => s.id);
    if (action === 'resume') f.queue.paused = true;
    await f.queue._taskQueue.queuing();
    const pending = f.bridge.control(userId, guildId, { action, volume: 20, mode: 2, index: 1, from: 1, to: 2 });
    await tick();
    f.member.voice.channel = { ...f.channel, id: '1082065100111872199' };
    f.queue._taskQueue.resolve();
    await assert.rejects(pending, { errorCode: 'CONTROL_CHANNEL_REQUIRED' });
    assert.equal(f.queue.stopped, false);
    assert.deepEqual(f.queue.songs.map(s => s.id), original);
    assert.equal(f.queue.volume, 50);
    assert.equal(f.queue.repeatMode, 0);
    assert.equal(f.queue._taskQueue.remaining, 0);
    assert.equal(getPlaybackState(f.queue).closing, false);
  });
}

test('bot permission revocation while waiting is enforced after the lock and releases it', async t => {
  const f = await fixture(t);
  await f.queue._taskQueue.queuing();
  const pending = f.bridge.control(userId, guildId, { action: 'volume', volume: 10 });
  await tick(); f.missing('Speak'); f.queue._taskQueue.resolve();
  await assert.rejects(pending, { errorCode: 'VOICE_PERMISSIONS' });
  assert.equal(f.queue.volume, 50); assert.equal(f.queue._taskQueue.remaining, 0);
});

test('abort during live membership fetch after acquiring the native lock rejects before mutation', { timeout: 3000 }, async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(), controller = new AbortController();
  const fetchMember = f.guild.members.fetch;
  let fetches = 0;
  f.guild.members.fetch = async options => {
    if (++fetches === 3) { entered.resolve(); await release.promise; }
    return fetchMember(options);
  };
  await f.queue._taskQueue.queuing();
  const pending = f.bridge.control(userId, guildId, { action: 'volume', volume: 10 }, controller.signal);
  await tick(); f.queue._taskQueue.resolve();
  await entered.promise;
  controller.abort(); release.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.queue.volume, 50);
  assert.equal(f.queue._taskQueue.remaining, 0);
});

test('Discord and web operations serialize on the same queue and checkpoint the resulting settings', async t => {
  const f = await fixture(t), checkpoints = [];
  t.after(registerCheckpoint(f.distube, q => checkpoints.push({ volume: q.volume, repeat: q.repeatMode })));
  const replies = [];
  const interaction = { client: f.client, guild: f.guild, guildId, user: { id: userId }, commandName: 'volume',
    options: { getInteger: () => 25 }, deferred: false, replied: false,
    isButton: () => false, isAutocomplete: () => false, isChatInputCommand: () => true, isRepliable: () => true,
    deferReply: async () => { interaction.deferred = true; }, editReply: async payload => { replies.push(payload); },
    reply: async payload => { replies.push(payload); }, followUp: async payload => { replies.push(payload); } };
  await f.queue._taskQueue.queuing();
  const discord = handleInteraction(interaction), web = f.bridge.control(userId, guildId, { action: 'repeat', mode: 2 });
  await tick(); f.queue._taskQueue.resolve(); await Promise.all([discord, web]);
  assert.equal(f.queue.volume, 25); assert.equal(f.queue.repeatMode, 2);
  assert.ok(checkpoints.some(s => s.volume === 25 && s.repeat === 2));
  assert.equal(replies.length, 1); assert.equal(f.queue._taskQueue.remaining, 0);
});

test('repeat is an idempotent setting and repeated requests preserve the selected mode', async t => {
  const f = await fixture(t);
  await f.bridge.control(userId, guildId, { action: 'repeat', mode: 1 });
  await f.bridge.control(userId, guildId, { action: 'repeat', mode: 1 });
  assert.equal(f.queue.repeatMode, 1);
});

test('membership revocation after waiting denies mutation and queue shutdown cannot contaminate the next operation', async t => {
  const f = await fixture(t);
  await f.queue._taskQueue.queuing();
  const pending = f.bridge.control(userId, guildId, { action: 'pause' });
  await tick(); f.deny(); f.queue._taskQueue.resolve();
  await assert.rejects(pending, { errorCode: 'GUILD_ACCESS_DENIED' });
  assert.equal(f.queue.paused, false);
  // A background/native action after the user request must not retain its denied authorization scope.
  await f.queue.pause();
  assert.equal(f.queue.paused, true);
  assert.equal(f.queue._taskQueue.remaining, 0);
});

test('a newly blocked queue cannot be skipped by a request already waiting on its lock', async t => {
  const f = await fixture(t);
  await f.queue._taskQueue.queuing();
  const pending = f.bridge.control(userId, guildId, { action: 'skip' });
  await tick(); getPlaybackState(f.queue).blocked = true; f.queue._taskQueue.resolve();
  await assert.rejects(pending, { errorCode: 'QUEUE_BLOCKED' });
  assert.equal(f.queue.songs[0].id, 'AAAAAAAAAAA');
  assert.equal(f.queue._taskQueue.remaining, 0);
});

test('late web search cannot refill a queue changed by Discord', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); let plays = 0;
  f.plugin.searchSong = async () => { entered.resolve(); await release.promise; return f.song('DDDDDDDDDDD'); };
  f.distube.play = async () => { plays++; };
  const pending = f.bridge.control(userId, guildId, { action: 'play', query: 'artist title' });
  await entered.promise; await f.queue.skip(); release.resolve();
  await assert.rejects(pending, { errorCode: 'SESSION_CHANGED' });
  assert.equal(plays, 0); assert.equal(f.queue.songs[0].id, 'BBBBBBBBBBB');
});

test('a late search started without a queue never adopts a session created during authorization', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  await f.queue.stop();
  let authorizations = 0, plays = 0;
  f.plugin.searchSong = async () => f.song('DDDDDDDDDDD');
  f.distube.play = async () => { plays++; };
  const pending = requestPlayback(f.distube, { guildId, member: f.member, voiceChannel: f.channel,
    query: 'artist title', searchSource: 'youtube', authorize: async () => {
      if (++authorizations === 2) { entered.resolve(); await release.promise; }
    } });
  await entered.promise;
  const successor = await f.distube.queues.create(f.channel); successor.songs = [f.song('EEEEEEEEEEE')];
  release.resolve(); await assert.rejects(pending, { errorCode: 'SESSION_CHANGED' });
  assert.equal(plays, 0); assert.equal(successor.songs[0].id, 'EEEEEEEEEEE');
});

test('search started without a queue cannot revive a different session that already ended', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); let plays = 0;
  await f.queue.stop();
  f.plugin.searchSong = async () => { entered.resolve(); await release.promise; return f.song('DDDDDDDDDDD'); };
  f.distube.play = async () => { plays++; };
  const pending = f.bridge.control(userId, guildId, { action: 'play', query: 'artist title' });
  await entered.promise;
  const transient = await f.distube.queues.create(f.channel); transient.songs = [f.song('EEEEEEEEEEE')];
  await transient.stop(); release.resolve();
  await assert.rejects(pending, { errorCode: 'SESSION_CHANGED' });
  assert.equal(plays, 0); assert.equal(f.distube.getQueue(guildId), undefined);
});

test('play without a queue adopts only the queue created by its own native operation', async t => {
  const f = await fixture(t); await f.queue.stop();
  f.plugin.searchSong = async () => f.song('DDDDDDDDDDD');
  f.distube.play = async (_voice, input) => {
    const queue = await f.distube.queues.create(f.channel);
    await queue._taskQueue.queuing(true);
    try { queue.addToQueue(input); } finally { queue._taskQueue.resolve(); }
  };
  await f.bridge.control(userId, guildId, { action: 'play', query: 'artist title' });
  assert.equal(f.distube.getQueue(guildId).songs[0].id, 'DDDDDDDDDDD');
});

test('a multi-track load using one signal cannot restart music after Stop between tracks', async t => {
  const f = await fixture(t), controller = new AbortController(); let plays = 0;
  f.plugin.searchSong = async () => f.song('DDDDDDDDDDD');
  f.distube.play = async (_voice, song) => { plays++; f.distube.getQueue(guildId).addToQueue(song); };
  await f.bridge.control(userId, guildId, { action: 'play', query: 'first title' }, controller.signal);
  await f.queue.stop();
  await assert.rejects(f.bridge.control(userId, guildId, { action: 'play', query: 'second title' }, controller.signal), { errorCode: 'SESSION_CHANGED' });
  assert.equal(plays, 1); assert.equal(f.distube.getQueue(guildId), undefined);
});

for (const changed of ['abort', 'membership', 'voice']) {
  test(`autoplay skip revalidates ${changed} after related-song lookup before enqueue or advancing the head`, async t => {
    const f = await fixture(t), entered = deferred(), release = deferred(), controller = new AbortController();
    f.queue.songs.splice(1); f.queue.autoplay = true;
    f.plugin.getRelatedSongs = async () => { entered.resolve(); await release.promise; return [f.song('DDDDDDDDDDD')]; };
    const pending = f.bridge.control(userId, guildId, { action: 'skip' }, controller.signal);
    await entered.promise;
    if (changed === 'abort') controller.abort();
    else if (changed === 'membership') f.deny();
    else f.member.voice.channel = { ...f.channel, id: '1082065100111872199' };
    release.resolve();
    await assert.rejects(pending, changed === 'abort' ? { name: 'AbortError' } : { errorCode: changed === 'membership' ? 'GUILD_ACCESS_DENIED' : 'CONTROL_CHANNEL_REQUIRED' });
    assert.deepEqual(f.queue.songs.map(s => s.id), ['AAAAAAAAAAA']);
    assert.equal(f.queue._taskQueue.remaining, 0);
  });
}

test('cancellation during a new voice join removes only the owned empty queue and its connection', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(), controller = new AbortController();
  const voice = f.queue.voice; await f.queue.stop();
  let leaves = 0, created;
  voice.join = async () => { entered.resolve(); await release.promise; return voice; };
  voice.leave = () => { leaves++; };
  f.distube.voices.get = () => voice;
  f.plugin.searchSong = async () => f.song('DDDDDDDDDDD');
  f.distube.play = async (_voice, input) => {
    created = await f.distube.queues.create(f.channel);
    await created._taskQueue.queuing(true);
    try { created.addToQueue(input); } finally { created._taskQueue.resolve(); }
  };
  const pending = f.bridge.control(userId, guildId, { action: 'play', query: 'artist title' }, controller.signal);
  await entered.promise; controller.abort(); release.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.distube.getQueue(guildId), undefined);
  assert.equal(created.stopped, true); assert.equal(created._taskQueue.remaining, 0); assert.equal(leaves, 1);
});

test('native play-finally from a removed session cannot delete a successor after its URL resolves', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  f.distube.handler.resolve = async () => { entered.resolve(); await release.promise; return f.song('DDDDDDDDDDD'); };
  f.distube.play = async (_voice, input, options) => {
    const old = f.distube.getQueue(guildId);
    await old._taskQueue.queuing(true);
    try { old.addToQueue(await f.distube.handler.resolve(input, options)); }
    finally { if (!old.songs.length) old.remove(); old._taskQueue.resolve(); }
  };
  const pending = f.bridge.control(userId, guildId, { action: 'play', query: 'https://www.youtube.com/watch?v=DDDDDDDDDDD' });
  await entered.promise;
  f.queue.remove();
  const successor = await f.distube.queues.create(f.channel); successor.songs = [f.song('EEEEEEEEEEE')];
  release.resolve();
  await assert.rejects(pending, { errorCode: 'SESSION_CHANGED' });
  assert.equal(f.distube.getQueue(guildId), successor); assert.equal(successor.songs[0].id, 'EEEEEEEEEEE');
});

test('a cancelled initial URL resolve disconnects its owned voice even after native play-finally removed the empty queue', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(), controller = new AbortController();
  const voice = f.queue.voice; await f.queue.stop();
  let leaves = 0;
  voice.leave = () => { leaves++; };
  f.distube.voices.get = () => voice;
  f.distube.handler.resolve = async () => { entered.resolve(); await release.promise; return f.song('DDDDDDDDDDD'); };
  f.distube.play = async (_voice, input, options) => {
    const created = await f.distube.queues.create(f.channel);
    await created._taskQueue.queuing(true);
    try { created.addToQueue(await f.distube.handler.resolve(input, options)); }
    finally { if (!created.songs.length) created.remove(); created._taskQueue.resolve(); }
  };
  const pending = f.bridge.control(userId, guildId, { action: 'play', query: 'https://www.youtube.com/watch?v=DDDDDDDDDDD' }, controller.signal);
  await entered.promise; controller.abort(); release.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.distube.getQueue(guildId), undefined); assert.equal(leaves, 1);
});

test('URL extraction checks membership again before native enqueue, even when the lock is already held', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  f.distube.handler.resolve = async () => { entered.resolve(); await release.promise; return f.song('DDDDDDDDDDD'); };
  f.distube.play = async (_voice, input, options) => {
    await f.queue._taskQueue.queuing(true);
    try { f.queue.addToQueue(await f.distube.handler.resolve(input, options)); }
    finally { f.queue._taskQueue.resolve(); }
  };
  const pending = f.bridge.control(userId, guildId, { action: 'play', query: 'https://www.youtube.com/watch?v=DDDDDDDDDDD' });
  await entered.promise; f.deny(); release.resolve();
  await assert.rejects(pending, { errorCode: 'GUILD_ACCESS_DENIED' });
  assert.equal(f.queue.songs.length, 3); assert.equal(f.queue._taskQueue.remaining, 0);
});

test('an aborted web search does not enqueue its late result', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(), controller = new AbortController(); let plays = 0;
  f.plugin.searchSong = async (_query, _options, signal) => {
    assert.equal(signal, controller.signal); entered.resolve(); await release.promise; return f.song('DDDDDDDDDDD');
  };
  f.distube.play = async () => { plays++; };
  const pending = f.bridge.control(userId, guildId, { action: 'play', query: 'artist title' }, controller.signal);
  await entered.promise; controller.abort(); release.resolve();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(plays, 0);
});

test('web play rejects local, credentialed and arbitrary URL schemes before contacting extractors', async t => {
  const f = await fixture(t); let plays = 0;
  f.distube.play = async () => { plays++; };
  for (const query of ['http://127.0.0.1:8080/admin', 'https://internal.example/private', 'file:///etc/passwd', 'https://token@www.youtube.com/watch?v=AAAAAAAAAAA']) {
    await assert.rejects(f.bridge.control(userId, guildId, { action: 'play', query }), { errorCode: 'INVALID_ACTION' });
  }
  assert.equal(plays, 0);
});

test('allowedGuildIds restricts listGuilds and access, and two guilds enforce independent voice permissions', async t => {
  const f = await fixture(t);
  const secondGuildId = '1082065100111872180';
  const unauthorizedGuildId = '1082065100111872190';
  let secondFetches = 0, unauthorizedFetches = 0;
  // In secondGuild, user is a member but NOT in a voice channel
  const secondMember = { id: userId, user: { bot: false }, voice: { channel: null } };
  const secondGuild = {
    id: secondGuildId, name: 'Segundo servidor', iconURL: () => null,
    members: { me: { voice: { channel: null } }, cache: new Map([[userId, secondMember]]), fetch: async () => { secondFetches++; return secondMember; } },
  };
  const unauthorizedGuild = {
    id: unauthorizedGuildId, name: 'Servidor no autorizado', iconURL: () => null,
    members: { me: null, cache: new Map(), fetch: async () => { unauthorizedFetches++; return secondMember; } },
  };
  f.client.guilds.cache.set(secondGuildId, secondGuild);
  f.client.guilds.cache.set(unauthorizedGuildId, unauthorizedGuild);

  const bridge = createMusicBridge(f.client, undefined, {
    accessMode: 'guild_members',
    allowedGuildIds: [guildId, secondGuildId],
    adminUserIds: [],
    membershipCacheTtlMs: 0,
  });

  const guilds = await bridge.listGuilds(userId);
  assert.deepEqual(guilds, [
    { id: guildId, name: 'Servidor privado', icon: null },
    { id: secondGuildId, name: 'Segundo servidor', icon: null },
  ]);
  assert.equal(unauthorizedFetches, 0, 'unauthorized guilds are never queried');
  await assert.rejects(bridge.assertGuildAccess(userId, unauthorizedGuildId), { errorCode: 'GUILD_ACCESS_DENIED' });

  // Guild 1: user is in bot's voice channel -> canControl is true, role is 'voice'
  const state1 = await bridge.getState(userId, guildId);
  assert.equal(state1.permissions.role, 'voice');
  assert.equal(state1.permissions.canControl, true);
  assert.equal(state1.permissions.isAdmin, false);
  assert.deepEqual(state1.health, {});
  assert.deepEqual(state1.incidents, []);
  await bridge.control(userId, guildId, { action: 'pause' });
  assert.equal(f.queue.paused, true);

  // Guild 2: user is a member but outside voice channel -> canRead/canManageLibrary are true, canControl is false
  const state2 = await bridge.getState(userId, secondGuildId);
  assert.equal(state2.permissions.role, 'member');
  assert.equal(state2.permissions.canRead, true);
  assert.equal(state2.permissions.canManageLibrary, true);
  assert.equal(state2.permissions.canControl, false);
  await assert.rejects(bridge.control(userId, secondGuildId, { action: 'play', query: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' }), { errorCode: 'CONTROL_CHANNEL_REQUIRED' });
  assert.ok(secondFetches >= 2);
});

test('short membership cache coalesces reads, invalidates on guildMemberRemove or control revocation, and fails closed when Discord REST is unavailable', async t => {
  const f = await fixture(t);
  let now = 1_000_000;
  let restUnavailable = false;
  const originalFetch = f.guild.members.fetch;
  f.guild.members.fetch = async options => {
    if (restUnavailable) throw new Error('Discord REST 503 Service Unavailable');
    return originalFetch(options);
  };
  const bridge = createMusicBridge(f.client, undefined, {
    accessMode: 'guild_members',
    allowedGuildIds: [guildId],
    adminUserIds: [userId],
    membershipCacheTtlMs: 5_000,
    now: () => now,
  });

  // Concurrent and repeated reads within TTL only hit Discord REST once
  await Promise.all([
    bridge.assertGuildAccess(userId, guildId),
    bridge.getState(userId, guildId),
    bridge.listGuilds(userId),
  ]);
  assert.equal(f.fetches, 1);

  // Explicit admin receives diagnostics in getState
  const adminState = await bridge.getState(userId, guildId);
  assert.equal(adminState.permissions.role, 'admin');
  assert.equal(adminState.permissions.canViewDiagnostics, true);
  assert.equal(typeof adminState.health.ping, 'number');
  assert.equal(f.fetches, 1);

  // Advancing past TTL triggers a fresh Discord REST verification
  now += 5_001;
  await bridge.assertGuildAccess(userId, guildId);
  assert.equal(f.fetches, 2);

  // guildMemberRemove event immediately invalidates the cache before TTL expires
  f.client.emit('guildMemberRemove', { id: userId, guild: f.guild });
  await bridge.assertGuildAccess(userId, guildId);
  assert.equal(f.fetches, 3);

  // When Discord REST is temporarily unavailable and cache is expired, access fails closed despite guild.members.cache
  now += 5_001;
  restUnavailable = true;
  assert.equal(f.guild.members.cache.has(userId), true);
  await assert.rejects(bridge.assertGuildAccess(userId, guildId), { errorCode: 'GUILD_ACCESS_DENIED' });
  await assert.rejects(bridge.getState(userId, guildId), { errorCode: 'GUILD_ACCESS_DENIED' });
  assert.deepEqual(await bridge.listGuilds(userId), []);

  // Once Discord REST recovers, access works immediately (errors are never cached as positive or sticky)
  restUnavailable = false;
  await bridge.assertGuildAccess(userId, guildId);
});
