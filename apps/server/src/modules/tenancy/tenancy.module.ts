import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';

import {
  SERVER_CONFIG,
  type ServerConfig,
} from '../../config/server-config.js';
import { DatabaseClock } from '../../platform/database/database-clock.js';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { TransactionRunner } from '../../platform/database/transaction-runner.js';
import { ListAuditRecords } from '../audit/application/list-audit-records.js';
import { AuditRecordsController } from '../audit/http/audit-records.controller.js';
import { AuditModule } from '../audit/audit.module.js';
import {
  AUDIT_QUERY_REPOSITORY,
  AUDIT_REPOSITORY,
  type AuditQueryRepository,
  type AuditRepository,
} from '../audit/ports/audit-repository.js';
import { IdentityModule } from '../identity/identity.module.js';
import { SpacesModule } from '../spaces/spaces.module.js';
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from '../spaces/ports/space-repository.js';
import { AcceptTeamInvitation } from './application/accept-team-invitation.js';
import { ChangeTeamMemberRole } from './application/change-team-member-role.js';
import { CreateTeamInvitation } from './application/create-team-invitation.js';
import { CreateTeam } from './application/create-team.js';
import { ListMyTeams } from './application/list-my-teams.js';
import { ListTeamInvitations } from './application/list-team-invitations.js';
import { ListTeamMembers } from './application/list-team-members.js';
import { RemoveTeamMember } from './application/remove-team-member.js';
import { RevokeTeamInvitation } from './application/revoke-team-invitation.js';
import { MeController } from './http/me.controller.js';
import { TeamInvitationAcceptancesController } from './http/team-invitation-acceptances.controller.js';
import { TeamInvitationsController } from './http/team-invitations.controller.js';
import { TeamMembersController } from './http/team-members.controller.js';
import { TeamsController } from './http/teams.controller.js';
import { TenantContextGuard } from './http/tenant-context.guard.js';
import { LocalTeamInvitationDelivery } from './infrastructure/local-team-invitation-delivery.js';
import { NodeRequestFingerprint } from './infrastructure/node-request-fingerprint.js';
import { NodeTeamInvitationSecurity } from './infrastructure/node-team-invitation-security.js';
import { PrismaIdempotencyRepository } from './infrastructure/prisma-idempotency.repository.js';
import { PrismaTeamInvitationRepository } from './infrastructure/prisma-team-invitation.repository.js';
import { PrismaTeamMembershipRepository } from './infrastructure/prisma-team-membership.repository.js';
import { PrismaTeamRepository } from './infrastructure/prisma-team.repository.js';
import {
  IDEMPOTENCY_REPOSITORY,
  type IdempotencyRepository,
} from './ports/idempotency-repository.js';
import {
  TEAM_INVITATION_DELIVERY,
  type TeamInvitationDelivery,
} from './ports/team-invitation-delivery.js';
import {
  TEAM_INVITATION_REPOSITORY,
  type TeamInvitationRepository,
} from './ports/team-invitation-repository.js';
import {
  TEAM_INVITATION_SECURITY,
  type TeamInvitationSecurity,
} from './ports/team-invitation-security.js';
import {
  TEAM_MEMBERSHIP_REPOSITORY,
  type TeamMembershipRepository,
} from './ports/team-membership-repository.js';
import {
  TEAM_REPOSITORY,
  type TeamRepository,
} from './ports/team-repository.js';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule, SpacesModule],
  controllers: [
    TeamsController,
    MeController,
    TeamMembersController,
    TeamInvitationsController,
    TeamInvitationAcceptancesController,
    AuditRecordsController,
  ],
  providers: [
    PrismaTeamRepository,
    { provide: TEAM_REPOSITORY, useExisting: PrismaTeamRepository },
    PrismaTeamMembershipRepository,
    {
      provide: TEAM_MEMBERSHIP_REPOSITORY,
      useExisting: PrismaTeamMembershipRepository,
    },
    PrismaTeamInvitationRepository,
    {
      provide: TEAM_INVITATION_REPOSITORY,
      useExisting: PrismaTeamInvitationRepository,
    },
    PrismaIdempotencyRepository,
    {
      provide: IDEMPOTENCY_REPOSITORY,
      useExisting: PrismaIdempotencyRepository,
    },
    NodeRequestFingerprint,
    {
      provide: NodeTeamInvitationSecurity,
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) =>
        new NodeTeamInvitationSecurity(config.loginTokenPepper),
    },
    {
      provide: TEAM_INVITATION_SECURITY,
      useExisting: NodeTeamInvitationSecurity,
    },
    {
      provide: LocalTeamInvitationDelivery,
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) =>
        new LocalTeamInvitationDelivery(
          config.environment,
          config.publicWebUrl,
        ),
    },
    {
      provide: TEAM_INVITATION_DELIVERY,
      useExisting: LocalTeamInvitationDelivery,
    },
    {
      provide: CreateTeam,
      inject: [
        TEAM_REPOSITORY,
        SPACE_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        IDEMPOTENCY_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
        NodeRequestFingerprint,
      ],
      useFactory: (
        teams: TeamRepository,
        spaces: SpaceRepository,
        memberships: TeamMembershipRepository,
        idempotency: IdempotencyRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
        fingerprint: NodeRequestFingerprint,
      ) =>
        new CreateTeam(
          teams,
          spaces,
          memberships,
          idempotency,
          audit,
          transactions,
          databaseClock,
          fingerprint,
          ids(),
        ),
    },
    {
      provide: CreateTeamInvitation,
      inject: [
        TEAM_MEMBERSHIP_REPOSITORY,
        TEAM_INVITATION_REPOSITORY,
        IDEMPOTENCY_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
        NodeRequestFingerprint,
        TEAM_INVITATION_SECURITY,
        TEAM_INVITATION_DELIVERY,
      ],
      useFactory: (
        memberships: TeamMembershipRepository,
        invitations: TeamInvitationRepository,
        idempotency: IdempotencyRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
        fingerprint: NodeRequestFingerprint,
        security: TeamInvitationSecurity,
        delivery: TeamInvitationDelivery,
      ) =>
        new CreateTeamInvitation(
          memberships,
          invitations,
          idempotency,
          audit,
          transactions,
          databaseClock,
          fingerprint,
          security,
          delivery,
          ids(),
        ),
    },
    {
      provide: AcceptTeamInvitation,
      inject: [
        TEAM_INVITATION_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
        TEAM_INVITATION_SECURITY,
      ],
      useFactory: (
        invitations: TeamInvitationRepository,
        memberships: TeamMembershipRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
        security: TeamInvitationSecurity,
      ) =>
        new AcceptTeamInvitation(
          invitations,
          memberships,
          audit,
          transactions,
          databaseClock,
          security,
          ids(),
        ),
    },
    mutationProvider(ChangeTeamMemberRole, ChangeTeamMemberRole),
    mutationProvider(RemoveTeamMember, RemoveTeamMember),
    {
      provide: RevokeTeamInvitation,
      inject: [
        TEAM_MEMBERSHIP_REPOSITORY,
        TEAM_INVITATION_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
      ],
      useFactory: (
        memberships: TeamMembershipRepository,
        invitations: TeamInvitationRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
      ) =>
        new RevokeTeamInvitation(
          memberships,
          invitations,
          audit,
          transactions,
          databaseClock,
          ids(),
        ),
    },
    {
      provide: ListMyTeams,
      inject: [TEAM_REPOSITORY],
      useFactory: (teams: TeamRepository) => new ListMyTeams(teams),
    },
    {
      provide: ListTeamMembers,
      inject: [TEAM_MEMBERSHIP_REPOSITORY],
      useFactory: (memberships: TeamMembershipRepository) =>
        new ListTeamMembers(memberships),
    },
    {
      provide: ListTeamInvitations,
      inject: [
        TEAM_MEMBERSHIP_REPOSITORY,
        TEAM_INVITATION_REPOSITORY,
        DatabaseClock,
      ],
      useFactory: (
        memberships: TeamMembershipRepository,
        invitations: TeamInvitationRepository,
        databaseClock: DatabaseClock,
      ) => new ListTeamInvitations(memberships, invitations, databaseClock),
    },
    {
      provide: ListAuditRecords,
      inject: [TEAM_MEMBERSHIP_REPOSITORY, AUDIT_QUERY_REPOSITORY],
      useFactory: (
        memberships: TeamMembershipRepository,
        audit: AuditQueryRepository,
      ) => new ListAuditRecords(memberships, audit),
    },
    TenantContextGuard,
  ],
  exports: [
    ListMyTeams,
    LocalTeamInvitationDelivery,
    TenantContextGuard,
    TEAM_MEMBERSHIP_REPOSITORY,
    IDEMPOTENCY_REPOSITORY,
    NodeRequestFingerprint,
  ],
})
export class TenancyModule {}

type MemberMutation = typeof ChangeTeamMemberRole | typeof RemoveTeamMember;

function mutationProvider(
  token: MemberMutation,
  implementation: MemberMutation,
) {
  return {
    provide: token,
    inject: [
      TEAM_MEMBERSHIP_REPOSITORY,
      AUDIT_REPOSITORY,
      TransactionRunner,
      DatabaseClock,
    ],
    useFactory: (
      memberships: TeamMembershipRepository,
      audit: AuditRepository,
      transactions: TransactionRunner,
      databaseClock: DatabaseClock,
    ) =>
      new implementation(
        memberships,
        audit,
        transactions,
        databaseClock,
        ids(),
      ),
  };
}

function ids() {
  return { create: () => randomUUID() };
}
