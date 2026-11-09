const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { readWebConfig, validateWebConfig } = require('../dist/web/config');
const { openWebRepositories } = require('../dist/runtime/webDashboard');
const env = { WEB_ENABLED: 'true', WEB_CLIENT_ID: '111111111111111111', WEB_CLIENT_SECRET: 'test-only', WEB_ALLOWED_USER_IDS: '222222222222222222' };
test('database configuration defaults to SQLite and accepts both PostgreSQL schemes', () => {
  assert.equal(readWebConfig(env).databaseDriver, 'sqlite');
  for (const scheme of ['postgres', 'postgresql']) {
    const url = `${scheme}://user:credential@localhost/sonora`;
    assert.equal(readWebConfig({ ...env, DATABASE_DRIVER: 'postgres', DATABASE_URL: url }).databaseUrl, url);
  }
  const legacy = readWebConfig(env); delete legacy.databaseDriver;
  assert.doesNotThrow(() => validateWebConfig(legacy));
});
test('invalid database driver/URL errors never disclose supplied credentials or parser input', () => {
  for (const values of [{ DATABASE_DRIVER: 'unknown-secret' }, ...[undefined, '', 'invalid-secret-url', 'http://user:secret@host/db'].map(DATABASE_URL => ({ DATABASE_DRIVER: 'postgres', DATABASE_URL }))]) {
    assert.throws(() => readWebConfig({ ...env, ...values }), error => {
      assert.match(error.message, /DATABASE_(DRIVER|URL)/);
      assert.doesNotMatch(JSON.stringify(error, Object.getOwnPropertyNames(error)), /unknown-secret|invalid-secret-url|user:secret/);
      return true;
    });
  }
});
test('composition root selects SQLite by default and PostgreSQL pool with idempotent ownership', async t => {
  const r = await openWebRepositories({ ...readWebConfig(env), databasePath: ':memory:' });
  await r.sessions.createSession({ id: 'a', username: 'A', avatar: null }, 1, 100);
  await r.close(); await r.close();
  const pg = require('pg');
  const driver = require('../dist/infrastructure/postgres/database');
  let pool, closes = 0;
  class FakePool extends EventEmitter { constructor(options) { super(); this.options = options; this.end = async () => { closes++; }; pool = this; } async end() { closes++; } }
  t.mock.method(pg, 'Pool', FakePool);
  t.mock.method(driver, 'openPostgresDatabase', async client => new driver.PostgresDatabase({}, async () => await client.end()));
  const url = 'postgresql://user:do-not-log@localhost/db';
  const repository = await openWebRepositories({ ...readWebConfig(env), databaseDriver: 'postgres', databaseUrl: url });
  assert.equal(pool.options.connectionString, url);
  const logs = []; t.mock.method(console, 'warn', m => logs.push(m));
  pool.emit('error', Error(url));
  assert.equal(logs.length, 1); assert.ok(!logs[0].includes(url));
  await Promise.all([repository.close(), repository.close()]);
  assert.equal(closes, 1);
});
