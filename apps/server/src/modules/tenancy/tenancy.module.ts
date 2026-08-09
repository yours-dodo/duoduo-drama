import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';

import { DatabaseClock } from '../../platform/database/database-clock.js';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { TransactionRunner } from '../../platform/database/transaction-runner.js';
import { AuditModule } from '../audit/audit.module.js';
import {
  AUDIT_REPOSITORY,
  type AuditRepository,
} from '../audit/ports/audit-repository.js';
import { IdentityModule } from '../identity/identity.module.js';
import { CreateTeam } from './application/create-team.js';
import { ListMyTeams } from './application/list-my-teams.js';
import { MeController } from './http/me.controller.js';
import { TeamsController } from './http/teams.controller.js';
import { TenantContextGuard } from './http/tenant-context.guard.js';
import { NodeRequestFingerprint } from './infrastructure/node-request-fingerprint.js';
import { PrismaIdempotencyRepository } from './infrastructure/prisma-idempotency.repository.js';
import { PrismaTeamMembershipRepository } from './infrastructure/prisma-team-membership.repository.js';
import { PrismaTeamRepository } from './infrastructure/prisma-team.repository.js';
import {
  IDEMPOTENCY_REPOSITORY,
  type IdempotencyRepository,
} from './ports/idempotency-repository.js';
import {
  TEAM_MEMBERSHIP_REPOSITORY,
  type TeamMembershipRepository,
} from './ports/team-membership-repository.js';
import {
  TEAM_REPOSITORY,
  type TeamRepository,
} from './ports/team-repository.js';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule],
  controllers: [TeamsController, MeController],
  providers: [
    PrismaTeamRepository,
    { provide: TEAM_REPOSITORY, useExisting: PrismaTeamRepository },
    PrismaTeamMembershipRepository,
    {
      provide: TEAM_MEMBERSHIP_REPOSITORY,
      useExisting: PrismaTeamMembershipRepository,
    },
    PrismaIdempotencyRepository,
    {
      provide: IDEMPOTENCY_REPOSITORY,
      useExisting: PrismaIdempotencyRepository,
    },
    NodeRequestFingerprint,
    {
      provide: CreateTeam,
      inject: [
        TEAM_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        IDEMPOTENCY_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
        NodeRequestFingerprint,
      ],
      useFactory: (
        teams: TeamRepository,
        memberships: TeamMembershipRepository,
        idempotency: IdempotencyRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
        fingerprint: NodeRequestFingerprint,
      ) =>
        new CreateTeam(
          teams,
          memberships,
          idempotency,
          audit,
          transactions,
          databaseClock,
          fingerprint,
          { create: () => randomUUID() },
        ),
    },
    {
      provide: ListMyTeams,
      inject: [TEAM_REPOSITORY],
      useFactory: (teams: TeamRepository) => new ListMyTeams(teams),
    },
    TenantContextGuard,
  ],
  exports: [ListMyTeams, TenantContextGuard],
})
export class TenancyModule {}
