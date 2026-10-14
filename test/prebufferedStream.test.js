const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { once } = require('node:events');
const ffmpeg = require('ffmpeg-static');
const { PrebufferedStream, PREBUFFER_MAX_BYTES } = require('../dist/music/prebufferedStream');

function wav(seconds = 30) {
  const pcm = Buffer.alloc(48_000 * 2 * 2 * seconds), header = Buffer.alloc(44);
  for (let offset = 0; offset < pcm.length; offset += 4) {
    const sample = Math.round(Math.sin(offset / 4 / 48_000 * 440 * 2 * Math.PI) * 6000);
    pcm.writeInt16LE(sample, offset); pcm.writeInt16LE(sample, offset + 2);
  }
  header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48_000, 24); header.writeUInt32LE(192_000, 28); header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
async function server(t, handler) {
  const srv = http.createServer(handler); srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  return `http://127.0.0.1:${srv.address().port}/audio?token=local-fixture-secret`;
}
const options = { ffmpeg: { path: ffmpeg, args: { global: {}, input: {}, output: {} } } };

test('real FFmpeg fills an unconsumed Opus resource, starts once, applies backpressure and exits on disposal', { timeout: 12_000 }, async t => {
  const audio = wav(), url = await server(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length }); res.end(audio);
  });
  const stream = new PrebufferedStream(url, options, 50); t.after(() => stream.dispose());
  await stream.prepare(new AbortController().signal);
  assert.equal(stream.audioResource.playbackDuration, 0, 'Preparing must not consume or dispatch audio');
  assert.equal(stream.usable, true); assert.ok(stream.audioResource.playStream.readableLength > 0);
  const child = stream.process, pid = child.pid;
  assert.ok(pid); stream.spawn(); stream.spawn(); assert.equal(stream.process.pid, pid, 'Voice handoff must not create a second FFmpeg');
  assert.ok(stream.bufferedBytes <= PREBUFFER_MAX_BYTES);
  const packet = stream.audioResource.read(); assert.ok(Buffer.isBuffer(packet));
  assert.equal(stream.audioResource.playbackDuration, 20, 'The ready resource delivers a native 20 ms Opus frame');
  const closed = once(child, 'close'); await stream.dispose(); await closed;
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.equal(stream.audioResource.playStream.destroyed, true); assert.equal(stream.stream.destroyed, true);
  assert.equal(stream.usable, false); assert.throws(() => stream.spawn(), /closed/);
});

test('real FFmpeg reports a speculative HTTP rejection without touching a voice connection', { timeout: 12_000 }, async t => {
  const url = await server(t, (_req, res) => { res.writeHead(403); res.end(); });
  const stream = new PrebufferedStream(url, options, 50); t.after(() => stream.dispose());
  await assert.rejects(stream.prepare(new AbortController().signal));
  assert.equal(stream.usable, false); assert.equal(stream.audioResource.playbackDuration, 0);
  await stream.dispose(); assert.equal(stream.stream.destroyed, true);
});

test('a short source may finish FFmpeg while its unconsumed prepared audio remains reusable', { timeout: 12_000 }, async t => {
  const audio = wav(0.04), url = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Length': audio.length }); res.end(audio); });
  const stream = new PrebufferedStream(url, options, 50); t.after(() => stream.dispose());
  const prepared = stream.prepare(new AbortController().signal), child = stream.process;
  const closed = once(child, 'close'); await prepared; await closed;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stream.usable, true, 'EOF of the source must not discard the buffered final frames');
  assert.ok(Buffer.isBuffer(stream.audioResource.read()));
  await stream.dispose(); assert.equal(stream.audioResource.playStream.destroyed, true);
});

test('aborting a real pending prebuffer closes FFmpeg and its pipelines', { timeout: 12_000 }, async t => {
  let requestArrived; const arrived = new Promise(resolve => { requestArrived = resolve; });
  const url = await server(t, (_req, _res) => { requestArrived(); });
  const stream = new PrebufferedStream(url, options, 50), controller = new AbortController(); t.after(() => stream.dispose());
  const rejected = assert.rejects(stream.prepare(controller.signal), { name: 'AbortError' });
  await arrived; controller.abort(); await rejected; await stream.dispose();
  assert.equal(stream.process.killed, true); assert.equal(stream.audioResource.playStream.destroyed, true);
});
