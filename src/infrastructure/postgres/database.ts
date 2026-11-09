import type { Pool } from 'pg';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { pgTable, integer, bigint, type PgDatabase, type PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as schema from './schema';

export type PostgresOrm = PgDatabase<PgQueryResultHKT, typeof schema>;
const migrations = pgTable('web_migrations', { version: integer('version').primaryKey(), appliedAt: bigint('applied_at', { mode: 'number' }).notNull() });

export class PostgresDatabase {
  private closing: Promise<void> | undefined;
  constructor(readonly orm: PostgresOrm, private readonly closeClient: () => Promise<void>) {}
  close(): Promise<void> { return this.closing ??= Promise.resolve().then(() => this.closeClient()); }
}

/** Takes ownership of the supplied client, including failed initialization. */
export async function openPostgresDatabase(client: Pool | PGlite): Promise<PostgresDatabase> {
  // PGlite is a dev dependency: its driver is loaded only for embedded test clients.
  const orm: PostgresOrm = 'end' in client ? drizzle(client, { schema }) : (await import('drizzle-orm/pglite')).drizzle(client, { schema });
  const database = new PostgresDatabase(orm, async () => { if ('end' in client) await client.end(); else await client.close(); });
  try {
    await orm.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('sonora:migrations'))`);
      await tx.execute(sql`CREATE TABLE IF NOT EXISTS web_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)`);
      const applied = await tx.select().from(migrations).where(sql`${migrations.version} = 1`);
      if (!applied.length) {
        const ddl = readFileSync(path.resolve(__dirname, '../../../migrations/postgres/0001_dashboard.sql'), 'utf8');
        for (const statement of ddl.split(';').map(s => s.trim()).filter(Boolean)) await tx.execute(sql.raw(statement));
        await tx.insert(migrations).values({ version: 1, appliedAt: Date.now() });
      }
    });
    return database;
  } catch (error) { await database.close(); throw error; }
}
