import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';

import { AGENT_GATEWAY } from '../../integrations/agent/agent-gateway.js';
import type { AgentGateway } from '../../integrations/agent/agent-contracts.js';
import { MockAgentGateway } from '../../integrations/agent/mock-agent-gateway.js';
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
import { SpacesModule } from '../spaces/spaces.module.js';
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from '../spaces/ports/space-repository.js';
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
import { AppendStoryMessage } from './application/append-story-message.js';
import { ArchiveStoryProject } from './application/archive-story-project.js';
import { ArchiveStoryConversation } from './application/archive-story-conversation.js';
import { ConfirmStoryDraft } from './application/confirm-story-draft.js';
import { CreateStoryConversation } from './application/create-story-conversation.js';
import { CreateStoryProject } from './application/create-story-project.js';
import { DiscardStoryDraft } from './application/discard-story-draft.js';
import { EditStoryDraft } from './application/edit-story-draft.js';
import { GenerateStoryDraft } from './application/generate-story-draft.js';
import { GetStoryArtifact } from './application/get-story-artifact.js';
import { GetStoryProject } from './application/get-story-project.js';
import { ListStoryArtifacts } from './application/list-story-artifacts.js';
import { ListStoryVersions } from './application/list-story-versions.js';
import { ListProjectAuditRecords } from './application/list-project-audit-records.js';
import { ListProjectCollaborators } from './application/list-project-collaborators.js';
import { ListConversationMessages } from './application/list-conversation-messages.js';
import { ListStoryConversations } from './application/list-story-conversations.js';
import { ListStoryProjects } from './application/list-story-projects.js';
import { RemoveProjectCollaborator } from './application/remove-project-collaborator.js';
import { SetProjectCollaboratorPermissionOverride } from './application/set-project-collaborator-permission-override.js';
import { UpdateProjectCollaboratorRole } from './application/update-project-collaborator-role.js';
import { RollbackStoryArtifact } from './application/rollback-story-artifact.js';
import { RetryStoryGeneration } from './application/retry-story-generation.js';
import { UpdateStoryProject } from './application/update-story-project.js';
import { UpdateStoryConversation } from './application/update-story-conversation.js';
import { ConversationsController } from './http/conversations.controller.js';
import { GenerationRequestsController } from './http/generation-requests.controller.js';
import { MessagesController } from './http/messages.controller.js';
import { StoryArtifactsController } from './http/story-artifacts.controller.js';
import { ProjectCollaboratorsController } from './http/project-collaborators.controller.js';
import { StoryProjectsController } from './http/story-projects.controller.js';
import { MeStoryProjectsController } from './http/me-story-projects.controller.js';
import { PrismaProjectCollaboratorRepository } from './infrastructure/prisma-project-collaborator.repository.js';
import { PrismaConversationRepository } from './infrastructure/prisma-conversation.repository.js';
import { PrismaMessageRepository } from './infrastructure/prisma-message.repository.js';
import { PrismaStoryArtifactRepository } from './infrastructure/prisma-story-artifact.repository.js';
import { PrismaStoryArtifactVersionRepository } from './infrastructure/prisma-story-artifact-version.repository.js';
import { PrismaStoryProjectRepository } from './infrastructure/prisma-story-project.repository.js';
import { PrismaStoryGenerationRequestRepository } from './infrastructure/prisma-story-generation-request.repository.js';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from './ports/conversation-repository.js';
import {
  MESSAGE_REPOSITORY,
  type MessageRepository,
} from './ports/message-repository.js';
import {
  PROJECT_COLLABORATOR_REPOSITORY,
  type ProjectCollaboratorRepository,
} from './ports/project-collaborator-repository.js';
import {
  STORY_PROJECT_REPOSITORY,
  type StoryProjectRepository,
} from './ports/story-project-repository.js';
import {
  STORY_GENERATION_REQUEST_REPOSITORY,
  type StoryGenerationRequestRepository,
} from './ports/story-generation-request-repository.js';
import {
  STORY_ARTIFACT_REPOSITORY,
  type StoryArtifactRepository,
} from './ports/story-artifact-repository.js';
import {
  STORY_ARTIFACT_VERSION_REPOSITORY,
  type StoryArtifactVersionRepository,
} from './ports/story-artifact-version-repository.js';

