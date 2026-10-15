const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const disk = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Song } = require('distube');
const { HistoryStore } = require('../dist/music/history');

const guildId = '1082065100111872170';
function fixture(t, blocked = true) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const errors = []; t.mock.method(console, 'error', (...args) => errors.push(args));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-history-'));
  const parent = path.join(directory, 'data'), file = path.join(parent, 'history.json');
  if (blocked) fs.writeFileSync(parent, 'temporarily unavailable');
  const store = new HistoryStore(file), queue = { id: guildId };
  t.after(async () => {
    await store.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const add = id => store.finish(queue, new Song({ plugin: null, source: 'youtube', playFromSource: true,
    id, name: `Song ${id}`, duration: 200, url: `https://www.youtube.com/watch?v=${id}` }), 'completed');
  function repair() { fs.unlinkSync(parent); fs.mkdirSync(parent); }
  return { store, errors, file, add, repair, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

test('history retries after disk recovery without requiring another completed song', async t => {
  const f = fixture(t); f.add('AAAAAAAAAAA'); await f.store.flush();
  assert.equal(f.errors.length, 1); f.repair();
  t.mock.timers.tick(59_999); await f.store.flush(); assert.equal(fs.existsSync(f.file), false);
  t.mock.timers.tick(1); await f.store.flush();
  assert.equal(f.read()[0].title, 'Song AAAAAAAAAAA'); assert.equal(f.errors.length, 1);
});

test('persistent disk failure retries once per minute while retaining recent history', async t => {
  const f = fixture(t); f.add('AAAAAAAAAAA'); await f.store.flush();
  for (let i = 0; i < 20; i++) f.add(String(i).padStart(11, 'B'));
  await f.store.flush(); assert.equal(f.errors.length, 1);
  t.mock.timers.tick(60_000); await f.store.flush(); assert.equal(f.errors.length, 2);
  t.mock.timers.tick(59_999); await f.store.flush(); assert.equal(f.errors.length, 2);
  f.repair(); t.mock.timers.tick(1); await f.store.flush();
  assert.equal(f.read().length, 21); assert.equal(f.errors.length, 2);
});

test('closing attempts to save recovered disk immediately and does not restart retries', async t => {
  const f = fixture(t); f.add('AAAAAAAAAAA'); await f.store.flush();
  f.repair(); f.add('BBBBBBBBBBB');
  const rename = disk.rename; let writes = 0;
  t.mock.method(disk, 'rename', async (...args) => { writes++; return rename(...args); });
  await Promise.all([f.store.close(), f.store.close()]);
  assert.equal(f.read().length, 2); assert.equal(writes, 1);
  t.mock.timers.tick(10 * 60_000); await f.store.flush(); await f.store.close();
  assert.equal(writes, 1);
});

test('closing on a failed disk contains the last failure and cancels the retry timer', async t => {
  const f = fixture(t); f.add('AAAAAAAAAAA'); await f.store.flush();
  await assert.doesNotReject(() => f.store.close());
  assert.equal(f.errors.length, 2); assert.equal(f.store.list(guildId).length, 1);
  t.mock.timers.tick(10 * 60_000); await f.store.flush(); await f.store.close();
  assert.equal(f.errors.length, 2);
});

test('closing waits for in-flight atomic writes and includes changes received during the write', async t => {
  const f = fixture(t, false), rename = disk.rename;
  let entered, release;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  let active = 0, peak = 0;
  t.mock.method(disk, 'rename', async (...args) => {
    active++; peak = Math.max(peak, active); entered();
    try { await gate; return await rename(...args); } finally { active--; }
  });
  f.add('AAAAAAAAAAA'); await ready; f.add('BBBBBBBBBBB');
  let closing;
  try { closing = f.store.close(); } finally { release(); }
  await closing; await f.store.flush();
  assert.equal(peak, 1); assert.equal(f.read().length, 2);
  assert.deepEqual(f.read().map(entry => entry.title), ['Song BBBBBBBBBBB', 'Song AAAAAAAAAAA']);
});

test('a failed atomic replacement preserves the previous history and retries the latest entries', async t => {
  const f = fixture(t, false); f.add('AAAAAAAAAAA'); await f.store.flush();
  const original = fs.readFileSync(f.file, 'utf8'), rename = disk.rename; let failing = true;
  t.mock.method(disk, 'rename', async (...args) => {
    if (failing) throw Object.assign(new Error('simulated full disk'), { code: 'ENOSPC' });
    return rename(...args);
  });
  f.add('BBBBBBBBBBB'); await f.store.flush();
  assert.equal(fs.readFileSync(f.file, 'utf8'), original); assert.equal(f.errors.length, 1);
  failing = false; t.mock.timers.tick(60_000); await f.store.flush();
  assert.deepEqual(f.read().map(entry => entry.title), ['Song BBBBBBBBBBB', 'Song AAAAAAAAAAA']);
});

test('retries prune expired history before writing after a prolonged disk outage', async t => {
  const f = fixture(t); f.add('AAAAAAAAAAA'); await f.store.flush(); f.repair();
  t.mock.timers.tick(8 * 24 * 60 * 60_000); await f.store.flush();
  assert.deepEqual(f.read(), []);
});

test('closing still makes its final attempt when an in-flight replacement fails', async t => {
  const f = fixture(t, false), rename = disk.rename;
  let entered, release, writes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  t.mock.method(disk, 'rename', async (...args) => {
    writes++;
    if (writes === 1) {
      entered(); await gate;
      throw Object.assign(new Error('temporary replacement failure'), { code: 'EBUSY' });
    }
    return rename(...args);
  });
  f.add('AAAAAAAAAAA'); await ready;
  let closing;
  try { closing = f.store.close(); } finally { release(); }
  await closing;
  assert.equal(writes, 2); assert.equal(f.read().length, 1); assert.equal(f.errors.length, 1);
  t.mock.timers.tick(10 * 60_000); await f.store.flush(); assert.equal(writes, 2);
});

test('a scheduled history retry does not keep a finished process alive', t => {
  const f = fixture(t);
  const source = `
    const { HistoryStore } = require('./dist/music/history');
    console.error = () => {};
    const store = new HistoryStore(process.argv[1]);
    store.finish({ id: '${guildId}' }, {
      name: 'Song', source: 'youtube', stream: { playFromSource: true },
      url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA'
    }, 'completed');
    store.flush().then(() => process.stdout.write(String(store.list('${guildId}').length)));
  `;
  for (const forceColor of ['0', '1']) {
    const env = { ...process.env, FORCE_COLOR: forceColor };
    delete env.NO_COLOR;
    const result = spawnSync(process.execPath, ['-e', source, f.file], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 10_000, windowsHide: true, env,
    });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '1');
  }
});
