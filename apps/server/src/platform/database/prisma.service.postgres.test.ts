import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../config/server-config.js';
import {
  PostgresTestContext,
  readServerTestDatabaseUrl,
} from '../../test/postgres-test-context.js';
import { DatabaseReadinessService } from './database-readiness.service.js';
import { PrismaService } from './prisma.service.js';
import { TransactionRunner } from './transaction-runner.js';

const databaseUrl = readServerTestDatabaseUrl();

describe.skipIf(!databaseUrl)('Prisma PostgreSQL boundary', () => {
  let context: PostgresTestContext;
  let prisma: PrismaService;
  let readiness: DatabaseReadinessService;
  let transactions: TransactionRunner;

  beforeAll(async () => {
    const serverConfig: ServerConfig = {
      environment: 'test',
      port: 3001,
      cookieSecret: 'local-test-cookie-secret-change-me',
      trustedOrigins: ['http://localhost:3000'],
      databaseUrl: requireDatabaseUrl(databaseUrl),
    };

    context = new PostgresTestContext(serverConfig.databaseUrl);
    await context.prepare();
    prisma = new PrismaService(serverConfig);
    readiness = new DatabaseReadinessService(prisma);
    transactions = new TransactionRunner(prisma);
  });

  beforeEach(async () => {
    await context.reset();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await context.close();
  });

  it('connects through the Server-owned database and sees deployed migrations', async () => {
    await expect(readiness.isReady()).resolves.toBe(true);
    await expect(
      context.hasMigration('20260809000000_initialize'),
    ).resolves.toBe(true);
  });

  it('commits all work from a successful transaction', async () => {
    await transactions.run(async () => {
      await prisma.withClient(async (client) => {
        await client.$executeRaw`
          INSERT INTO "_server_transaction_probe" ("id", "value")
          VALUES (${randomUUID()}, ${'committed'})
        `;
      });
    });

    await expect(context.countProbeRows()).resolves.toBe(1);
  });

  it('rolls back all work when a transaction operation fails', async () => {
    await expect(
      transactions.run(async () => {
        await prisma.withClient(async (client) => {
          await client.$executeRaw`
            INSERT INTO "_server_transaction_probe" ("id", "value")
            VALUES (${randomUUID()}, ${'rolled-back'})
          `;
        });
        throw new Error('force transaction rollback');
      }),
    ).rejects.toThrow('force transaction rollback');

    await expect(context.countProbeRows()).resolves.toBe(0);
  });

  it('releases the client and rejects later database work', async () => {
    const disposablePrisma = new PrismaService({
      environment: 'test',
      port: 3001,
      cookieSecret: 'local-test-cookie-secret-change-me',
      trustedOrigins: ['http://localhost:3000'],
      databaseUrl: requireDatabaseUrl(databaseUrl),
    });

    await disposablePrisma.ping();
    await disposablePrisma.onModuleDestroy();

    await expect(disposablePrisma.ping()).rejects.toThrow(
      'Database client is closed',
    );
  });
});

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error('SERVER_TEST_POSTGRES_URL is required');
  }

  return value;
}