@Module({
  imports: [DatabaseModule, AuditModule, IdentityModule, SpacesModule],
  controllers: [
    StoryProjectsController,
    MeStoryProjectsController,
    ProjectCollaboratorsController,
    ConversationsController,
    GenerationRequestsController,
    MessagesController,
    StoryArtifactsController,
  ],
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
    PrismaConversationRepository,
    {
      provide: CONVERSATION_REPOSITORY,
      useExisting: PrismaConversationRepository,
    },
    PrismaMessageRepository,
    {
      provide: MESSAGE_REPOSITORY,
      useExisting: PrismaMessageRepository,
    },
    PrismaStoryGenerationRequestRepository,
    {
      provide: STORY_GENERATION_REQUEST_REPOSITORY,
      useExisting: PrismaStoryGenerationRequestRepository,
    },
    PrismaStoryArtifactRepository,
    {
      provide: STORY_ARTIFACT_REPOSITORY,
      useExisting: PrismaStoryArtifactRepository,
    },
    PrismaStoryArtifactVersionRepository,
    {
      provide: STORY_ARTIFACT_VERSION_REPOSITORY,
      useExisting: PrismaStoryArtifactVersionRepository,
    },
    MockAgentGateway,
    {
      provide: AGENT_GATEWAY,
      useExisting: MockAgentGateway,
    },
    {
      provide: ListStoryArtifacts,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        STORY_ARTIFACT_REPOSITORY,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        artifacts: StoryArtifactRepository,
      ) =>
        new ListStoryArtifacts(projects, memberships, collaborators, artifacts),
    },
    {
      provide: GetStoryArtifact,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        STORY_ARTIFACT_REPOSITORY,
        STORY_ARTIFACT_VERSION_REPOSITORY,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        artifacts: StoryArtifactRepository,
        versions: StoryArtifactVersionRepository,
      ) =>
        new GetStoryArtifact(
          projects,
          memberships,
          collaborators,
          artifacts,
          versions,
        ),
    },
    {
      provide: ListStoryVersions,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        STORY_ARTIFACT_REPOSITORY,
        STORY_ARTIFACT_VERSION_REPOSITORY,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        artifacts: StoryArtifactRepository,
        versions: StoryArtifactVersionRepository,
      ) =>
        new ListStoryVersions(
          projects,
          memberships,
          collaborators,
          artifacts,
          versions,
        ),
    },
    {
      provide: CreateStoryProject,
      inject: [
        STORY_PROJECT_REPOSITORY,
        SPACE_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        IDEMPOTENCY_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
        NodeRequestFingerprint,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        spaces: SpaceRepository,
        memberships: TeamMembershipRepository,
        idempotency: IdempotencyRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
        fingerprint: { hash(value: string): string },
      ) =>
        new CreateStoryProject(
          projects,
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
      provide: ListStoryProjects,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        AUDIT_REPOSITORY,
        DatabaseClock,
        SPACE_REPOSITORY,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        audit: AuditRepository,
        databaseClock: DatabaseClock,
        spaces: SpaceRepository,
      ) =>
        new ListStoryProjects(
          projects,
          memberships,
          audit,
          databaseClock,
          ids(),
          spaces,
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
      provide: UpdateProjectCollaboratorRole,
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
        new UpdateProjectCollaboratorRole(
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
      provide: SetProjectCollaboratorPermissionOverride,
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
        new SetProjectCollaboratorPermissionOverride(
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
    {
      provide: CreateStoryConversation,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        CONVERSATION_REPOSITORY,
        IDEMPOTENCY_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
        NodeRequestFingerprint,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        conversations: ConversationRepository,
        idempotency: IdempotencyRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
        fingerprint: NodeRequestFingerprint,
      ) =>
        new CreateStoryConversation(
          projects,
          memberships,
          collaborators,
          conversations,
          idempotency,
          transactions,
          databaseClock,
          fingerprint,
          ids(),
        ),
    },
    {
      provide: ListStoryConversations,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        CONVERSATION_REPOSITORY,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        conversations: ConversationRepository,
      ) =>
        new ListStoryConversations(
          projects,
          memberships,
          collaborators,
          conversations,
        ),
    },
    {
      provide: UpdateStoryConversation,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        CONVERSATION_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        conversations: ConversationRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
      ) =>
        new UpdateStoryConversation(
          projects,
          memberships,
          collaborators,
          conversations,
          transactions,
          databaseClock,
        ),
    },
    {
      provide: ArchiveStoryConversation,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        CONVERSATION_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        conversations: ConversationRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
      ) =>
        new ArchiveStoryConversation(
          projects,
          memberships,
          collaborators,
          conversations,
          transactions,
          databaseClock,
        ),
    },
    {
      provide: ListConversationMessages,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        CONVERSATION_REPOSITORY,
        MESSAGE_REPOSITORY,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        conversations: ConversationRepository,
        messages: MessageRepository,
      ) =>
        new ListConversationMessages(
          projects,
          memberships,
          collaborators,
          conversations,
          messages,
        ),
    },
    {
      provide: AppendStoryMessage,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        CONVERSATION_REPOSITORY,
        MESSAGE_REPOSITORY,
        STORY_GENERATION_REQUEST_REPOSITORY,
        IDEMPOTENCY_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
        NodeRequestFingerprint,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        conversations: ConversationRepository,
        messages: MessageRepository,
        generationRequests: StoryGenerationRequestRepository,
        idempotency: IdempotencyRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
        fingerprint: NodeRequestFingerprint,
      ) =>
        new AppendStoryMessage(
          projects,
          memberships,
          collaborators,
          conversations,
          messages,
          generationRequests,
          idempotency,
          transactions,
          databaseClock,
          fingerprint,
          ids(),
        ),
    },
    {
      provide: GenerateStoryDraft,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        CONVERSATION_REPOSITORY,
        MESSAGE_REPOSITORY,
        STORY_GENERATION_REQUEST_REPOSITORY,
        STORY_ARTIFACT_REPOSITORY,
        STORY_ARTIFACT_VERSION_REPOSITORY,
        AGENT_GATEWAY,
        TransactionRunner,
        DatabaseClock,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        conversations: ConversationRepository,
        messages: MessageRepository,
        generationRequests: StoryGenerationRequestRepository,
        artifacts: StoryArtifactRepository,
        artifactVersions: StoryArtifactVersionRepository,
        gateway: AgentGateway,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
      ) =>
        new GenerateStoryDraft(
          projects,
          memberships,
          collaborators,
          conversations,
          messages,
          generationRequests,
          artifacts,
          artifactVersions,
          gateway,
          transactions,
          databaseClock,
          ids(),
        ),
    },
    {
      provide: RetryStoryGeneration,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        CONVERSATION_REPOSITORY,
        STORY_GENERATION_REQUEST_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
        GenerateStoryDraft,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        conversations: ConversationRepository,
        generationRequests: StoryGenerationRequestRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
        generate: GenerateStoryDraft,
      ) =>
        new RetryStoryGeneration(
          projects,
          memberships,
          collaborators,
          conversations,
          generationRequests,
          transactions,
          databaseClock,
          generate,
        ),
    },
    {
      provide: EditStoryDraft,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        STORY_ARTIFACT_REPOSITORY,
        STORY_ARTIFACT_VERSION_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        artifacts: StoryArtifactRepository,
        versions: StoryArtifactVersionRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
      ) =>
        new EditStoryDraft(
          projects,
          memberships,
          collaborators,
          artifacts,
          versions,
          audit,
          transactions,
          databaseClock,
          ids(),
        ),
    },
    {
      provide: DiscardStoryDraft,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        STORY_ARTIFACT_REPOSITORY,
        STORY_ARTIFACT_VERSION_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        artifacts: StoryArtifactRepository,
        versions: StoryArtifactVersionRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
      ) =>
        new DiscardStoryDraft(
          projects,
          memberships,
          collaborators,
          artifacts,
          versions,
          audit,
          transactions,
          databaseClock,
          ids(),
        ),
    },
    {
      provide: ConfirmStoryDraft,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        STORY_ARTIFACT_REPOSITORY,
        STORY_ARTIFACT_VERSION_REPOSITORY,
        IDEMPOTENCY_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
        NodeRequestFingerprint,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        artifacts: StoryArtifactRepository,
        versions: StoryArtifactVersionRepository,
        idempotency: IdempotencyRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
        fingerprint: NodeRequestFingerprint,
      ) =>
        new ConfirmStoryDraft(
          projects,
          memberships,
          collaborators,
          artifacts,
          versions,
          idempotency,
          audit,
          transactions,
          databaseClock,
          fingerprint,
          ids(),
        ),
    },
    {
      provide: RollbackStoryArtifact,
      inject: [
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        STORY_ARTIFACT_REPOSITORY,
        STORY_ARTIFACT_VERSION_REPOSITORY,
        AUDIT_REPOSITORY,
        TransactionRunner,
        DatabaseClock,
      ],
      useFactory: (
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        artifacts: StoryArtifactRepository,
        versions: StoryArtifactVersionRepository,
        audit: AuditRepository,
        transactions: TransactionRunner,
        databaseClock: DatabaseClock,
      ) =>
        new RollbackStoryArtifact(
          projects,
          memberships,
          collaborators,
          artifacts,
          versions,
          audit,
          transactions,
          databaseClock,
          ids(),
        ),
    },
  ],
  exports: [
    PROJECT_COLLABORATOR_REPOSITORY,
    STORY_PROJECT_REPOSITORY,
    TEAM_MEMBERSHIP_REPOSITORY,
    TenantContextGuard,
  ],
})
export class StoryModule {}

function ids() {
  return { create: () => randomUUID() };
}
