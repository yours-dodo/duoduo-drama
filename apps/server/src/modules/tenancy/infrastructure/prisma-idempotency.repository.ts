import { Inject, Injectable } from '@nestjs/common';

import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type {
  IdempotencyLookup,
  IdempotencyRecordSnapshot,
  IdempotencyRepository,
} from '../ports/idempotency-repository.js';

@Injectable()
export class PrismaIdempotencyRepository implements IdempotencyRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  findLocked(
    lookup: IdempotencyLookup,
  ): Promise<IdempotencyRecordSnapshot | null> {
    return this.database.withClient(async (client) => {
      const lockKey = JSON.stringify([
        lookup.scopeKey,
        lookup.operationType,
        lookup.idempotencyKey,
      ]);
      await client.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `;

      return client.idempotencyRecord.findUnique({
        where: {
          scopeKey_operationType_idempotencyKey: lookup,
        },
      }) as Promise<IdempotencyRecordSnapshot | null>;
    });
  }

  create(
    record: IdempotencyRecordSnapshot,
  ): Promise<IdempotencyRecordSnapshot> {
    return this.database.withClient((client) =>
      client.idempotencyRecord.create({ data: record }),
    ) as Promise<IdempotencyRecordSnapshot>;
  }
}
