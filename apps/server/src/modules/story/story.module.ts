import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';

import { DatabaseClock } from '../../platform/database/database-clock.js';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { TransactionRunner } from '../../platform/database/transaction-runner.js';
import { AuditModule } from '../audit/audit.module.js';
import {
  AUDIT_QUERY_REPOSITORY,
  AUDIT_REPOSITORY,
  type AuditQueryRepository,
  type AuditRepository,
} from '../audit/ports/audit-repository.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenantContextGuard } from '../tenancy/http/tenant-context.guard.js';
import { NodeRequestFingerprint } from '../tenancy/infrastructure/node-request-fingerprint.js';
import { PrismaIdempotencyRepository } from '../tenancy/infrastructure/prisma-idempotency.repository.js';
import { PrismaTeamMembershipRepository } from '../tenancy/infrastructure/prisma-team-membership.repository.js';
import {
  IDEMPOTENCY_REPOSITORY,
  type IdempotencyRepository,
} from '../tenancy/ports/idempotency-repository.js';
import {
  TEAM_MEMBERSHIP_REPOSITORY,
  type TeamMembershipRepository,
} from '../tenancy/ports/team-membership-repository.js';
import { AddProjectCollaborator } from './application/add-project-collaborator.js';
import { ArchiveStoryProject } from './application/archive-story-project.js';
import { CreateStoryProject } from './application/create-story-project.js';
import { GetStoryProject } from './application/get-story-project.js';
import { ListProjectAuditRecords } from './application/list-project-audit-records.js';
import { ListProjectCollaborators } from './application/list-project-collaborators.js';
import { ListStoryProjects } from './application/list-story-projects.js';
import { RemoveProjectCollaborator } from './application/remove-project-collaborator.js';
import { UpdateStoryProject } from './application/update-story-project.js';
import { ProjectCollaboratorsController } from './http/project-collaborators.controller.js';
import { StoryProjectsController } from './http/story-projects.controller.js';
import { PrismaProjectCollaboratorRepository } from './infrastructure/prisma-project-collaborator.repository.js';
import { PrismaStoryProjectRepository } from './infrastructure/prisma-story-project.repository.js';
import {
  PROJECT_COLLABORATOR_REPOSITORY,
  type ProjectCollaboratorRepository,
} from './ports/project-collaborator-repository.js';
import {
  STORY_PROJECT_REPOSITORY,
  type StoryProjectRepository,
} from './ports/story-project-repository.js';

@Module({
  imports: [DatabaseModule, AuditModule, IdentityModule],
  controllers: [StoryProjectsController, ProjectCollaboratorsController],
  providers: [
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
    TenantContextGuard,
    PrismaStoryProjectRepository,
    {
      provide: STORY_PROJECT_REPOSITORY,
      useExisting: PrismaStoryProjectRepository,
    },
    PrismaProjectCollaboratorRepository,
    {
      provide: PROJECT_COLLABORATOR_REPOSITORY,
      useExisting: PrismaProjectCollaboratorRepository,
    },
    {
      provide: CreateStoryProject,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        IDEMPOTENCY_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
        NodeRequestFingerprint,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        idempotency: IdempotencyRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
        fingerprint: { hash(value: string): string },
      ) =>
        new CreateStoryProject(
          projects,
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
      provide: ListStoryProjects,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        AUDIT_REPOSITORY,
        DatabaseClock,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        audit: AuditRepository,
        databaseClock: DatabaseClock,
      ) =>
        new ListStoryProjects(
          projects,
          memberships,
          audit,
          databaseClock,
          ids(),
        ),
    },
    {
      provide: GetStoryProject,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        AUDIT_REPOSITORY,
        DatabaseClock,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        audit: AuditRepository,
        databaseClock: DatabaseClock,
      ) =>
        new GetStoryProject(
          projects,
          memberships,
          collaborators,
          audit,
          databaseClock,
          ids(),
        ),
    },
    {
      provide: UpdateStoryProject,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
      ) =>
        new UpdateStoryProject(
          projects,
          memberships,
          collaborators,
          audit,
          transactions,
          databaseClock,
          ids(),
        ),
    },
    {
      provide: ArchiveStoryProject,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
      ) =>
        new ArchiveStoryProject(
          projects,
          memberships,
          collaborators,
          audit,
          transactions,
          databaseClock,
          ids(),
        ),
    },
    {
      provide: AddProjectCollaborator,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
      ) =>
        new AddProjectCollaborator(
          projects,
          memberships,
          collaborators,
          audit,
          transactions,
          databaseClock,
          ids(),
        ),
    },
    {
      provide: RemoveProjectCollaborator,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
      ) =>
        new RemoveProjectCollaborator(
          projects,
          memberships,
          collaborators,
          audit,
          transactions,
          databaseClock,
          ids(),
        ),
    },
    {
      provide: ListProjectCollaborators,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
      ) => new ListProjectCollaborators(projects, memberships, collaborators),
    },
    {
      provide: ListProjectAuditRecords,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        AUDIT_QUERY_REPOSITORY,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        audit: AuditQueryRepository,
      ) => new ListProjectAuditRecords(projects, memberships, audit),
    },
  ],
})
export class StoryModule {}

function ids() {
  return { create: () => randomUUID() };
}
