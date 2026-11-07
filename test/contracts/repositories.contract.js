const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const hash = s => createHash('sha256').update(s).digest('hex');
const user = id => ({ id, username: id, avatar: null });
const track = (n = 0, extra = {}) => ({ url: `https://example.com/${n}`, title: `Track ${n}`, artist: 'Artist', duration: 120, thumbnail: null, source: 'other', ...extra });
const ids = p => p.tracks.map(t => t.id);
async function fails(action, statusCode, message) {
  await assert.rejects(async () => await action(), e => {
    assert.equal(e.kind, { 404: 'not_found', 409: 'conflict', 400: 'invalid' }[statusCode]);
    assert.equal(e.message, message);
    return true;
  });
}
/**
 * factory: () => Promise<{ repos, close }> (one fresh store per test).
 * repos has the grouped Repositories API, plus adapter-owned async contractFixtures:
 * setCsrfHash(token, hash), sessionHashes(), trackRows(playlistId).
 * Fixture hooks inspect physical deletion/order and seed pre-upgrade sessions;
 * they are test infrastructure, not proposed production repository ports.
 */
module.exports = function repositoriesContract(factory) {
  function contract(name, body) {
    test(`repositories: ${name}`, async t => {
      const { repos: r, close } = await factory();
      t.after(async () => await close());
      await r.sessions.createSession(user('a'), 1000, 10000);
      await r.sessions.createSession(user('b'), 1000, 10000);
      await body(r);
    });
  }
  contract('session creation, rotation, secrets, user updates and isolated revocation', async r => {
    const b = await r.sessions.createSession(user('b'), 1000, 100);
    const first = await r.sessions.createSession(user('a'), 1000, 100);
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(first.csrfToken, /^[a-f0-9]{64}$/);
    assert.deepEqual(await r.sessions.getSession(first.token, 1099), { user: user('a'), tokenHash: hash(first.token), csrfHash: hash(first.csrfToken), expiresAt: 1100 });
    const updated = { ...user('a'), username: 'Updated', avatar: 'avatar' };
    const next = await r.sessions.createSession(updated, 1050, 100);
    assert.notEqual(next.token, first.token);
    assert.notEqual(next.csrfToken, first.csrfToken);
    assert.equal(await r.sessions.getSession(first.token, 1050), null);
    assert.deepEqual((await r.sessions.getSession(next.token, 1050)).user, updated);
    assert.ok(!(await r.contractFixtures.sessionHashes()).includes(hash(first.token)));
    await r.sessions.deleteUserSessions('a');
    assert.equal(await r.sessions.getSession(next.token, 1050), null);
    assert.ok(await r.sessions.getSession(b.token, 1050));
    await r.sessions.deleteSession(b.token);
    await r.sessions.deleteSession(undefined);
    assert.equal(await r.sessions.getSession(b.token, 1050), null);
  });
  contract('expiry boundary physically deletes; purgeExpired and creation purge expired sessions', async r => {
    const a = await r.sessions.createSession(user('a'), 1000, 100);
    assert.ok(await r.sessions.getSession(a.token, 1099));
    assert.equal(await r.sessions.getSession(a.token, 1100), null);
    assert.equal(await r.sessions.getSession(a.token, 1000), null);
    assert.ok(!(await r.contractFixtures.sessionHashes()).includes(hash(a.token)));
    const second = await r.sessions.createSession(user('a'), 1000, 100);
    const b = await r.sessions.createSession(user('b'), 1000, 101);
    await r.sessions.purgeExpired(1100);
    assert.deepEqual(await r.contractFixtures.sessionHashes(), [hash(b.token)]);
    assert.equal(await r.sessions.getSession(second.token, 1000), null);
    await r.sessions.createSession(user('c'), 1101, 100);
    assert.ok(!(await r.contractFixtures.sessionHashes()).includes(hash(b.token)));
  });
  contract('invalid tokens return null; legacy deterministic CSRF sessions are retired', async r => {
    const s = await r.sessions.createSession(user('a'), 1000, 100);
    for (const token of [undefined, '', 'x'.repeat(42), 'x'.repeat(44), '!'.repeat(43), `${s.token}\n`, 'x'.repeat(43)]) assert.equal(await r.sessions.getSession(token, 1000), null);
    assert.ok(await r.sessions.getSession(s.token, 1000));
    await r.contractFixtures.setCsrfHash(s.token, hash(hash(`dashboard-csrf:${s.token}`)));
    assert.equal(await r.sessions.getSession(s.token, 1000), null);
    assert.ok(!(await r.contractFixtures.sessionHashes()).includes(hash(s.token)));
  });
  contract('rename, exact-id reorder, compact track deletion, append and cascade', async r => {
    const empty = await r.playlists.createPlaylist('a', 'x', 'Empty', 1000);
    assert.deepEqual(empty.tracks, []);
    assert.deepEqual(await r.playlists.reorderPlaylist('a', 'x', empty.id, []), empty);
    const p = await r.playlists.createPlaylistWithTracks('a', 'x', 'Original', [track(1), track(2), track(3)], 1001);
    const renamed = await r.playlists.renamePlaylist('a', 'x', p.id, 'Renamed');
    assert.equal(renamed.name, 'Renamed');
    assert.deepEqual(renamed.tracks, p.tracks);
    assert.deepEqual(await r.playlists.getPlaylist('a', 'x', p.id), renamed);
    const original = ids(p);
    for (const order of [[], original.slice(1), [...original, original[0]], [original[0], original[0], original[2]], [original[0], original[1], 'unknown']]) {
      await fails(() => r.playlists.reorderPlaylist('a', 'x', p.id, order), 400, 'trackIds must contain every playlist track exactly once');
      assert.deepEqual(ids(await r.playlists.getPlaylist('a', 'x', p.id)), original);
    }
    const reversed = [...original].reverse();
    assert.deepEqual(ids(await r.playlists.reorderPlaylist('a', 'x', p.id, reversed)), reversed);
    await fails(() => r.playlists.deletePlaylistTrack('a', 'x', p.id, 'unknown'), 404, 'Track not found');
    await r.playlists.deletePlaylistTrack('a', 'x', p.id, reversed[1]);
    assert.deepEqual(await r.contractFixtures.trackRows(p.id), [{ id: reversed[0], position: 0 }, { id: reversed[2], position: 1 }]);
    const added = await r.playlists.addPlaylistTrack('a', 'x', p.id, track(4));
    assert.deepEqual(ids(await r.playlists.getPlaylist('a', 'x', p.id)), [reversed[0], reversed[2], added.id]);
    await r.playlists.deletePlaylist('a', 'x', p.id);
    assert.deepEqual(await r.contractFixtures.trackRows(p.id), []);
    await fails(() => r.playlists.getPlaylist('a', 'x', p.id), 404, 'Playlist not found');
  });
  contract('100 playlists per user/guild across both creation paths', async r => {
    for (let n = 0; n < 100; n++) await r.playlists.createPlaylist('a', 'x', `List ${n}`, n);
    assert.equal((await r.playlists.listPlaylists('a', 'x')).length, 100);
    await fails(() => r.playlists.createPlaylist('a', 'x', 'Overflow', 100), 409, 'Playlist limit reached');
    await fails(() => r.playlists.createPlaylistWithTracks('a', 'x', 'Overflow', [track()], 100), 409, 'Playlist limit reached');
    await r.playlists.createPlaylist('b', 'x', 'Other user', 100);
    await r.playlists.createPlaylist('a', 'y', 'Other guild', 100);
    const [first] = await r.playlists.listPlaylists('a', 'x');
    await r.playlists.deletePlaylist('a', 'x', first.id);
    await r.playlists.createPlaylistWithTracks('a', 'x', 'Replacement', [track()], 101);
    assert.equal((await r.playlists.listPlaylists('a', 'x')).length, 100);
  });
  contract('500 tracks, import bounds, rejected writes and released capacity', async r => {
    for (const size of [0, 501]) await fails(() => r.playlists.createPlaylistWithTracks('a', 'x', 'Invalid', Array.from({ length: size }, (_, n) => track(n)), 1000), 400, 'Playlists must contain between 1 and 500 tracks');
    assert.deepEqual(await r.playlists.listPlaylists('a', 'x'), []);
    const p = await r.playlists.createPlaylistWithTracks('a', 'x', 'Full', Array.from({ length: 499 }, (_, n) => track(n)), 1000);
    await r.playlists.addPlaylistTrack('a', 'x', p.id, track(499));
    await fails(() => r.playlists.addPlaylistTrack('a', 'x', p.id, track(500)), 409, 'Playlist track limit reached');
    assert.equal((await r.playlists.getPlaylist('a', 'x', p.id)).tracks.length, 500);
    await r.playlists.deletePlaylistTrack('a', 'x', p.id, p.tracks[0].id);
    await r.playlists.addPlaylistTrack('a', 'x', p.id, track(500));
    const imported = await r.playlists.createPlaylistWithTracks('a', 'x', '500 imported', Array.from({ length: 500 }, (_, n) => track(n)), 1001);
    assert.equal(imported.tracks.length, 500);
  });
  contract('playlist isolation: every operation returns 404 for other user/guild/missing id', async r => {
    const p = await r.playlists.createPlaylistWithTracks('a', 'x', 'Private', [track()], 1000);
    for (const [u, g, id] of [['b', 'x', p.id], ['a', 'y', p.id], ['a', 'x', 'unknown']]) {
      for (const action of [() => r.playlists.getPlaylist(u, g, id), () => r.playlists.renamePlaylist(u, g, id, 'Stolen'), () => r.playlists.deletePlaylist(u, g, id), () => r.playlists.addPlaylistTrack(u, g, id, track()), () => r.playlists.deletePlaylistTrack(u, g, id, p.tracks[0].id), () => r.playlists.reorderPlaylist(u, g, id, ids(p))]) await fails(action, 404, 'Playlist not found');
    }
    assert.deepEqual(await r.playlists.listPlaylists('b', 'x'), []);
    assert.deepEqual(await r.playlists.listPlaylists('a', 'y'), []);
    assert.deepEqual(await r.playlists.getPlaylist('a', 'x', p.id), p);
    const other = await r.playlists.createPlaylistWithTracks('b', 'y', 'Other', [track(2)], 1001);
    await fails(() => r.playlists.deletePlaylistTrack('a', 'x', p.id, other.tracks[0].id), 404, 'Track not found');
  });
  contract('favorites exact URL deduplication, 1000 limit, isolated lists/deletion and 404', async r => {
    const first = await r.favorites.addFavorite('a', 'x', track(), 1000);
    assert.deepEqual(await r.favorites.addFavorite('a', 'x', track(0, { title: 'Replacement' }), 1001), first);
    for (let n = 1; n < 1000; n++) await r.favorites.addFavorite('a', 'x', track(n), 1000 + n);
    assert.equal((await r.favorites.listFavorites('a', 'x')).length, 1000);
    assert.deepEqual(await r.favorites.addFavorite('a', 'x', track(), 3000), first);
    await fails(() => r.favorites.addFavorite('a', 'x', track(1000), 3000), 409, 'Favorite limit reached');
    assert.deepEqual(await r.favorites.listFavorites('b', 'x'), []);
    assert.deepEqual(await r.favorites.listFavorites('a', 'y'), []);
    const b = await r.favorites.addFavorite('b', 'x', track(), 3000);
    const y = await r.favorites.addFavorite('a', 'y', track(), 3000);
    assert.notEqual(b.id, first.id);
    assert.notEqual(y.id, first.id);
    for (const [u, g, id] of [['b', 'x', first.id], ['a', 'y', first.id], ['a', 'x', 'unknown']]) await fails(() => r.favorites.deleteFavorite(u, g, id), 404, 'Favorite not found');
    await r.favorites.deleteFavorite('a', 'x', first.id);
    await fails(() => r.favorites.deleteFavorite('a', 'x', first.id), 404, 'Favorite not found');
    await r.favorites.addFavorite('a', 'x', track(1000), 3001);
    assert.equal((await r.favorites.listFavorites('a', 'x')).length, 1000);
    assert.deepEqual(await r.favorites.listFavorites('b', 'x'), [b]);
    assert.deepEqual(await r.favorites.listFavorites('a', 'y'), [y]);
  });
  contract('thumbnail sanitization and YouTube fallback across write/read paths', async r => {
    const fallback = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
    const cases = [
      [track(0, { thumbnail: ' https://i.scdn.co/image/cover?secret=value#fragment ' }), 'https://i.scdn.co/image/cover'],
      ...['http://i.ytimg.com/cover', 'https://evil.example/cover', 'https://i.ytimg.com.evil.example/cover', 'https://user:pass@i.ytimg.com/cover', 'https://i.ytimg.com:8443/cover', 'javascript:alert(1)', '', null, `https://i.ytimg.com/${'x'.repeat(2048)}`].map((thumbnail, n) => [track(n + 1, { thumbnail }), null]),
      ...[['https://youtu.be/dQw4w9WgXcQ', 'youtube', fallback], ['https://youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', fallback], ['https://evil.example/dQw4w9WgXcQ', 'youtube', null], ['https://youtu.be/invalid', 'youtube', null], ['https://youtu.be/dQw4w9WgXcQ', 'spotify', null]].map(([url, source, expected]) => [track(20, { url, source, thumbnail: 'https://evil.example/cover' }), expected]),
    ];
    for (const [n, [item, expected]] of cases.entries()) {
      const p = await r.playlists.createPlaylistWithTracks('a', 'x', 'Artwork', [item], n);
      assert.equal(p.tracks[0].thumbnail, expected);
      assert.equal((await r.playlists.addPlaylistTrack('a', 'x', p.id, item)).thumbnail, expected);
      assert.deepEqual((await r.playlists.getPlaylist('a', 'x', p.id)).tracks.map(t => t.thumbnail), [expected, expected]);
      assert.deepEqual((await r.playlists.listPlaylists('a', 'x')).find(t => t.id === p.id).tracks.map(t => t.thumbnail), [expected, expected]);
      assert.equal((await r.favorites.addFavorite('a', `art-${n}`, item, n)).thumbnail, expected);
      assert.equal((await r.favorites.listFavorites('a', `art-${n}`))[0].thumbnail, expected);
    }
  });
};
