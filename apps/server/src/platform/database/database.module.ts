import { Module } from '@nestjs/common';

import { DatabaseReadinessService } from './database-readiness.service.js';
import { PrismaService } from './prisma.service.js';
import { TransactionRunner } from './transaction-runner.js';

@Module({
  providers: [PrismaService, DatabaseReadinessService, TransactionRunner],
  exports: [DatabaseReadinessService, TransactionRunner],
})
export class DatabaseModule {}
