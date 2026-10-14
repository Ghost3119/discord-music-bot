const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { Client, GatewayIntentBits } = require('discord.js');
const { DisTube, Song } = require('distube');
const { handleInteraction } = require('../dist/events/interactionCreate');
const { registerDisTubeEvents } = require('../dist/music/events');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
const controls = Object.fromEntries(['skip', 'seek', 'pause', 'resume', 'stop'].map(name => [name, require(`../dist/commands/${name}`)[name]]));

const guildId = '1082065100111872170';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function interactionFixture(name) {
  const events = [], payloads = [];
  const queue = { id: guildId, paused: name === 'resume', voiceChannel: { id: 'voice' }, songs: [{ name: 'Current song' }] };
  const member = { voice: { channel: { id: 'voice' } } };
  const distube = { getQueue: () => queue };
  const interaction = {
    commandName: name, guildId, guild: { id: guildId, members: { cache: new Map([['user', member]]) } }, user: { id: 'user' },
    client: { distube }, options: { getInteger: () => 30 }, deferred: false, replied: false,
    isButton: () => false, isAutocomplete: () => false, isChatInputCommand: () => true, isRepliable: () => true,
    deferReply: async payload => { events.push('defer'); interaction.deferred = true; },
    reply: async payload => { events.push('reply'); payloads.push(payload); interaction.replied = true; },
    editReply: async payload => { events.push('edit'); payloads.push(payload); interaction.replied = true; },
    followUp: async payload => { events.push('followUp'); payloads.push(payload); },
  };
  return { queue, interaction, events, payloads, member, distube };
}

for (const name of Object.keys(controls)) {
  test(`/${name} acknowledges before entering a potentially blocked queue operation`, async () => {
    const f = interactionFixture(name), entered = deferred(), release = deferred();
    f.queue[name] = async () => { f.events.push(name); entered.resolve(); await release.promise; return { name: 'Next song' }; };
    const pending = controls[name].execute(f.interaction);
    await entered.promise;
    const eventsBeforeRelease = [...f.events];
    release.resolve(); await pending;
    assert.deepEqual(eventsBeforeRelease, ['defer', name], 'Discord must receive an acknowledgement while the queue lock/extraction is still pending');
    assert.deepEqual(f.events, ['defer', name, 'edit']);
    assert.equal(f.payloads.length, 1);
  });

  test(`/${name} rejects a replaced session while Discord acknowledges the command`, async () => {
    const f = interactionFixture(name), replacement = { ...f.queue }; let operations = 0;
    f.queue[name] = async () => { operations++; };
    f.interaction.deferReply = async () => { f.interaction.deferred = true; f.distube.getQueue = () => replacement; };
    await assert.rejects(controls[name].execute(f.interaction), { errorCode: 'SESSION_CHANGED' });
    assert.equal(operations, 0);
  });

  test(`/${name} rechecks the user's voice channel after acknowledgement`, async () => {
    const f = interactionFixture(name); let operations = 0;
    f.queue[name] = async () => { operations++; };
    f.interaction.deferReply = async () => { f.interaction.deferred = true; f.member.voice.channel.id = 'other'; };
    await controls[name].execute(f.interaction);
    assert.equal(operations, 0);
    assert.match(JSON.stringify(f.payloads), /mismo canal/);
  });
}

test('/seek does not target a successor song while Discord acknowledges the command', async () => {
  const f = interactionFixture('seek'); let operations = 0;
  f.queue.seek = async () => { operations++; };
  f.interaction.deferReply = async () => { f.interaction.deferred = true; f.queue.songs[0] = { name: 'Successor' }; };
  await assert.rejects(controls.seek.execute(f.interaction), { errorCode: 'SESSION_CHANGED' });
  assert.equal(operations, 0);
});

