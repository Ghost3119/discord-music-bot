const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const timers = require('node:timers/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const tick = () => new Promise(resolve => setImmediate(resolve));

function runnerHarness(t) {
  let now = 0;
  const deadlines = [];
  const sleeps = [];
  const children = [];
  const operations = [];
  const controllers = [];
  t.mock.method(AbortSignal, 'timeout', ms => {
    const controller = new AbortController();
    deadlines.push({ at: now + ms, ms, controller, fired: false });
    return controller.signal;
  });
  t.mock.method(timers, 'setTimeout', (ms, _value, { signal }) => new Promise((resolve, reject) => {
    const sleep = { at: now + ms, ms, fired: false, resolve };
    sleeps.push(sleep);
    const abort = () => { sleep.fired = true; reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    sleep.resolve = () => { signal.removeEventListener('abort', abort); resolve(); };
  }));
  t.mock.method(childProcess, 'spawn', (_path, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.input = args[0];
    child.signal = options.signal;
    child.closed = false;
    child.abortCount = 0;
    child.finish = value => {
      if (child.closed) return;
      child.closed = true;
      options.signal.removeEventListener('abort', abort);
      child.stdout.emit('data', JSON.stringify(value));
      child.emit('close', 0);
    };
    const abort = () => {
      child.abortCount++;
      child.closed = true;
      child.emit('error', Object.assign(new Error('Extraction aborted'), { code: 'ABORT_ERR' }));
      child.emit('close', null);
    };
    options.signal.addEventListener('abort', abort, { once: true });
    children.push(child);
    return child;
  });
  const modulePath = require.resolve('../dist/music/ytDlpRunner');
  delete require.cache[modulePath];
  const { runYtDlp } = require(modulePath);
  t.after(async () => {
    for (const controller of controllers) controller.abort(new Error('Test cleanup'));
    await Promise.allSettled(operations);
    delete require.cache[modulePath];
  });
  return {
    children, deadlines, sleeps,
    run(input, controller = new AbortController()) {
      controllers.push(controller);
      const operation = runYtDlp(input, {}, controller.signal);
      // Cleanup can cancel any outstanding task even after a failed assertion.
      operation.catch(() => {});
      operations.push(operation);
      return operation;
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...deadlines, ...sleeps].filter(timer => !timer.fired && timer.at <= end)
          .sort((left, right) => left.at - right.at)[0];
        if (!due) break;
        now = due.at;
        due.fired = true;
        if (due.controller) due.controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        else due.resolve();
        await tick();
      }
      now = end;
      await tick();
    },
  };
}

test('queued yt-dlp requests retain FIFO position while extraction timeouts affect only occupied slots', async t => {
  const harness = runnerHarness(t);
  for (const input of ['held-1', 'held-2', 'held-3', 'older-1', 'older-2', 'older-3']) harness.run(input);
  const interactive = harness.run('interactive');
  assert.equal(harness.children.length, 3);

  // The first wave reaches its extraction deadline. The next three callers take
  // the slots; the interactive caller has waited 20 s without running yt-dlp.
  await harness.advance(20_000);
  const later = harness.run('later');
  assert.equal(harness.children.some(child => child.input === 'later'), false,
    'A later caller must not overtake an interactive caller whose extraction has not started');
  assert.equal(harness.sleeps.length, 3, 'Only the three real extractions should enter retry backoff');
  const older = harness.children.find(child => child.input === 'older-1');
  assert.equal(older.signal.aborted, false, 'A newly acquired slot must receive a fresh 20 s extraction deadline');
  older.finish({ id: 'older' });
  await tick();
  const started = harness.children.find(child => child.input === 'interactive');
  assert.ok(started, 'The original FIFO waiter must acquire the released slot');
  started.finish({ id: 'interactive' });
  assert.deepEqual(await interactive, { id: 'interactive' });
  await tick();
  harness.children.find(child => child.input === 'later').finish({ id: 'later' });
  assert.deepEqual(await later, { id: 'later' });
});

test('waiting for a yt-dlp slot does not allocate an extraction attempt timeout', async t => {
  const harness = runnerHarness(t);
  for (const input of ['held-1', 'held-2', 'held-3']) harness.run(input);
  const waiting = harness.run('waiting');
  assert.equal(harness.deadlines.filter(item => item.ms === 20_000).length, 3,
    'The 20 s clock starts after acquiring a slot, while waiting uses the total 60 s budget');
  harness.children[0].finish({ id: 'first' });
  await tick();
  assert.equal(harness.deadlines.filter(item => item.ms === 20_000).length, 4);
  harness.children.find(child => child.input === 'waiting').finish({ id: 'waiting' });
  assert.deepEqual(await waiting, { id: 'waiting' });
});

