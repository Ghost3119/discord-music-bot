const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { describeMusicError } = require('../dist/music/errors');
const { registerDisTubeEvents } = require('../dist/music/events');

test('known errors explain the cause and suggest a next step', () => {
  for (const [code, text] of [
    ['CANNOT_RESOLVE_SONG', /No se encontraron canciones/],
    ['NO_RESULT', /La plataforma también puede haber fallado/],
    ['VOICE_CONNECT_FAILED', /Anulación de región/],
    ['VOICE_FULL', /límite de usuarios/],
    ['VOICE_MISSING_PERMS', /Ver canal, Conectar y Hablar/],
    ['VOICE_RECONNECT_FAILED', /Se perdió la conexión/],
    ['NOT_SUPPORTED_URL', /Enlace no compatible/],
    ['EMPTY_PLAYLIST', /playlist.*pública/],
    ['EMPTY_FILTERED_PLAYLIST', /fueron filtradas/],
    ['NON_NSFW', /restricción de edad/],
    ['UNAVAILABLE_VIDEO', /Contenido no disponible/],
    ['CANNOT_GET_STREAM_URL', /Se encontró la canción/],
    ['UNPLAYABLE_FORMATS', /formato de audio compatible/],
    ['FFMPEG_NOT_INSTALLED', /FFmpeg/],
    ['FFMPEG_EXITED', /motor de audio se detuvo/],
    ['ERR_STREAM_PREMATURE_CLOSE', /audio se interrumpió/],
    ['NO_EXTRACTOR_PLUGIN', /buscador de música no está configurado/],
    ['NO_QUEUE', /Usa \/play/],
    ['NO_UP_NEXT', /siguiente canción/],
  ]) {
    const result = describeMusicError({ errorCode: code });
    assert.match(result, text, code);
    assert.ok(result.includes(`Código: \`${code}\``), code);
    assert.match(result, /💡/);
  }
});

test('yt-dlp messages distinguish restrictions, outages and extraction failures', () => {
  for (const [message, code] of [
    ["Sign in to confirm you're not a bot", 'SOURCE_BLOCKED'],
    ['HTTP Error 403: Forbidden', 'SOURCE_BLOCKED'],
    ['HTTP Error 429: Too Many Requests', 'SOURCE_RATE_LIMITED'],
    ['Sign in to confirm your age', 'AGE_RESTRICTED'],
    ['This video is private', 'PRIVATE_CONTENT'],
    ['The uploader has not made this video available in your country', 'GEO_RESTRICTED'],
    ['Video unavailable. This video has been removed', 'UNAVAILABLE_VIDEO'],
    ['Requested format is not available', 'UNPLAYABLE_FORMATS'],
    ['Unable to download API page: timed out', 'NETWORK_TIMEOUT'],
    ['HTTP Error 503: Service Unavailable', 'SOURCE_UNAVAILABLE'],
    ['spawn C:\\bot\\yt-dlp.exe ENOENT', 'YTDLP_NOT_FOUND'],
    ['yt-dlp did not return a playable stream URL', 'CANNOT_GET_STREAM_URL'],
  ]) {
    assert.ok(describeMusicError(new Error(message)).includes(`Código: \`${code}\``), message);
  }
});

test('network and Discord codes work through nested causes', () => {
  for (const [code, expected] of [
    ['ETIMEDOUT', 'NETWORK_TIMEOUT'],
    ['ENOTFOUND', 'NETWORK_ERROR'],
    ['ECONNRESET', 'NETWORK_ERROR'],
    [50013, 'DISCORD_MISSING_PERMS'],
  ]) {
    const cause = Object.assign(new Error('Connection failed'), { code });
    assert.ok(describeMusicError(new Error('fetch failed', { cause })).includes(`Código: \`${expected}\``));
  }
});

test('a known DisTube code is not reclassified by text in the query', () => {
  const message = describeMusicError({ errorCode: 'NO_RESULT', message: 'Cannot find any song (Sign in HTTP Error 403)' });
  assert.match(message, /Código: `NO_RESULT`/);
});

test('unknown errors keep raw URLs, credentials and stack traces out of Discord', () => {
  const error = Object.assign(new Error('https://secret.test/audio?token=hidden-token C:\\private\\file'), { errorCode: 'CUSTOM_FAILURE' });
  const message = describeMusicError(error, { songName: '**song**' });
  assert.match(message, /Código: `CUSTOM_FAILURE`/);
  assert.ok(message.includes('\\*\\*song\\*\\*'));
  assert.doesNotMatch(message, /hidden-token|secret\.test|private|at /);
  assert.ok(message.length < 4096);
});

test('unexpected values and circular causes still get a readable error', () => {
  const circular = new Error('Unexpected');
  circular.cause = circular;
  for (const error of [null, undefined, 123, {}, circular, { code: '__proto__' }, { code: 'toString' }, { code: '`unsafe`' }]) {
    assert.match(describeMusicError(error), /Código: `UNKNOWN`/);
  }
});

test('empty results identify the selected search source', () => {
  const error = { errorCode: 'CANNOT_RESOLVE_SONG' };
  assert.match(describeMusicError(error, { source: 'youtube' }), /YouTube y YouTube Music/);
  assert.match(describeMusicError(error, { source: 'soundcloud' }), /canciones en SoundCloud/);
});

test('playback events send a classified error and identify the affected song', async (t) => {
  t.mock.method(console, 'error', () => {});
  const distube = new EventEmitter();
  registerDisTubeEvents(distube);
  const messages = [];
  const queue = { textChannel: { send: async (message) => { messages.push(message); } } };
  distube.emit('error', Object.assign(new Error('audio failed'), { errorCode: 'FFMPEG_EXITED' }), queue, { name: 'Multiorgásmica' });
  assert.match(messages[0].embeds[0].data.description, /Multiorgásmica/);
  assert.match(messages[0].embeds[0].data.description, /Código: `FFMPEG_EXITED`/);
  distube.emit('error', new Error('unknown'), {});

  const rejectedQueue = { textChannel: { send: async () => { throw new Error('Missing Permissions'); } } };
  distube.emit('error', new Error('unknown'), rejectedQueue);
  await new Promise((resolve) => setImmediate(resolve));
});
