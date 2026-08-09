import { Inject, Injectable } from '@nestjs/common';

import {
  PrismaService,
  type DatabaseTransactionOperation,
} from './prisma.service.js';

export interface TransactionClient {
  runInTransaction<T>(operation: DatabaseTransactionOperation<T>): Promise<T>;
}

@Injectable()
export class TransactionRunner {
  constructor(
    @Inject(PrismaService) private readonly client: TransactionClient,
  ) {}

  run<T>(operation: DatabaseTransactionOperation<T>): Promise<T> {
    return this.client.runInTransaction(operation);
  }
}
