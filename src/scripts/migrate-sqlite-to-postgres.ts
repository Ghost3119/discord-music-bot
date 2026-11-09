import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { WebDatabase } from '../infrastructure/sqlite/database';
import { openPostgresDatabase, type PostgresDatabase } from '../infrastructure/postgres/database';
import { migrateSqliteToPostgres } from '../infrastructure/migration/sqliteToPostgres';

export async function main(args = process.argv.slice(2)): Promise<void> {
  let source: string | undefined, dryRun = false, batchSize = 100;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source') source = args[++i];
    else if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--batch-size') batchSize = Number(args[++i]);
    else throw new Error('Usage: --source PATH [--dry-run] [--batch-size 1..1000]');
  }
  if (!source) throw new Error('A SQLite --source path is required');
  // Do not load .env. Credentials must be provided by the invoking environment.
  const url = process.env['DATABASE_URL'];
  if (!dryRun) {
    let valid = false;
    try { valid = Boolean(url && ['postgres:', 'postgresql:'].includes(new URL(url).protocol)); } catch { /* Secret stays private. */ }
    if (!valid) throw new Error('A PostgreSQL DATABASE_URL is required');
  }
  const sqlite = new WebDatabase(new Database(source, { readonly: true, fileMustExist: true }));
  let postgres: PostgresDatabase | undefined;
  try {
    // A dry run never opens or initializes the destination database.
    if (!dryRun) {
      const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10_000 });
      pool.on('error', () => { console.error('[Migration] PostgreSQL connection error.'); });
      postgres = await openPostgresDatabase(pool);
    }
    const result = await migrateSqliteToPostgres(sqlite, postgres, { dryRun, batchSize });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    sqlite.close();
    await postgres?.close();
  }
}
if (require.main === module) void main().catch(() => {
  console.error('Migration failed. Check arguments, source schema and database availability. No source data was modified.');
  process.exitCode = 1;
});
