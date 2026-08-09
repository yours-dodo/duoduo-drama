import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import { Pool, type PoolClient } from 'pg';

import { AgentError } from '../../core/errors.js';
import type { PostgresAgentRuntimeOptions } from './types.js';

const migrationDirectory = new URL(
  '../../../migrations/agent-runtime/',
  import.meta.url,
);
const migrationLockName = 'duoduo_agent_runtime_migrations';

export async function migrateAgentRuntime(
  options: PostgresAgentRuntimeOptions,
): Promise<void> {
  try {
    await runMigrations(options);
  } catch (cause) {
    if (cause instanceof AgentError && cause.code === 'AGENT_MIGRATION_FAILED')
      throw cause;
    throw new AgentError(
      'AGENT_MIGRATION_FAILED',
      'Agent Runtime migration failed',
      { cause },
    );
  }
}

export async function getAgentRuntimeMigrationStatus(
  options: PostgresAgentRuntimeOptions,
): Promise<AgentRuntimeMigrationStatus> {
  const { pool, ownsPool } = resolvePool(options);
  try {
    const migrations = await loadMigrations();
    const table = await pool.query<{ relation: string | null }>(
      `SELECT to_regclass('agent_runtime.schema_migrations')::text AS relation`,
    );
    const applied = table.rows[0]?.relation
      ? await pool.query<AppliedMigrationStatusRow>(
          `SELECT version, name, checksum, applied_at
             FROM agent_runtime.schema_migrations
            ORDER BY version`,
        )
      : { rows: [] };
    const appliedByVersion = new Map(
      applied.rows.map((row) => [row.version, row] as const),
    );
    const entries: AgentRuntimeMigrationStatusEntry[] = migrations.map(
      (migration) => {
        const row = appliedByVersion.get(migration.version);
        appliedByVersion.delete(migration.version);
        return Object.freeze({
          version: migration.version,
          name: migration.name,
          state: !row
            ? ('pending' as const)
            : row.checksum === migration.checksum
              ? ('applied' as const)
              : ('checksum_mismatch' as const),
          appliedAt: row ? toIso(row.applied_at) : undefined,
        });
      },
    );
    for (const row of appliedByVersion.values())
      entries.push(
        Object.freeze({
          version: row.version,
          name: row.name,
          state: 'missing_file' as const,
          appliedAt: toIso(row.applied_at),
        }),
      );
    entries.sort((left, right) => left.version.localeCompare(right.version));
    return Object.freeze({ migrations: Object.freeze(entries) });
  } catch (cause) {
    throw migrationFailure(cause);
  } finally {
    if (ownsPool) await pool.end().catch(() => undefined);
  }
}

async function runMigrations(
  options: PostgresAgentRuntimeOptions,
): Promise<void> {
  const { pool, ownsPool } = resolvePool(options);
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [
      migrationLockName,
    ]);
    await client.query('CREATE SCHEMA IF NOT EXISTS agent_runtime');
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_runtime.schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const migrations = await loadMigrations();
    for (const migration of migrations) await applyMigration(client, migration);
  } finally {
    await client
      ?.query('SELECT pg_advisory_unlock(hashtext($1))', [migrationLockName])
      .catch(() => undefined);
    client?.release();
    if (ownsPool) await pool.end();
  }
}

async function loadMigrations(): Promise<readonly Migration[]> {
  const names = (await readdir(migrationDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(new URL(name, migrationDirectory), 'utf8');
      const separator = name.indexOf('_');
      return {
        version: name.slice(0, separator),
        name,
        checksum: createHash('sha256').update(sql).digest('hex'),
        sql,
      };
    }),
  );
}

async function applyMigration(
  client: PoolClient,
  migration: Migration,
): Promise<void> {
  const applied = await client.query<AppliedMigrationRow>(
    `SELECT checksum
       FROM agent_runtime.schema_migrations
      WHERE version = $1`,
    [migration.version],
  );
  const current = applied.rows[0];
  if (current) {
    if (current.checksum !== migration.checksum)
      throw new TypeError(`Agent Runtime migration checksum mismatch`);
    return;
  }

  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO agent_runtime.schema_migrations (version, name, checksum)
       VALUES ($1, $2, $3)`,
      [migration.version, migration.name, migration.checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export function resolvePool(options: PostgresAgentRuntimeOptions): {
  pool: Pool;
  ownsPool: boolean;
} {
  if ('pool' in options) return { pool: options.pool, ownsPool: false };
  return {
    pool: new Pool({ connectionString: options.connectionString }),
    ownsPool: true,
  };
}

interface Migration {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly sql: string;
}

interface AppliedMigrationRow {
  checksum: string;
}

interface AppliedMigrationStatusRow extends AppliedMigrationRow {
  version: string;
  name: string;
  applied_at: Date | string;
}

export interface AgentRuntimeMigrationStatusEntry {
  readonly version: string;
  readonly name: string;
  readonly state: 'applied' | 'pending' | 'checksum_mismatch' | 'missing_file';
  readonly appliedAt?: string;
}

export interface AgentRuntimeMigrationStatus {
  readonly migrations: readonly AgentRuntimeMigrationStatusEntry[];
}

function migrationFailure(cause: unknown): AgentError {
  return cause instanceof AgentError && cause.code === 'AGENT_MIGRATION_FAILED'
    ? cause
    : new AgentError(
        'AGENT_MIGRATION_FAILED',
        'Agent Runtime migration failed',
        { cause },
      );
}

function toIso(value: Date | string): string {
  return typeof value === 'string'
    ? new Date(value).toISOString()
    : value.toISOString();
}
