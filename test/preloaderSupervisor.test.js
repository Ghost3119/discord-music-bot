const assert = require('node:assert/strict');
const test = require('node:test');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');

test('supervisor terminates only registered audio workers when a bot exits or watchdog kills it', () => {
  let watchdog, child;
  const killed = [], processMock = new EventEmitter(); processMock.kill = (pid, signal) => killed.push([pid, signal]);
  const context = {
    module: { exports: {} }, __dirname: path.dirname(require.resolve('../scripts/supervise.cjs')),
    process: processMock, console: { error() {} },
    require: name => name === 'node:path' ? path : { fork: () => {
      child = new EventEmitter(); child.connected = true; child.kill = signal => killed.push(['bot', signal]);
      child.send = () => {}; return child;
    } },
    setInterval: callback => { watchdog = callback; return 1; }, clearInterval() {},
    setTimeout: () => ({ unref() {} }), clearTimeout() {},
    Date: { now: () => 1000 },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../scripts/supervise.cjs'), 'utf8'), context);
  context.module.exports.supervise({ heartbeatTimeout: 100 });
  child.emit('message', { type: 'audioWorker', action: 'started', pid: 5001 });
  child.emit('message', { type: 'audioWorker', action: 'started', pid: 5002 });
  child.emit('message', { type: 'audioWorker', action: 'closed', pid: 5002 });
  child.emit('close', 1);
  assert.deepEqual(killed, [[5001, 'SIGKILL']], 'Reap tracked FFmpeg processes on unexpected bot exit');
  killed.length = 0;
  context.module.exports.supervise({ heartbeatTimeout: 100 });
  child.emit('message', { type: 'audioWorker', action: 'started', pid: 6001 });
  context.Date.now = () => 2000; watchdog();
  assert.deepEqual(killed, [[6001, 'SIGKILL'], ['bot', 'SIGKILL']], 'Reap speculative workers before a forced restart');
});

for (const mode of ['crash', 'hang']) {
  test(`supervisor removes registered preloader workers after a ${mode} before leaving a restarted bot`, { timeout: 15_000 }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-preload-supervisor-'));
    t.after(() => {
      assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const child = path.join(directory, 'bot.cjs'), driver = path.join(directory, 'driver.cjs');
    const starts = path.join(directory, 'starts'), worker = path.join(directory, 'worker');
    fs.writeFileSync(child, `
      const fs = require('node:fs');
      const file = ${JSON.stringify(starts)};
      const count = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) + 1 : 1;
      fs.writeFileSync(file, String(count));
      process.on('message', message => { if (message.type === 'shutdown') process.exit(0); });
      if (count === 1) {
        const worker = require('node:child_process').spawn(process.execPath, ['-e','setTimeout(() => {}, 5000)'], {stdio:'ignore',windowsHide:true});
        fs.writeFileSync(${JSON.stringify(worker)}, String(worker.pid));
        process.send({ type:'audioWorker', action:'started', pid:worker.pid }, () => { if (${JSON.stringify(mode)} === 'crash') process.exit(1); });
      } else setInterval(() => process.send({type:'heartbeat'}, () => {}), 20);
      setInterval(() => {}, 1000);
    `);
    fs.writeFileSync(driver, `
      const fs = require('node:fs');
      const supervisor = require(${JSON.stringify(require.resolve('../scripts/supervise.cjs'))}).supervise({entry:${JSON.stringify(child)},minimumDelay:20,maximumDelay:50,heartbeatTimeout:1000});
      const check = setInterval(() => {
        if (fs.existsSync(${JSON.stringify(starts)}) && Number(fs.readFileSync(${JSON.stringify(starts)},'utf8')) >= 2) { clearInterval(check); supervisor.stop(); }
      }, 25);
      process.once('beforeExit', () => {
        const pid = Number(fs.readFileSync(${JSON.stringify(worker)}, 'utf8'));
        const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
        (async () => {
          const deadline = Date.now() + 1000;
          while (alive() && Date.now() < deadline) await require('node:timers/promises').setTimeout(10);
          const orphaned = alive();
          if (orphaned) { try { process.kill(pid, 'SIGKILL'); } catch {} }
          process.stdout.write(JSON.stringify({orphaned}));
          if (orphaned) process.exitCode = 1;
        })();
      });
    `);
    const result = await promisify(execFile)(process.execPath, [driver], { windowsHide: true, timeout: 10_000 });
    assert.deepEqual(JSON.parse(result.stdout), { orphaned: false });
    assert.equal(fs.readFileSync(starts, 'utf8'), '2');
  });
}
