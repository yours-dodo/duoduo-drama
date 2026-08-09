import { describe, expect, it, vi } from 'vitest';

import type { ServerConfig } from '../../config/server-config.js';
import { DatabaseReadinessService } from './database-readiness.service.js';
import { PrismaService } from './prisma.service.js';
import { TransactionRunner } from './transaction-runner.js';

const SERVER_CONFIG: ServerConfig = {
  environment: 'test',
  port: 3001,
  cookieSecret: 'local-test-cookie-secret-change-me',
  trustedOrigins: ['http://localhost:3000'],
  databaseUrl:
    'postgresql://duoduo_server:test@127.0.0.1:1/unreachable_server_test',
  publicWebUrl: 'http://localhost:3000',
  loginTokenPepper: 'local-test-login-token-pepper-change-me',
  trustedProxyHops: 0,
};

describe('PrismaService', () => {
  it('rejects database work after releasing its client', async () => {
    const service = new PrismaService(SERVER_CONFIG);

    await service.onModuleDestroy();

    await expect(service.ping()).rejects.toThrow('Database client is closed');
    await expect(service.runInTransaction(async () => 'value')).rejects.toThrow(
      'Database client is closed',
    );
  });
});

describe('DatabaseReadinessService', () => {
  it('reports ready after a successful database probe', async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const readiness = new DatabaseReadinessService({ ping });

    await expect(readiness.isReady()).resolves.toBe(true);
    expect(ping).toHaveBeenCalledOnce();
  });

  it('reports not ready without exposing connection failures', async () => {
    const ping = vi
      .fn()
      .mockRejectedValue(new Error('password and host must stay private'));
    const readiness = new DatabaseReadinessService({ ping });

    await expect(readiness.isReady()).resolves.toBe(false);
  });

  it('turns a real driver connection failure into not ready', async () => {
    const service = new PrismaService(SERVER_CONFIG);
    const readiness = new DatabaseReadinessService(service);

    await expect(readiness.isReady()).resolves.toBe(false);
    await service.onModuleDestroy();
  });
});

describe('TransactionRunner', () => {
  it('delegates one operation to the database transaction boundary', async () => {
    const runInTransaction = vi.fn(async (operation) => operation());
    const runner = new TransactionRunner({ runInTransaction });
    const operation = vi.fn(async () => 'transaction');

    await expect(runner.run(operation)).resolves.toBe('transaction');
    expect(runInTransaction).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledOnce();
  });
});
