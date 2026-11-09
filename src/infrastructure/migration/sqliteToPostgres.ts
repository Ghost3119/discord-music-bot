import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { WebDatabase } from '../sqlite/database';
import type { PostgresDatabase } from '../postgres/database';

type Row = Record<string, string | number | null>;
const tables = [
  { name: 'users', key: 'id', columns: ['id', 'username', 'avatar', 'updated_at'] },
  { name: 'guild_settings', key: 'guild_id', columns: ['guild_id', 'updated_at'] },
  { name: 'web_sessions', key: 'token_hash', columns: ['token_hash', 'user_id', 'csrf_hash', 'created_at', 'expires_at'] },
  { name: 'playlists', key: 'id', columns: ['id', 'user_id', 'guild_id', 'name', 'created_at'] },
  { name: 'playlist_tracks', key: 'id', columns: ['id', 'playlist_id', 'url', 'title', 'artist', 'duration', 'thumbnail', 'source', 'position'] },
  { name: 'favorites', key: 'id', columns: ['id', 'user_id', 'guild_id', 'url', 'title', 'artist', 'duration', 'thumbnail', 'source', 'created_at'] },
] as const;
export interface MigrationReport {
  dryRun: boolean;
  counts: Record<string, number>;
  targetCounts: Record<string, number>;
  checksums: Record<string, string>;
}
const digest = (rows: Row[], columns: readonly string[]): string => createHash('sha256').update(JSON.stringify(rows.map(row => columns.map(c => row[c])))).digest('hex');
function normalized(row: Row, columns: readonly string[]): Row {
  return Object.fromEntries(columns.map(column => {
    const raw = row[column];
    const value = /^(updated_at|created_at|expires_at)$/.test(column) ? Number(raw) : raw;
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' || typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Migration contains unsupported or unsafe values');
    return [column, value];
  }));
}

/** Source is read in one SQLite snapshot and is never updated. Target writes are all-or-nothing. */
export async function migrateSqliteToPostgres(sqliteDb: WebDatabase, pgDb: PostgresDatabase | undefined, options: { dryRun?: boolean; batchSize?: number } = {}): Promise<MigrationReport> {
  const batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('batchSize must be an integer between 1 and 1000');
  const snapshot = sqliteDb.sqlite.transaction(() => tables.map(table => ({
    table,
    rows: (sqliteDb.sqlite.prepare(`SELECT ${table.columns.join(', ')} FROM ${table.name} ORDER BY ${table.key}`).all() as Row[]).map(row => normalized(row, table.columns)),
  })))();
  const report: MigrationReport = { dryRun: options.dryRun ?? false, counts: {}, targetCounts: {}, checksums: {} };
  for (const { table, rows } of snapshot) {
    report.counts[table.name] = rows.length;
    report.checksums[table.name] = digest(rows, table.columns);
  }
  if (options.dryRun) return report;
  if (!pgDb) throw new Error('PostgreSQL destination is required for a real migration');
  await pgDb.orm.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('sonora:data-migration'))`);
    for (const { table, rows } of snapshot) {
      for (let offset = 0; offset < rows.length; offset += batchSize) {
        const batch = rows.slice(offset, offset + batchSize);
        const values = batch.map(row => sql`(${sql.join(table.columns.map(c => sql`${row[c]}`), sql`, `)})`);
        await tx.execute(sql`INSERT INTO ${sql.identifier(table.name)} (${sql.join(table.columns.map(c => sql.identifier(c)), sql`, `)}) VALUES ${sql.join(values, sql`, `)} ON CONFLICT DO NOTHING`);
      }
    }
    for (const { table, rows } of snapshot) {
      const result = await tx.execute(sql`SELECT count(*) AS total FROM ${sql.identifier(table.name)}`) as { rows: { total: string | number }[] };
      const count = Number(result.rows[0]!.total);
      report.targetCounts[table.name] = count;
      if (count < rows.length) throw new Error(`Migration count mismatch: ${table.name}`);
      const verified: Row[] = [];
      for (let offset = 0; offset < rows.length; offset += batchSize) {
        const batch = rows.slice(offset, offset + batchSize);
        const selected = await tx.execute(sql`SELECT ${sql.join(table.columns.map(c => sql.identifier(c)), sql`, `)} FROM ${sql.identifier(table.name)} WHERE ${sql.identifier(table.key)} IN (${sql.join(batch.map(row => sql`${row[table.key]}`), sql`, `)})`) as { rows: Row[] };
        const found = new Map(selected.rows.map(row => [row[table.key], normalized(row, table.columns)]));
        for (const source of batch) {
          const target = found.get(source[table.key]);
          if (!target) throw new Error(`Migration row missing: ${table.name}`);
          verified.push(target);
        }
      }
      if (digest(verified, table.columns) !== report.checksums[table.name]) throw new Error(`Migration checksum mismatch: ${table.name}`);
    }
  });
  return report;
}
