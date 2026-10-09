const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLogger, redact } = require('../scripts/logger.cjs');
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-logs-'));
  t.after(() => { assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(directory, { recursive: true, force: true }); });
  return directory;
}
test('log rotation retains bounded valid JSON records and masks credentials', async t => {
  const directory = temporary(t), logger = createLogger({ directory, maxBytes: 500, backups: 2 });
  for (let i = 0; i < 20; i++) logger.write('error', [`${i} https://discord.com/api/webhooks/123/webhook-secret`, { token: 'token-secret', message: 'x'.repeat(100) }]);
  // Production close is bounded. Wait for this fixture's actual disk work before
  // inspecting and removing its directory, even on a busy test machine.
  await logger.flush(10000);
  await logger.close();
  const files = fs.readdirSync(directory); assert.ok(files.length <= 3); assert.ok(files.length > 1);
  for (const file of files) {
    const text = fs.readFileSync(path.join(directory, file), 'utf8'); assert.doesNotMatch(text, /token-secret|webhook-secret/);
    assert.ok(fs.statSync(path.join(directory, file)).size <= 500);
    for (const line of text.trim().split('\n')) assert.equal(JSON.parse(line).level, 'error');
  }
});
test('unwritable logging falls back once to console and keeps a bounded queue', async t => {
  const directory = temporary(t), file = path.join(directory, 'file'); fs.writeFileSync(file, 'occupied');
  const errors = [], logger = createLogger({ directory: file, maxPending: 2, report: (...args) => errors.push(args) });
  for (let i = 0; i < 100; i++) logger.write('error', ['test']);
  await logger.flush(10000); logger.write('error', ['later']); await logger.close();
  assert.equal(errors.length, 1); assert.ok(logger.stats().dropped >= 98); assert.equal(logger.stats().pending, 0);
});
test('sensitive headers, signed URLs and named secrets are redacted and capped', () => {
  for (const input of ['Cookie: session-secret', 'Authorization: Bearer auth-secret', 'https://audio.test/a?token=url-secret', 'DISCORD_TOKEN: "bot-secret"', 'client_secret=client-secret']) {
    assert.doesNotMatch(redact(input), /session-secret|auth-secret|url-secret|bot-secret|client-secret/);
  }
  assert.ok(redact('x'.repeat(10000)).length <= 8000);
});

test('redaction preserves ordinary bot diagnostics while hiding standalone credentials', () => {
  for (const input of ['[Bot Voice State] Canal: Lounge', '✅ Bot conectado como Musica#0338',
    'El bot todavía no puede identificar este error.', 'El bot sigue disponible.']) assert.equal(redact(input), input);
  for (const prefix of ['Bot', 'Bearer', 'bOt']) {
    assert.doesNotMatch(redact(`${prefix} real-looking.secret.token-value`), /real-looking/);
  }
});
