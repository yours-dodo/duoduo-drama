import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../platform/database/database.module.js';
import { PrismaAuditRepository } from './infrastructure/prisma-audit.repository.js';
import {
  AUDIT_QUERY_REPOSITORY,
  AUDIT_REPOSITORY,
} from './ports/audit-repository.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    PrismaAuditRepository,
    { provide: AUDIT_REPOSITORY, useExisting: PrismaAuditRepository },
    { provide: AUDIT_QUERY_REPOSITORY, useExisting: PrismaAuditRepository },
  ],
  exports: [AUDIT_QUERY_REPOSITORY, AUDIT_REPOSITORY],
})
export class AuditModule {}
