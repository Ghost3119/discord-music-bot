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
