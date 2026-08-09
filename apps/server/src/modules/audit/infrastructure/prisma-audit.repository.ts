import { Inject, Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type {
  KeysetPage,
  KeysetPageRequest,
} from '../../../platform/pagination/keyset-page.js';
import type {
  AuditQueryRepository,
  AuditRecordSnapshot,
  AuditRepository,
} from '../ports/audit-repository.js';

@Injectable()
export class PrismaAuditRepository
  implements AuditRepository, AuditQueryRepository
{
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

  listForTenant(
    tenantId: string,
    page: KeysetPageRequest,
  ): Promise<KeysetPage<AuditRecordSnapshot>> {
    return this.database.withClient(async (client) => {
      const after = page.after
        ? Prisma.sql`AND (occurred_at, id) < (${page.after.at}, ${page.after.id}::uuid)`
        : Prisma.empty;
      const rows = await client.$queryRaw<AuditRecordSnapshot[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          actor_user_id AS "actorUserId",
          action,
          target_type AS "targetType",
          target_id AS "targetId",
          before_summary AS "beforeSummary",
          after_summary AS "afterSummary",
          request_id AS "requestId",
          occurred_at AS "occurredAt"
        FROM audit_records
        WHERE tenant_id = ${tenantId}::uuid
          ${after}
        ORDER BY occurred_at DESC, id DESC
        LIMIT ${page.limit + 1}
      `;
      const items = rows.slice(0, page.limit);
      const last = items.at(-1);
      return {
        items,
        next:
          rows.length > page.limit && last
            ? { at: new Date(last.occurredAt), id: last.id }
            : null,
      };
    });
  }
}
