const assert = require('node:assert/strict');
const test = require('node:test');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const run = promisify(execFile);
const entry = require.resolve('../dist/deploy-commands');
function fixture(t, replacement) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-deploy-test-'));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const preload = path.join(directory, 'rest.cjs');
  fs.writeFileSync(preload, `
    const logger = require(${JSON.stringify(require.resolve('../scripts/logger.cjs'))});
    const install = logger.installConsole;
    logger.installConsole = options => install({ ...options, directory: ${JSON.stringify(path.join(directory, 'logs'))} });
    require(${JSON.stringify(require.resolve('discord.js'))}).REST.prototype.put = ${replacement};
  `);
  return { preload, options: { cwd: directory, windowsHide: true, timeout: 10000,
    env: { ...process.env, DISCORD_TOKEN: 'fixture-token', CLIENT_ID: '1503904508109918299', GUILD_ID: '1082065100111872170' } } };
}

test('command deployment can be checked without credentials, network or a bot session', async t => {
  const f = fixture(t, 'async () => { throw new Error("Network must not be used"); }');
  f.options.env.DISCORD_TOKEN = ''; f.options.env.CLIENT_ID = ''; f.options.env.GUILD_ID = '';
  const result = await run(process.execPath, ['--require', f.preload, entry, '--dry-run'], f.options);
  assert.match(result.stdout, /19 comandos/); assert.match(result.stdout, /SHA-256.*[a-f0-9]{64}/);
  assert.match(result.stdout, /No se contactó con Discord/); assert.equal(result.stderr, '');
});

test('failed registration exits unsuccessfully and hides credentials in the diagnostic', async t => {
  const f = fixture(t, 'async () => { throw new Error("HTTP 403 https://discord.com/api/webhooks/id/webhook-secret Authorization: Bot fixture-token"); }');
  await assert.rejects(run(process.execPath, ['--require', f.preload, entry], f.options), error => {
    assert.equal(error.code, 1); assert.match(error.stderr, /Error registrando comandos/);
    assert.doesNotMatch(error.stderr, /webhook-secret|fixture-token/);
    assert.doesNotMatch(error.stdout, /registrados correctamente/); return true;
  });
});

test('registration success requires Discord to acknowledge the expected command set', async t => {
  const f = fixture(t, 'async (_route, options) => options.body.map(command => ({ name: command.name }))');
  const result = await run(process.execPath, ['--require', f.preload, entry], f.options);
  assert.match(result.stdout, /Comandos registrados correctamente/); assert.equal(result.stderr, '');
});

test('an incomplete registration response fails instead of authorizing activation', async t => {
  const f = fixture(t, 'async () => []');
  await assert.rejects(run(process.execPath, ['--require', f.preload, entry], f.options), error => {
    assert.equal(error.code, 1); assert.match(error.stderr, /registro distinto del esperado/); return true;
  });
});