test('/skip reports the actual network failure instead of claiming the queue is empty', async t => {
  t.mock.method(console, 'error', () => {});
  const f = interactionFixture('skip');
  f.queue.skip = async () => { throw Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' }); };
  await handleInteraction(f.interaction);
  assert.equal(f.payloads.length, 1);
  assert.match(JSON.stringify(f.payloads[0]), /NETWORK_ERROR/);
  assert.doesNotMatch(JSON.stringify(f.payloads[0]), /No hay más canciones/);
});

test('/skip preserves the blocked-queue diagnostic and its retry instructions', async t => {
  t.mock.method(console, 'error', () => {});
  const f = interactionFixture('skip');
  f.queue.skip = async () => { throw Object.assign(new Error('Blocked'), { errorCode: 'QUEUE_BLOCKED' }); };
  await handleInteraction(f.interaction);
  assert.equal(f.payloads.length, 1);
  assert.match(JSON.stringify(f.payloads[0]), /QUEUE_BLOCKED/);
  assert.match(JSON.stringify(f.payloads[0]), /resume/);
});

test('/skip leaves expired Discord responses at the existing boundary without retrying as an empty queue', async t => {
  t.mock.method(console, 'warn', () => {});
  const f = interactionFixture('skip'); let sends = 0;
  f.queue.skip = async () => ({ name: 'Next song' });
  const send = async payload => { f.payloads.push(payload); if (++sends === 1) throw Object.assign(new Error('Unknown interaction'), { code: 10062 }); };
  f.interaction.reply = send; f.interaction.editReply = send;
  await handleInteraction(f.interaction);
  assert.equal(sends, 1, 'A failed Discord response must not be interpreted as a failed skip and retried');
  assert.doesNotMatch(JSON.stringify(f.payloads), /No hay más canciones/);
});

test('/skip keeps an accurate diagnostic when there is no next song', async t => {
  t.mock.method(console, 'error', () => {});
  const f = interactionFixture('skip');
  f.queue.skip = async () => { throw Object.assign(new Error('No next song'), { errorCode: 'NO_UP_NEXT' }); };
  await handleInteraction(f.interaction);
  assert.equal(f.payloads.length, 1);
  assert.match(JSON.stringify(f.payloads[0]), /siguiente canción|más canciones/);
});

async function nativeFixture(t) {
  for (const method of ['log', 'info', 'warn', 'error']) t.mock.method(console, method, () => {});
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] }); t.after(() => client.destroy());
  const plugin = new YtDlpSearchPlugin(), distube = new DisTube(client, { plugins: [plugin], ffmpeg: { path: require('ffmpeg-static') } }); distube.setMaxListeners(10);
  const voice = new EventEmitter(); Object.assign(voice, { id: guildId, emittedError: false, playbackTime: 0, volume: 50,
    channel: { id: '1082065100569059471', guildId, guild: { members: { me: null } } },
    join: async () => voice, pause() {}, unpause() {}, stop() {}, play: async stream => { voice.stream = stream; },
  });
  distube.voices.create = () => voice;
  t.after(registerDisTubeEvents(distube, undefined, { interval: 0 }));
  const queue = await distube.queues.create(voice.channel);
  const song = id => new Song({ plugin, source: 'youtube', id, name: id, duration: 200, playFromSource: true, url: `https://www.youtube.com/watch?v=${id}` });
  queue.songs = [song('AAAAAAAAAAA'), song('BBBBBBBBBBB')];
  t.after(() => { if (!queue.stopped) queue.remove(); });
  return { queue, distube, plugin };
}

test('a seek queued behind skip does not apply the old song position to the next song', async t => {
  const f = await nativeFixture(t), positions = [];
  f.queue.play = async () => { positions.push([f.queue.songs[0].id, f.queue._beginTime]); };
  await f.queue._taskQueue.queuing();
  const skipping = f.queue.skip(), seeking = f.queue.seek(30).catch(error => error);
  await tick(); f.queue._taskQueue.resolve();
  await skipping; const seekResult = await seeking;
  assert.equal(f.queue.songs[0].id, 'BBBBBBBBBBB');
  assert.deepEqual(positions, [], 'The seek belonged to the original head and must never seek the successor');
  assert.equal(seekResult?.errorCode, 'SESSION_CHANGED');
  assert.equal(f.queue._taskQueue.remaining, 0);
});

test('seek rechecks the breaker after waiting and releases the native task lock', async t => {
  const f = await nativeFixture(t), { getPlaybackState } = require('../dist/music/playbackState');
  f.queue.play = async () => assert.fail('A newly blocked queue must not seek');
  await f.queue._taskQueue.queuing();
  const seeking = f.queue.seek(30).catch(error => error);
  getPlaybackState(f.queue).blocked = true;
  f.queue._taskQueue.resolve();
  assert.equal((await seeking).errorCode, 'QUEUE_BLOCKED');
  assert.equal(f.queue._taskQueue.remaining, 0);
});

test('seek waiting behind stop cannot seek a terminated native session', async t => {
  const f = await nativeFixture(t);
  f.queue.play = async () => assert.fail('A stopped queue must not seek');
  await f.queue._taskQueue.queuing();
  const stopping = f.queue.stop(), seeking = f.queue.seek(30).catch(error => error);
  f.queue._taskQueue.resolve(); await stopping;
  assert.equal((await seeking).errorCode, 'SESSION_CHANGED');
  assert.equal(f.queue._taskQueue.remaining, 0);
});

test('a rejected sole-song skip retires an aborted renewal instead of leaving silent music at the head', async t => {
  const f = await nativeFixture(t), entered = deferred();
  f.queue.songs.splice(1);
  const failed = f.queue.songs.shift();
  f.distube.emit('error', Object.assign(new Error('HTTP 403 Forbidden'), { errorCode: 'SOURCE_BLOCKED' }), f.queue, failed);
  f.plugin.getStreamURL = async (_song, signal) => {
    entered.resolve();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })), { once: true }));
  };
  await f.queue._taskQueue.queuing();
  const renewal = f.queue.play();
  await entered.promise;
  const skipping = f.queue.skip().catch(error => error);
  await renewal;
  f.queue._taskQueue.resolve();
  assert.equal((await skipping).errorCode, 'NO_UP_NEXT');
  assert.equal(f.queue.stopped, true, 'Cancelled audio cannot be left at the head when skip rejects');
  assert.equal(f.distube.getQueue(guildId), undefined);
  assert.equal(f.queue._taskQueue.remaining, 0);
});
