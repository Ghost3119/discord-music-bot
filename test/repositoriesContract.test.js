const repositoriesContract = require('./contracts/repositories.contract');
const { openWebDatabase, hashToken } = require('../dist/web/database');

repositoriesContract(async () => {
  const db = await openWebDatabase(':memory:');
  // Keep SQLite-only seeding and physical-state inspection out of the shared suite.
  const contractFixtures = {
    async setCsrfHash(token, csrfHash) {
      await db.sqlite.prepare('UPDATE web_sessions SET csrf_hash = ? WHERE token_hash = ?').run(csrfHash, hashToken(token));
    },
    async sessionHashes() {
      return (await db.sqlite.prepare('SELECT token_hash FROM web_sessions ORDER BY token_hash').all()).map(row => row.token_hash);
    },
    async trackRows(playlistId) {
      return await db.sqlite.prepare('SELECT id, position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(playlistId);
    },
  };
  const repos = Object.assign(db, { contractFixtures });
  return { repos, close: async () => await db.close() };
});
