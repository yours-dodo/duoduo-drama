import { canManageProjectCollaborators } from '../../../domain/story/project-access-policy.js';
import type { ProjectCollaboratorRole } from '../../../domain/story/project-collaborator.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import {
  ProjectCollaboratorAlreadyExistsError,
  ProjectCollaboratorManagementRequiredError,
  ProjectCollaboratorTargetIsCreatorError,
  ProjectCollaboratorTargetNotFoundError,
  ProjectCollaboratorsNotAllowedError,
} from './story-errors.js';
import { readProjectAccess } from './project-authorization.js';
import type {
  ProjectCollaboratorRepository,
  ProjectCollaboratorSnapshot,
} from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';

export class AddProjectCollaborator {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly audit: AuditRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly ids: { create(): string },
  ) {}

  execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    userId: string;
    role?: ProjectCollaboratorRole;
    requestId: string;
  }) {
    return this.transactions.run(async () => {
      const actor = await this.memberships.findActive({
        tenantId: input.tenantId,
        userId: input.actorUserId,
      });
      if (actor === null)
        throw new ProjectCollaboratorManagementRequiredError();
      const access = await readProjectAccess(
        this.projects,
        this.collaborators,
        {
          tenantId: input.tenantId,
          projectId: input.projectId,
          membership: actor,
          lock: true,
        },
      );
      if (!canManageProjectCollaborators(access.project, access.subject)) {
        if (
          access.project.visibility === 'private' ||
          access.project.spaceKind === 'personal' ||
          access.project.status === 'archived'
        ) {
          throw new ProjectCollaboratorsNotAllowedError();
        }
        throw new ProjectCollaboratorManagementRequiredError();
      }
      if (input.userId === access.project.ownerUserId) {
        throw new ProjectCollaboratorTargetIsCreatorError();
      }
      const target = await this.memberships.findActive({
        tenantId: input.tenantId,
        userId: input.userId,
      });
      if (target === null) throw new ProjectCollaboratorTargetNotFoundError();
      const existing = await this.collaborators.findByProjectAndUserLocked({
        tenantId: input.tenantId,
        projectId: input.projectId,
        userId: input.userId,
      });
      if (existing !== null) throw new ProjectCollaboratorAlreadyExistsError();

      const now = await this.databaseClock.now();
      const collaborator: ProjectCollaboratorSnapshot = {
        id: this.ids.create(),
        tenantId: input.tenantId,
        projectId: input.projectId,
        userId: input.userId,
        role: input.role ?? 'editor',
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      };
      await this.collaborators.create(collaborator);
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'STORY_PROJECT_COLLABORATOR_ADDED',
        targetType: 'PROJECT_COLLABORATOR',
        targetId: collaborator.id,
        beforeSummary: null,
        afterSummary: {
          projectId: collaborator.projectId,
          userId: collaborator.userId,
          role: collaborator.role,
        },
        requestId: input.requestId,
        occurredAt: now,
      });
      return { collaborator };
    });
  }
}
