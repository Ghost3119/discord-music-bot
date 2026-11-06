const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { updateYtDlp } = require('../scripts/update-ytdlp.cjs');
const { redact } = require('../scripts/logger.cjs');

test('yt-dlp maintenance requires pinned version/digest and preserves installed bytes on mismatch', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sonora-update-'));
  t.after(() => { assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(directory, { recursive: true, force: true }); });
  const filename = 'yt-dlp', target = path.join(directory, filename);
  fs.writeFileSync(target, 'original');
  const data = Buffer.from('test replacement; never executed');
  let downloads = 0;
  const fetchImpl = async url => { downloads++; assert.match(url, /^https:\/\/github\.com\/yt-dlp\/yt-dlp\/releases\/download\/2026\.01\.01\//); return new Response(data); };
  await assert.rejects(updateYtDlp({ directory, filename, fetchImpl }), /version/);
  assert.equal(downloads, 0);
  await assert.rejects(updateYtDlp({ directory, filename, version: '2026.01.01', sha256: '0'.repeat(64), fetchImpl }), /SHA-256/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'original');
  await updateYtDlp({ directory, filename, version: '2026.01.01', sha256: createHash('sha256').update(data).digest('hex'), fetchImpl });
  assert.deepEqual(fs.readFileSync(target), data);
  assert.deepEqual(fs.readdirSync(directory), [filename]);
  await updateYtDlp({ directory, filename: 'yt-dlp-custom.exe', version: '2026.01.01', sha256: createHash('sha256').update(data).digest('hex'), fetchImpl });
  assert.deepEqual(fs.readFileSync(path.join(directory, 'yt-dlp-custom.exe')), data);
});

test('supervisor rejects foreign and reused PIDs and stops after a bounded number of crashes', () => {
  let child, scheduled, currentIdentity = { parent: 4000, created: 'first' };
  const killed = [], exits = [], processMock = new EventEmitter(); processMock.pid = 3000;
  processMock.kill = pid => killed.push(pid);
  const context = {
    module: { exports: {} }, __dirname: path.dirname(require.resolve('../scripts/supervise.cjs')),
    process: processMock, console: { error() {} },
    require: name => name === 'node:path' ? path : name === './process-identity.cjs' ? { processIdentity: pid => pid === 9999 ? { parent: 1, created: 'foreign' } : currentIdentity } : { fork: () => {
      child = new EventEmitter(); child.pid = 4000; child.connected = true; child.send = () => {}; return child;
    } },
    setInterval: () => 1, clearInterval() {},
    setTimeout: callback => { scheduled = callback; return { unref() {} }; }, clearTimeout() {}, Date: { now: () => 1000 },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../scripts/supervise.cjs'), 'utf8'), context);
  context.module.exports.supervise({ restartLimit: 2, onExit: code => exits.push(code) });
  child.emit('message', { type: 'audioWorker', action: 'started', pid: 9999 });
  child.emit('message', { type: 'audioWorker', action: 'started', pid: 5000 });
  currentIdentity = { parent: 1, created: 'first' }; // Linux reparents workers after the bot exits.
  child.emit('close', 1); assert.deepEqual(killed, [5000]);
  scheduled();
  currentIdentity = { parent: 4000, created: 'second' };
  child.emit('message', { type: 'audioWorker', action: 'started', pid: 6000 });
  currentIdentity = { parent: 4000, created: 'reused' };
  child.emit('close', 1); assert.deepEqual(killed, [5000]);
  scheduled(); child.emit('close', 1);
  assert.deepEqual(exits, [1]);
});

test('logs redact credentials and absolute local paths', () => {
  const safe = redact('token=private C:\\Users\\someone\\project\\index.ts /home/someone/project/index.ts https://example.test/?secret=value');
  assert.doesNotMatch(safe, /private|someone|secret=value|index\.ts/);
});

test('yt-dlp CLI honors destination settings loaded from dotenv', async () => {
  const data = Buffer.from('verified fixture'), writes = [];
  const moduleMock = { exports: {} }, environment = {};
  const requireMock = name => name === 'node:path' ? path : name === 'node:crypto' ? require(name)
    : name === 'dotenv' ? { config: () => { environment.YTDLP_DIR = path.join(os.tmpdir(), 'custom-ytdlp-fixture'); environment.YTDLP_FILENAME = 'yt-dlp.exe'; } }
      : { writeFile: async target => writes.push(target), rename: async (_from, target) => writes.push(target), rm: async () => {} };
  requireMock.main = moduleMock;
  vm.runInNewContext(fs.readFileSync(require.resolve('../scripts/update-ytdlp.cjs'), 'utf8'), {
    module: moduleMock, require: requireMock, Buffer, AbortSignal,
    process: { env: environment, argv: ['node', 'update-ytdlp.cjs', '--version', '2026.01.01', '--sha256', createHash('sha256').update(data).digest('hex')], platform: 'win32' },
    fetch: async () => new Response(data), console: { log() {}, error(message) { assert.fail(message); } },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes[1], path.join(environment.YTDLP_DIR, 'yt-dlp.exe'));
});
