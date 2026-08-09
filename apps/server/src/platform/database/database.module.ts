import { Module } from '@nestjs/common';

import { DatabaseReadinessService } from './database-readiness.service.js';
import { DATABASE_CLIENT } from './database-client.js';
import { PrismaService } from './prisma.service.js';
import { TransactionRunner } from './transaction-runner.js';

@Module({
  providers: [
    PrismaService,
    { provide: DATABASE_CLIENT, useExisting: PrismaService },
    DatabaseReadinessService,
    TransactionRunner,
  ],
  exports: [DATABASE_CLIENT, DatabaseReadinessService, TransactionRunner],
})
export class DatabaseModule {}
