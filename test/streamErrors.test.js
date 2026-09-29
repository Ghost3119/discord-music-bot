const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { observeStreamErrors } = require('../dist/music/streamErrors');

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