for (const queued of [false, true]) {
  test(`user cancellation preserves its reason for a ${queued ? 'queued' : 'running'} extraction without retrying`, async t => {
    const harness = runnerHarness(t);
    if (queued) for (const input of ['held-1', 'held-2', 'held-3']) harness.run(input);
    const controller = new AbortController();
    const operation = harness.run('cancelled', controller);
    const reason = Object.assign(new Error('User skipped this song'), { code: 'PLAYBACK_CANCELLED' });
    const rejection = assert.rejects(operation, error => error === reason,
      'A user cancellation must not be relabeled as a network timeout');
    controller.abort(reason);
    await rejection;
    assert.equal(harness.sleeps.length, 0);
    const child = harness.children.find(child => child.input === 'cancelled');
    if (queued) assert.equal(child, undefined);
    else assert.equal(child.abortCount, 1, 'The running child must receive the cancellation signal');
  });
}

test('the operation budget expires pending work without a spawn or a transient retry', async t => {
  const harness = runnerHarness(t);
  for (const input of ['held-1', 'held-2', 'held-3']) harness.run(input);
  const waiting = harness.run('waiting');
  const operationDeadline = harness.deadlines.filter(item => item.ms === 60_000)[3];
  const rejection = assert.rejects(waiting, { code: 'ETIMEDOUT' });
  operationDeadline.controller.abort(new DOMException('Operation budget expired', 'TimeoutError'));
  await rejection;
  assert.equal(harness.children.some(child => child.input === 'waiting'), false);
  assert.equal(harness.sleeps.length, 0);
  harness.children[0].finish({ id: 'first' });
  await tick();
  assert.equal(harness.children.length, 3, 'An expired waiter must be removed rather than run when a slot opens');
});

test('an extraction timeout cancels its child and retries with a fresh extraction deadline', async t => {
  const harness = runnerHarness(t);
  const operation = harness.run('retry');
  await harness.advance(20_000);
  assert.equal(harness.children[0].abortCount, 1);
  assert.equal(harness.children.length, 1);
  await harness.advance(500);
  assert.equal(harness.children.length, 2);
  assert.equal(harness.children[1].signal.aborted, false);
  harness.children[1].finish({ id: 'retried' });
  assert.deepEqual(await operation, { id: 'retried' });
});

test('three slow extractions and retry backoff cannot exceed the total operation budget', async t => {
  const harness = runnerHarness(t);
  const operation = harness.run('slow');
  const rejection = assert.rejects(operation, error => error.code === 'ETIMEDOUT' && /total/.test(error.message));
  await harness.advance(60_000);
  await rejection;
  assert.equal(harness.children.length, 3);
  assert.deepEqual(harness.sleeps.map(sleep => sleep.ms), [500, 1000]);
  assert.ok(harness.children.every(child => child.abortCount === 1), 'Each timed out process must receive cancellation');
  await harness.advance(60_000);
  assert.equal(harness.children.length, 3, 'The exhausted operation must not start another process');
});

test('user cancellation during retry backoff cannot spawn a later attempt or affect another caller', async t => {
  const harness = runnerHarness(t);
  const controller = new AbortController();
  const operation = harness.run('cancel-backoff', controller);
  await harness.advance(20_000);
  assert.equal(harness.sleeps.length, 1);
  const reason = new Error('User stopped the queue');
  const rejection = assert.rejects(operation, error => error === reason);
  controller.abort(reason);
  await rejection;
  const other = harness.run('other-guild');
  harness.children.find(child => child.input === 'other-guild').finish({ id: 'other-guild' });
  assert.deepEqual(await other, { id: 'other-guild' });
  await harness.advance(500);
  assert.equal(harness.children.filter(child => child.input === 'cancel-backoff').length, 1);
});

test('interactive extraction overtakes pending warmup work without canceling it', async () => {
  const { ExtractionPool } = require('../dist/music/ytDlpRunner');
  const pool = new ExtractionPool(1);
  const signal = new AbortController().signal;
  let release;
  const order = [];
  const held = pool.run(() => new Promise(resolve => { release = resolve; }), signal);
  const background = pool.run(async () => { order.push('background'); }, signal, 'background');
  const interactive = pool.run(async () => { order.push('interactive'); }, signal, 'interactive');
  release();
  await Promise.all([held, background, interactive]);
  assert.deepEqual(order, ['interactive', 'background']);
});

