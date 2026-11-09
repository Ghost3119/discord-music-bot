const { Pool } = require('pg');
const { randomBytes } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { eq, asc } = require('drizzle-orm');
const { createHash } = require('node:crypto');
const { openPostgresDatabase } = require('../../dist/infrastructure/postgres/database');
const { createPostgresRepositories } = require('../../dist/infrastructure/postgres/repositories');
const schema = require('../../dist/infrastructure/postgres/schema');
const hash = s => createHash('sha256').update(s).digest('hex');
async function postgresFixture() {
  // CI uses a disposable PostgreSQL service; each fixture owns an isolated schema.
  const url = process.env.SONORA_TEST_POSTGRES_URL;
  const namespace = `sonora_test_${randomBytes(12).toString('hex')}`;
  const admin = url ? new Pool({ connectionString: url }) : null;
  let client;
  if (admin) {
    try { await admin.query(`CREATE SCHEMA ${namespace}`); }
    catch (error) { await admin.end(); throw error; }
    client = new Pool({ connectionString: url, options: `-c search_path=${namespace}` });
  } else client = new PGlite();
  const db = await openPostgresDatabase(client);
  const repos = createPostgresRepositories(db);
  repos.contractFixtures = {
    async setCsrfHash(token, csrfHash) { await db.orm.update(schema.webSessions).set({ csrfHash }).where(eq(schema.webSessions.tokenHash, hash(token))); },
    async sessionHashes() { return (await db.orm.select().from(schema.webSessions).orderBy(asc(schema.webSessions.tokenHash))).map(r => r.tokenHash); },
    async trackRows(playlistId) { return await db.orm.select({ id: schema.playlistTracks.id, position: schema.playlistTracks.position }).from(schema.playlistTracks).where(eq(schema.playlistTracks.playlistId, playlistId)).orderBy(asc(schema.playlistTracks.position)); },
  };
  let closing;
  const close = () => closing ??= (async () => {
    try { await repos.close(); }
    finally { if (admin) { try { await admin.query(`DROP SCHEMA ${namespace} CASCADE`); } finally { await admin.end(); } } }
  })();
  return { db, client, repos, close };
}
module.exports = { postgresFixture };
