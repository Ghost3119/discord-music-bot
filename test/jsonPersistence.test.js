const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createJsonHistoryStorage } = require('../dist/infrastructure/json/history');
const { createJsonQueueCheckpointStore } = require('../dist/infrastructure/json/checkpoints');
const { HistoryStore } = require('../dist/music/history');
const { QueueRecovery } = require('../dist/music/queueRecovery');
function file(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonora-json-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'store.json');
}
test('JSON adapters preserve atomic writes, validated reads, size bounds and checkpoint deletion', async t => {
  const target = file(t), history = createJsonHistoryStorage(target);
  assert.deepEqual(history.read(), []);
  await history.write([]);
  assert.equal(fs.existsSync(`${target}.tmp`), false);
  assert.deepEqual(history.read(), []);
  fs.writeFileSync(target, ' '.repeat(3000001));
  assert.throws(() => history.read(), /Historial demasiado grande/);
  const queues = createJsonQueueCheckpointStore(target);
  const item = { guildId: '111111111111111111', voiceChannelId: '222222222222222222', position: 0, volume: 50, paused: false, autoplay: false, repeatMode: 0, updatedAt: Date.now(), songs: [{ id: 'dQw4w9WgXcQ', source: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', name: 'Song', uploader: '', duration: 100, ageRestricted: false, playFromSource: true, searchSource: 'youtube' }] };
  queues.write([item, { ...item, guildId: 'invalid' }]);
  assert.deepEqual(queues.read(), [item]);
  queues.delete(item.guildId);
  assert.deepEqual(queues.read(), []);
  assert.equal(fs.existsSync(`${target}.tmp`), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600);
});
test('HistoryStore reads and writes injected storage; I/O failures remain soft', async t => {
  const messages = [];
  t.mock.method(console, 'error', (...args) => messages.push(args[0]));
  const store = new HistoryStore(undefined, { read() { throw Error('read'); }, async write() { throw Error('write'); } });
  const song = { name: 'Song', source: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', stream: { playFromSource: true } };
  store.finish({ id: '111111111111111111' }, song, 'completed');
  await store.flush(); await store.close();
  assert.equal(store.list('111111111111111111').length, 1);
  assert.ok(messages.some(m => m.includes('No se pudo leer')));
  assert.ok(messages.some(m => m.includes('No se pudo guardar')));
});
test('QueueRecovery accepts an injected checkpoint port and tolerates failed reads and writes', async t => {
  t.mock.method(console, 'error', () => {});
  const distube = new EventEmitter();
  distube.queues = { collection: new Map() }; distube.getQueue = () => undefined;
  let reads = 0, writes = 0;
  const recovery = new QueueRecovery({}, distube, undefined, { read() { reads++; throw Error('read'); }, write() { writes++; throw Error('write'); }, delete() {} });
  await recovery.restore(); recovery.stop();
  assert.equal(reads, 1); assert.equal(writes, 1);
});
