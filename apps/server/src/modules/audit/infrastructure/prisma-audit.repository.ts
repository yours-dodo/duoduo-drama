import { Inject, Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type {
  AuditRecordSnapshot,
  AuditRepository,
} from '../ports/audit-repository.js';

@Injectable()
export class PrismaAuditRepository implements AuditRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  async record(record: AuditRecordSnapshot): Promise<void> {
    await this.database.withClient((client) =>
      client.auditRecord.create({
        data: {
          ...record,
          beforeSummary:
            record.beforeSummary === null
              ? Prisma.JsonNull
              : (record.beforeSummary as Prisma.InputJsonValue),
          afterSummary:
            record.afterSummary === null
              ? Prisma.JsonNull
              : (record.afterSummary as Prisma.InputJsonValue),
        },
      }),
    );
  }
}
