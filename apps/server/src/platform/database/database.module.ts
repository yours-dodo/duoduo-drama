import { Module } from '@nestjs/common';

import { DatabaseReadinessService } from './database-readiness.service.js';
import { DATABASE_CLIENT } from './database-client.js';
import { DatabaseClock } from './database-clock.js';
import { PrismaService } from './prisma.service.js';
import { TransactionRunner } from './transaction-runner.js';

@Module({
  providers: [
    PrismaService,
    { provide: DATABASE_CLIENT, useExisting: PrismaService },
    DatabaseClock,
    DatabaseReadinessService,
    TransactionRunner,
  ],
  exports: [
    DATABASE_CLIENT,
    DatabaseClock,
    DatabaseReadinessService,
    TransactionRunner,
  ],
})
export class DatabaseModule {}