test('background extraction receives a slot within three interactive grants and both classes retain FIFO order', async () => {
  const { ExtractionPool } = require('../dist/music/ytDlpRunner');
  const pool = new ExtractionPool(1);
  const signal = new AbortController().signal;
  let release;
  const order = [];
  const pending = [pool.run(() => new Promise(resolve => { release = resolve; }), signal)];
  for (const id of ['background-1', 'background-2']) {
    pending.push(pool.run(async () => { order.push(id); }, signal, 'background'));
  }
  for (let id = 1; id <= 8; id++) {
    pending.push(pool.run(async () => { order.push(`interactive-${id}`); }, signal));
  }
  release();
  await Promise.all(pending);
  assert.deepEqual(order, [
    'interactive-1', 'interactive-2', 'interactive-3', 'background-1',
    'interactive-4', 'interactive-5', 'interactive-6', 'background-2',
    'interactive-7', 'interactive-8',
  ]);
});

test('the shared waiting limit and cancellation apply across both extraction priorities', async () => {
  const { ExtractionPool } = require('../dist/music/ytDlpRunner');
  const pool = new ExtractionPool(1, 2);
  const signal = new AbortController().signal;
  const controller = new AbortController();
  let release;
  const held = pool.run(() => new Promise(resolve => { release = resolve; }), signal);
  const warmup = pool.run(async () => assert.fail('Canceled warmup must not run'), controller.signal, 'background');
  const interactive = pool.run(async () => 'interactive', signal);
  await assert.rejects(pool.run(async () => {}, signal, 'background'), { code: 'MUSIC_BUSY' });
  const rejection = assert.rejects(warmup, error => error === controller.signal.reason);
  controller.abort();
  await rejection;
  const anotherWarmup = pool.run(async () => 'warmup', signal, 'background');
  release();
  assert.deepEqual(await Promise.all([held, interactive, anotherWarmup]), [undefined, 'interactive', 'warmup']);
  assert.equal(await pool.run(async () => 'next-session', signal), 'next-session');
});

test('background saturation reserves bounded waiting capacity for interactive extraction', async () => {
  const { ExtractionPool } = require('../dist/music/ytDlpRunner');
  const pool = new ExtractionPool(1, 3);
  const signal = new AbortController().signal;
  let release;
  const pending = [pool.run(() => new Promise(resolve => { release = resolve; }), signal)];
  for (let index = 0; index < 2; index++) pending.push(pool.run(async () => 'background', signal, 'background'));
  const overflow = pool.run(async () => 'excess-background', signal, 'background');
  const foreground = pool.run(async () => 'interactive', signal);
  foreground.catch(() => {});
  // Always release the fixture before assertions, including on original code.
  release();
  const result = await Promise.allSettled([overflow, foreground]);
  await Promise.all(pending);
  assert.equal(result[0].status, 'rejected', 'Excess warmup work must leave reserved admission capacity');
  assert.equal(result[0].reason.code, 'MUSIC_BUSY');
  assert.deepEqual(result[1], { status: 'fulfilled', value: 'interactive' });
});

test('user cancellation terminates a real local extraction child process', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-extraction-cancel-'));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const fixture = path.join(directory, 'extractor.cjs');
  // Also self-terminate if the driver fails, so a failing test cannot leave a child.
  fs.writeFileSync(fixture, 'setTimeout(() => process.exit(0), 4000);\n');
  const driver = `
    const assert = require('node:assert/strict');
    const childProcess = require('node:child_process');
    const spawn = childProcess.spawn;
    const controller = new AbortController();
    const reason = new Error('User cancelled the local fixture');
    let child, closed, starts = 0;
    process.on('exit', () => { if (child && child.exitCode === null && child.signalCode === null) child.kill(); });
    childProcess.spawn = (...args) => {
      starts++;
      child = spawn(...args);
      closed = new Promise(resolve => child.once('close', resolve));
      child.once('spawn', () => controller.abort(reason));
      return child;
    };
    (async () => {
      try {
        await assert.rejects(require(${JSON.stringify(require.resolve('../dist/music/ytDlpRunner'))}).runYtDlp(
          ${JSON.stringify(fixture)}, {}, controller.signal), error => error === reason);
        await closed;
        assert.equal(starts, 1);
        assert.ok(child.exitCode !== null || child.signalCode !== null);
        process.stdout.write(JSON.stringify({ starts, exited: true }));
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) child.kill();
      }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = await promisify(childProcess.execFile)(process.execPath, ['-e', driver], {
    windowsHide: true,
    timeout: 5000,
    env: { ...process.env, YTDLP_DIR: path.dirname(process.execPath), YTDLP_FILENAME: path.basename(process.execPath) },
  });
  assert.deepEqual(JSON.parse(result.stdout), { starts: 1, exited: true });
});
