const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { fork, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireInstanceLock } = require('../dist/runtime/instanceLock');

function runner(t, failLogin = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-instance-test-'));
  const file = path.join(directory, 'boot.cjs');
  const bootstrap = require.resolve('../dist/bootstrap'), index = require.resolve('../dist/index');
  const logger = require.resolve('../dist/runtime/logger');
  fs.writeFileSync(file, `
    require.cache[${JSON.stringify(logger)}] = { id:${JSON.stringify(logger)}, filename:${JSON.stringify(logger)}, loaded:true,
      exports:{ installLogs:()=>({close:async()=>{}}) } };
    require.cache[${JSON.stringify(index)}] = { id:${JSON.stringify(index)}, filename:${JSON.stringify(index)}, loaded:true,
      exports: {
        get client() { console.log('INDEX_IMPORTED'); return {destroy:async()=>{}}; },
        queueRecovery:{stop(){}}, stopEmptyVoice(){}, stopPlayerPanels(){}, history:{close:async()=>{}},
        startBot:async()=>{
          if (${JSON.stringify(failLogin)}) throw new Error('invalid token fixture');
          console.log('STARTED'); process.send?.({type:'ready'});
        }
      }
    };
    require(${JSON.stringify(bootstrap)});
  `);
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { file, options: { cwd: directory, windowsHide: true, timeout: 10000 } };
}
const environment = id => ({ ...process.env, CLIENT_ID: id, GUILD_ID: '1082065100111872170', DISCORD_TOKEN: 'fixture-not-real-token' });
async function startFixture(t, f, id) {
  const child = fork(f.file, [], { ...f.options, timeout: undefined, env: environment(id), stdio: ['ignore','pipe','pipe','ipc'] });
  const closed = new Promise(resolve => child.once('close', code => resolve(code)));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture startup timeout')), 10000);
    child.once('message', message => { clearTimeout(timeout); message.type === 'ready' ? resolve() : reject(new Error('Unexpected fixture message')); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Fixture exited before ready: ${code}`)); });
  });
  return { child, closed };
}

test('concurrent startup reservations allow exactly one owner for the same application', async t => {
  const id = randomUUID(), attempts = await Promise.allSettled(Array.from({length:12}, () => acquireInstanceLock(id)));
  const owners = attempts.filter(result => result.status === 'fulfilled');
  t.after(async () => { for (const owner of owners) await owner.value(); });
  assert.equal(owners.length, 1);
  for (const blocked of attempts.filter(result => result.status === 'rejected')) assert.equal(blocked.reason.code, 'INSTANCE_ALREADY_RUNNING');
});

test('different Discord applications can reserve independent instances', async t => {
  const releases = await Promise.all([acquireInstanceLock(randomUUID()), acquireInstanceLock(randomUUID())]);
  t.after(async () => { await Promise.all(releases.map(release => release())); });
  assert.equal(releases.length, 2);
});

test('releasing an instance is idempotent and cannot unlock its successor', async t => {
  const id = randomUUID(), release = await acquireInstanceLock(id);
  await Promise.all([release(), release()]);
  const next = await acquireInstanceLock(id); t.after(next);
  await release(); await assert.rejects(acquireInstanceLock(id), { code:'INSTANCE_ALREADY_RUNNING' });
});

test('the OS releases a reservation after a process is forcibly terminated', async t => {
  const f = runner(t), id = randomUUID(), owner = await startFixture(t, f, id);
  await assert.rejects(acquireInstanceLock(id), {code:'INSTANCE_ALREADY_RUNNING'});
  owner.child.kill('SIGKILL'); await owner.closed;
  const release = await acquireInstanceLock(id); await release();
});

test('bootstrap refuses a duplicate before importing the bot or attempting login', async t => {
  const f = runner(t), id = randomUUID(), release = await acquireInstanceLock(id); t.after(release);
  await assert.rejects(promisify(execFile)(process.execPath, [f.file], { ...f.options, env:environment(id) }), error => {
    assert.equal(error.code, 79); assert.match(error.stderr, /Ya hay una instancia/);
    assert.doesNotMatch(error.stdout, /INDEX_IMPORTED|STARTED/); return true;
  });
});

test('bootstrap releases the reservation after a normal IPC shutdown', async t => {
  const f = runner(t), id = randomUUID(), owner = await startFixture(t, f, id);
  owner.child.send({type:'shutdown'}); assert.equal(await owner.closed, 0);
  const release = await acquireInstanceLock(id); await release();
});

test('a failed bot startup exits with configuration status and releases its reservation', async t => {
  const f = runner(t, true), id = randomUUID();
  await assert.rejects(promisify(execFile)(process.execPath, [f.file], { ...f.options, env:environment(id) }), error => {
    assert.equal(error.code, 78); assert.match(error.stderr, /invalid token fixture/); return true;
  });
  const release = await acquireInstanceLock(id); await release();
});
