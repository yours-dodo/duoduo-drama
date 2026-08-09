import { AsyncLocalStorage } from 'node:async_hooks';

import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient, type Prisma } from '../../generated/prisma/client.js';
import {
  SERVER_CONFIG,
  type ServerConfig,
} from '../../config/server-config.js';

export type DatabaseClient = PrismaClient | Prisma.TransactionClient;
export type DatabaseClientOperation<T> = (client: DatabaseClient) => Promise<T>;
export type DatabaseTransactionOperation<T> = () => Promise<T>;

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly client: PrismaClient;
  private readonly transactionContext =
    new AsyncLocalStorage<Prisma.TransactionClient>();
  private closed = false;

  constructor(@Inject(SERVER_CONFIG) config: ServerConfig) {
    const adapter = new PrismaPg({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 5_000,
    });

    this.client = new PrismaClient({ adapter });
  }

  async ping(): Promise<void> {
    this.assertOpen();
    await this.client.$queryRaw`SELECT 1`;
  }

  async runInTransaction<T>(
    operation: DatabaseTransactionOperation<T>,
  ): Promise<T> {
    this.assertOpen();

    if (this.transactionContext.getStore()) {
      return operation();
    }

    return this.client.$transaction((transaction) =>
      this.transactionContext.run(transaction, operation),
    );
  }

  async withClient<T>(operation: DatabaseClientOperation<T>): Promise<T> {
    this.assertOpen();
    return operation(this.transactionContext.getStore() ?? this.client);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.transactionContext.disable();
    await this.client.$disconnect();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Database client is closed');
    }
  }
}
