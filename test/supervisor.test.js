const assert = require('node:assert/strict');
const test = require('node:test');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function fixture(t, mode) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-supervisor-test-'));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const counter = path.join(directory, 'starts');
  const child = path.join(directory, 'child.cjs');
  const runner = path.join(directory, 'runner.cjs');
  const safety = require.resolve('../dist/runtime/safety');
  const supervisor = require.resolve('../scripts/supervise.cjs');
  fs.writeFileSync(child, `
    const fs = require('node:fs');
    const counter = ${JSON.stringify(counter)};
    const starts = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) + 1 : 1;
    fs.writeFileSync(counter, String(starts));
    require(${JSON.stringify(safety)}).installProcessHandlers(code => process.exit(code));
    process.on('message', message => { if (message.type === 'shutdown') process.exit(0); });
    if (${JSON.stringify(mode)} === 'config') process.exit(78);
    if (${JSON.stringify(mode)} === 'crash' && starts === 1) setImmediate(() => { throw new Error('supervisor-fatal-marker'); });
    if (${JSON.stringify(mode)} !== 'hang' || starts > 1) setInterval(() => process.send?.({type:'heartbeat'}, () => {}), 20);
    setInterval(() => {}, 1000);
  `);
  fs.writeFileSync(runner, `
    const fs = require('node:fs');
    const controller = require(${JSON.stringify(supervisor)}).supervise({entry:${JSON.stringify(child)}, minimumDelay:20, maximumDelay:50, heartbeatTimeout:500});
    if (${JSON.stringify(mode)} !== 'config') {
      const check = setInterval(() => {
        const starts = fs.existsSync(${JSON.stringify(counter)}) ? Number(fs.readFileSync(${JSON.stringify(counter)}, 'utf8')) : 0;
        if (starts >= ${mode === 'normal' ? 1 : 2}) { clearInterval(check); controller.stop(); }
      }, 25);
    }
  `);
  return { runner, counter };
}

test('the production supervisor restarts after a real fatal exception and stops cleanly', async (t) => {
  const { runner, counter } = fixture(t, 'crash');
  const result = await promisify(execFile)(process.execPath, [runner], { timeout: 10000, windowsHide: true });
  assert.match(result.stderr, /supervisor-fatal-marker/);
  assert.match(result.stderr, /reinicio en/);
  assert.equal(fs.readFileSync(counter, 'utf8'), '2');
});

test('the watchdog restarts a child that stops sending heartbeats', async (t) => {
  const { runner, counter } = fixture(t, 'hang');
  const result = await promisify(execFile)(process.execPath, [runner], { timeout: 10000, windowsHide: true });
  assert.match(result.stderr, /dejó de responder/);
  assert.equal(fs.readFileSync(counter, 'utf8'), '2');
});

test('an intentional supervisor shutdown never restarts the bot', async (t) => {
  const { runner, counter } = fixture(t, 'normal');
  const result = await promisify(execFile)(process.execPath, [runner], { timeout: 10000, windowsHide: true });
  assert.doesNotMatch(result.stderr, /reinicio en/);
  assert.equal(fs.readFileSync(counter, 'utf8'), '1');
});

test('invalid configuration exits with a diagnostic instead of a restart loop', async (t) => {
  const { runner, counter } = fixture(t, 'config');
  await assert.rejects(promisify(execFile)(process.execPath, [runner], { timeout: 10000, windowsHide: true }), (error) => {
    assert.equal(error.code, 78);
    assert.match(error.stderr, /Configuración inválida/);
    return true;
  });
  assert.equal(fs.readFileSync(counter, 'utf8'), '1');
});
