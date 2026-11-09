const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { observeStreamErrors, getStreamDiagnostics } = require('../dist/music/streamErrors');

test('a closed stream keeps an error listener after DisTube removes its own', () => {
  const stream = new EventEmitter();
  const distubeListener = () => {};
  stream.on('error', distubeListener);

  observeStreamErrors(stream);
  observeStreamErrors(stream);
  assert.equal(stream.listenerCount('error'), 2);

  stream.off('error', distubeListener);
  const error = new Error('Premature close');
  error.code = 'ERR_STREAM_PREMATURE_CLOSE';
  assert.doesNotThrow(() => stream.emit('error', error));
  assert.equal(stream.listenerCount('error'), 1);
});

test('an active stream error is handled once by DisTube and is not logged as late', t => {
  const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
  const stream=new EventEmitter();observeStreamErrors(stream);
  let handled=0;stream.on('error',()=>{handled++;});
  stream.emit('debug','[ffmpeg] log: HTTP error 403 Forbidden');
  const error=new Error('ffmpeg exited with code 3436169992');
  stream.emit('error',error);
  assert.equal(handled,1);assert.equal(logs.length,0);
  assert.deepEqual(getStreamDiagnostics(error),['HTTP error 403 Forbidden']);
});

test('late errors keep bounded diagnostics without signed URLs, cookies or authorization', t => {
  const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
  const stream=new EventEmitter();observeStreamErrors(stream);observeStreamErrors(stream);
  assert.equal(stream.listenerCount('debug'),1);
  stream.emit('debug','[process] spawn: ffmpeg -i https://audio.test/?token=spawn-secret');
  for(let index=0;index<20;index++)stream.emit('debug',`[ffmpeg] log: line ${index}`);
  stream.emit('debug','[ffmpeg] log: Opening https://audio.test/file?token=url-secret for reading');
  stream.emit('debug','[ffmpeg] log: Cookie: cookie-secret');
  stream.emit('debug','[ffmpeg] log: Authorization: Bearer auth-secret');
  stream.emit('debug',`[ffmpeg] log: ${'x'.repeat(2000)}`);
  const error=new Error('failed');stream.emit('error',error);
  const tail=getStreamDiagnostics(error);
  assert.equal(tail.length,12);assert.ok(tail.every(line=>line.length<=500));
  assert.doesNotMatch(JSON.stringify(logs),/spawn-secret|url-secret|cookie-secret|auth-secret|audio\.test/);
  assert.match(logs[0][0],/Error tardío/);
  assert.doesNotThrow(()=>stream.emit('error','non-Error payload'));
});
const { emptyStreamError } = require('../dist/music/streamErrors');
const { classifyMusicError } = require('../dist/music/errors');
test('silent EOF retains sanitized FFmpeg diagnostics and classifies the actual transport failure', () => {
  const stream = new EventEmitter(); observeStreamErrors(stream);
  stream.emit('debug', '[process] spawn: ffmpeg -i https://audio.test/?token=spawn-secret');
  stream.emit('debug', '[ffmpeg] log: Opening https://audio.test/?token=url-secret');
  stream.emit('debug', '[ffmpeg] log: Authorization: Bearer auth-secret');
  stream.emit('debug', '[ffmpeg] log: HTTP error 403 Forbidden');
  const failure = emptyStreamError(stream);
  assert.equal(classifyMusicError(failure), 'SOURCE_BLOCKED');
  assert.match(getStreamDiagnostics(failure).join('\n'), /HTTP error 403/);
  assert.doesNotMatch(JSON.stringify(getStreamDiagnostics(failure)), /spawn-secret|url-secret|auth-secret|audio\.test/);
  stream.emit('debug', '[ffmpeg] log: Later message');
  assert.equal(getStreamDiagnostics(failure).length, 3, 'the failure freezes its own diagnostic snapshot');
});
test('silent EOF without useful stderr remains AUDIO_STALLED', () => {
  assert.equal(classifyMusicError(emptyStreamError(undefined)), 'AUDIO_STALLED');
});

test('fatal FFmpeg signals become stream errors while intentional kills remain quiet', t => {
  t.mock.method(console, 'error', () => {});
  for (const signal of ['SIGSEGV', 'SIGILL', 'SIGBUS', 'SIGABRT', 'SIGFPE']) {
    const stream = new EventEmitter(); observeStreamErrors(stream);
    const failures = []; stream.on('error', error => failures.push(error));
    stream.emit('debug', `[process] exit: code=unknown signal=${signal}`);
    assert.equal(failures.length, 1);
    assert.equal(classifyMusicError(failures[0]), 'FFMPEG_EXITED');
    assert.match(getStreamDiagnostics(failures[0]).join('\n'), new RegExp(signal));
  }
  const stream = new EventEmitter(); observeStreamErrors(stream);
  stream.on('error', () => assert.fail('normal cleanup must not start recovery'));
  stream.emit('debug', '[process] exit: code=unknown signal=SIGKILL');
  stream.emit('debug', '[process] exit: code=0 signal=unknown');
});
