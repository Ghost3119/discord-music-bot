const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { postgresFixture } = require('./helpers/postgres-fixture');
const schema = require('../dist/infrastructure/postgres/schema');
require('./contracts/repositories.contract')(postgresFixture);
const metadata = n => ({ url: `https://example.com/${n}`, title: `Song ${n}`, artist: 'Artist', duration: 10, thumbnail: null, source: 'other' });
async function fixture(t) {
  const f = await postgresFixture(); t.after(f.close);
  await f.repos.sessions.createSession({ id: 'a', username: 'A', avatar: null }, 1760000000000, 60000);
  return f;
}
test('PostgreSQL concurrent favorites deduplicate original metadata and honor the exact 1000 boundary', async t => {
  const { repos: r, db } = await fixture(t);
  await r.playlists.createPlaylist('a', 'x', 'Guild', 1);
  const same = await Promise.all(Array.from({ length: 15 }, (_, n) => r.favorites.addFavorite('a', 'x', { ...metadata('same'), title: `Original ${n}` }, n)));
  assert.equal(new Set(same.map(t => t.id)).size, 1);
  assert.ok(same.every(t => t.title === same[0].title));
  for (let offset = 0; offset < 998; offset += 100) await db.orm.insert(schema.favorites).values(Array.from({ length: Math.min(100, 998 - offset) }, (_, n) => ({ ...metadata(offset + n), id: randomUUID(), userId: 'a', guildId: 'x', createdAt: offset + n })));
  const results = await Promise.allSettled(Array.from({ length: 15 }, (_, n) => r.favorites.addFavorite('a', 'x', metadata(`edge-${n}`), n)));
  assert.equal(results.filter(t => t.status === 'fulfilled').length, 1);
  for (const result of results.filter(t => t.status === 'rejected')) assert.equal(result.reason.kind, 'conflict');
  assert.equal((await r.favorites.listFavorites('a', 'x')).length, 1000);
  assert.deepEqual(await r.favorites.addFavorite('a', 'x', metadata('same'), 9999), same[0]);
});
test('PostgreSQL concurrent playlist creation and track insertion cannot exceed limits or collide positions', async t => {
  const { repos: r, db } = await fixture(t);
  const p = await r.playlists.createPlaylist('a', 'x', 'Tracks', 1);
  await db.orm.insert(schema.playlists).values(Array.from({ length: 98 }, (_, n) => ({ id: randomUUID(), userId: 'a', guildId: 'x', name: `Seed ${n}`, createdAt: n })));
  const created = await Promise.allSettled(Array.from({ length: 15 }, (_, n) => n % 2 ? r.playlists.createPlaylist('a', 'x', `Edge ${n}`, n) : r.playlists.createPlaylistWithTracks('a', 'x', `Edge ${n}`, [metadata(n)], n)));
  assert.equal(created.filter(t => t.status === 'fulfilled').length, 1);
  assert.equal((await r.playlists.listPlaylists('a', 'x')).length, 100);
  await Promise.all(Array.from({ length: 15 }, (_, n) => r.playlists.addPlaylistTrack('a', 'x', p.id, metadata(n))));
  assert.deepEqual((await r.contractFixtures.trackRows(p.id)).map(t => t.position), Array.from({ length: 15 }, (_, n) => n));
  for (let offset = 15; offset < 499; offset += 100) await db.orm.insert(schema.playlistTracks).values(Array.from({ length: Math.min(100, 499 - offset) }, (_, n) => ({ ...metadata(offset + n), id: randomUUID(), playlistId: p.id, position: offset + n })));
  const tracks = await Promise.allSettled(Array.from({ length: 15 }, (_, n) => r.playlists.addPlaylistTrack('a', 'x', p.id, metadata(`last-${n}`))));
  assert.equal(tracks.filter(t => t.status === 'fulfilled').length, 1);
  assert.equal((await r.playlists.getPlaylist('a', 'x', p.id)).tracks.length, 500);
});
test('PostgreSQL sessions rotate atomically and keep modern epoch milliseconds as numbers; close is idempotent', async t => {
  const f = await fixture(t);
  const sessions = await Promise.all(Array.from({ length: 15 }, () => f.repos.sessions.createSession({ id: 'a', username: 'A', avatar: null }, 1760000000000, 60000)));
  const active = await Promise.all(sessions.map(s => f.repos.sessions.getSession(s.token, 1760000000001)));
  assert.equal(active.filter(Boolean).length, 1);
  assert.equal(active.find(Boolean).expiresAt, 1760000060000);
  await Promise.all([f.close(), f.close()]); await f.close();
});
test('PostgreSQL imported track input is snapshotted before waiting for its transaction', async t => {
  const { repos: r } = await fixture(t);
  const items = [metadata(1)];
  const pending = r.playlists.createPlaylistWithTracks('a', 'x', 'Snapshot', items, 1);
  items[0].title = 'Mutated during wait';
  items.push(...Array.from({ length: 500 }, (_, n) => metadata(n + 2)));
  const saved = await pending;
  assert.equal(saved.tracks.length, 1);
  assert.equal(saved.tracks[0].title, 'Song 1');
});
