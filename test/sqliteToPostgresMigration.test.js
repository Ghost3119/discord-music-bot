const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { postgresFixture } = require('./helpers/postgres-fixture');
const { openWebDatabase } = require('../dist/infrastructure/sqlite/database');
const { createSqliteRepositories } = require('../dist/infrastructure/sqlite/repositories');
const { migrateSqliteToPostgres } = require('../dist/infrastructure/migration/sqliteToPostgres');
const schema = require('../dist/infrastructure/postgres/schema');
const NOW = 1760000000000;
const metadata = n => ({ url: `https://example.com/${n}`, title: `Track ${n}`, artist: 'Artist', duration: n, thumbnail: null, source: 'other' });
async function seed(db) {
  const r = createSqliteRepositories(db), sessions = {};
  for (const id of ['a','b']) sessions[id] = await r.sessions.createSession({ id, username: `User ${id}`, avatar: id === 'a' ? 'avatar' : null }, NOW, 60000);
  const playlist = await r.playlists.createPlaylistWithTracks('a', 'x', 'Ordered', [metadata(1),metadata(2),metadata(3)], NOW);
  await r.playlists.reorderPlaylist('a','x',playlist.id,[playlist.tracks[2].id,playlist.tracks[0].id,playlist.tracks[1].id]);
  await r.playlists.createPlaylist('b','y','Empty',NOW+1);
  await r.favorites.addFavorite('a','x',metadata(4),NOW+2);
  await r.favorites.addFavorite('b','y',metadata(5),NOW+3);
  return { r, sessions };
}
test('dry run is write-free; batched SQLite migration preserves sessions, playlist order, favorites and is idempotent', async t => {
  const source = openWebDatabase(':memory:'); t.after(() => source.close());
  const { r, sessions } = await seed(source);
  const pg = await postgresFixture(); t.after(pg.close);
  const before = source.sqlite.serialize();
  const preview = await migrateSqliteToPostgres(source, pg.db, { dryRun: true, batchSize: 2 });
  assert.deepEqual(preview.counts, { users:2, guild_settings:2, web_sessions:2, playlists:2, playlist_tracks:3, favorites:2 });
  for (const table of Object.values(schema)) assert.deepEqual(await pg.db.orm.select().from(table), []);
  const first = await migrateSqliteToPostgres(source, pg.db, { batchSize: 2 });
  assert.deepEqual(first.counts, preview.counts);
  assert.deepEqual(first.targetCounts, first.counts);
  assert.deepEqual(first.checksums, preview.checksums);
  for (const id of ['a','b']) assert.deepEqual(await pg.repos.sessions.getSession(sessions[id].token,NOW+1), await r.sessions.getSession(sessions[id].token,NOW+1));
  for (const [u,g] of [['a','x'],['b','y'],['a','y']]) {
    assert.deepEqual(await pg.repos.playlists.listPlaylists(u,g),await r.playlists.listPlaylists(u,g));
    assert.deepEqual(await pg.repos.favorites.listFavorites(u,g),await r.favorites.listFavorites(u,g));
  }
  const second = await migrateSqliteToPostgres(source, pg.db, { batchSize: 1 });
  assert.deepEqual(second, first);
  assert.deepEqual(source.sqlite.serialize(), before);
  await assert.rejects(migrateSqliteToPostgres(source, pg.db, { batchSize: 0 }), /batchSize/);
});
test('conflicting target data fails checksum verification and rolls back every copied table', async t => {
  const source = openWebDatabase(':memory:'); t.after(() => source.close()); await seed(source);
  const pg = await postgresFixture(); t.after(pg.close);
  await pg.db.orm.insert(schema.users).values({ id:'a',username:'Existing target',avatar:null,updatedAt:NOW });
  await assert.rejects(migrateSqliteToPostgres(source,pg.db), /checksum mismatch: users/);
  assert.deepEqual((await pg.db.orm.select().from(schema.users)).map(r=>r.username),['Existing target']);
  for (const [name,table] of Object.entries(schema)) if (name !== 'users') assert.deepEqual(await pg.db.orm.select().from(table),[]);
});
test('migration CLI dry run uses a readonly source without connecting to DATABASE_URL or leaking it', async t => {
  const directory=mkdtempSync(path.join(os.tmpdir(),'sonora-migrate-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'source.db');
  const db=openWebDatabase(file); await seed(db); db.close();
  const checksum=()=>createHash('sha256').update(readFileSync(file)).digest('hex');
  const before=checksum();
  const secret='invalid-url-containing-private-credential';
  const args=['dist/scripts/migrate-sqlite-to-postgres.js','--source',file];
  const result=spawnSync(process.execPath,[...args,'--dry-run'],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,DATABASE_URL:secret}});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).counts.playlist_tracks,3);
  assert.equal(checksum(),before);
  const rejected=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,DATABASE_URL:secret}});
  assert.equal(rejected.status,1);
  assert.ok(!rejected.stderr.includes(secret)); assert.equal(checksum(),before);
});
