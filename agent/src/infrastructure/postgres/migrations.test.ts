import { describe, expect, it } from 'vitest';

import {
  getAgentRuntimeMigrationStatus,
  migrateAgentRuntime,
} from './migrations.js';

describe('Agent Runtime PostgreSQL migrations', () => {
  it('discovers the additive external-effect reconciliation migration', async () => {
    const status = await getAgentRuntimeMigrationStatus({
      pool: {
        query: async () => ({ rows: [{ relation: null }] }),
      } as never,
    });

    expect(status.migrations.at(-1)).toMatchObject({
      version: '0008',
      name: '0008_external_effect_reconciliation.sql',
      state: 'pending',
    });
  });

  it('sanitizes connection and migration failures', async () => {
    const failure = await migrateAgentRuntime({
      pool: {
        connect: async () => {
          throw new Error('private PostgreSQL endpoint and password');
        },
      } as never,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'AGENT_MIGRATION_FAILED',
      message: 'Agent Runtime migration failed',
    });
    expect(JSON.stringify(failure)).not.toContain(
      'private PostgreSQL endpoint and password',
    );
  });
});
