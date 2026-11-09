const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { getTableConfig } = require('drizzle-orm/pg-core');
const schema = require('../dist/infrastructure/postgres/schema');
test('dialect schemas preserve tables, cascade/index contracts and millisecond numbers', () => {
  assert.equal(readFileSync('migrations/sqlite/0001_dashboard.sql', 'utf8'), readFileSync('migrations/0001_dashboard.sql', 'utf8'));
  assert.deepEqual(Object.keys(schema).sort(), ['users','webSessions','guildSettings','playlists','playlistTracks','favorites'].sort());
  for (const table of Object.values(schema)) {
    const config = getTableConfig(table);
    for (const column of config.columns.filter(c => /^(updated_at|created_at|expires_at)$/.test(c.name))) {
      assert.equal(column.getSQLType(), 'bigint');
      assert.equal(column.mapFromDriverValue('1760000000000'), 1760000000000);
      assert.equal(column.notNull, true);
    }
    for (const fk of config.foreignKeys) assert.equal(fk.onDelete, 'cascade');
  }
  assert.equal(schema.playlistTracks.position.getSQLType(), 'integer');
  assert.equal(schema.playlistTracks.duration.getSQLType(), 'integer');
  const sql = readFileSync('migrations/postgres/0001_dashboard.sql', 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX playlist_tracks_order/);
  assert.match(sql, /CREATE UNIQUE INDEX favorites_owner_url/);
});
