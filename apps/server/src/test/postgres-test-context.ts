import { Pool } from 'pg';

const TRANSACTION_PROBE_TABLE = '_server_transaction_probe';

export function readServerTestDatabaseUrl(): string | undefined {
  const databaseUrl = process.env.SERVER_TEST_POSTGRES_URL?.trim();

  if (process.env.SERVER_TEST_POSTGRES_REQUIRED === '1' && !databaseUrl) {
    throw new Error(
      'SERVER_TEST_POSTGRES_URL is required by the dedicated PostgreSQL test command',
    );
  }

  return databaseUrl || undefined;
}

export class PostgresTestContext {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5_000,
      max: 2,
    });
  }

  async prepare(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS "${TRANSACTION_PROBE_TABLE}" (
        "id" TEXT PRIMARY KEY,
        "value" TEXT NOT NULL
      )
    `);
    await this.reset();
  }

  async reset(): Promise<void> {
    await this.pool.query(`TRUNCATE TABLE "${TRANSACTION_PROBE_TABLE}"`);
  }

  async countProbeRows(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${TRANSACTION_PROBE_TABLE}"`,
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async hasMigration(migrationName: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1 AND "finished_at" IS NOT NULL',
      [migrationName],
    );

    return result.rowCount === 1;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
