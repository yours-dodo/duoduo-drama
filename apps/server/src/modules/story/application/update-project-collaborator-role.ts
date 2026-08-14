import { canManageProjectCollaborators } from '../../../domain/story/project-access-policy.js';
import {
  isProjectCollaboratorRole,
  type ProjectCollaboratorRole,
} from '../../../domain/story/project-collaborator.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { readProjectAccess } from './project-authorization.js';
import {
  ProjectCollaboratorManagementRequiredError,
  ProjectCollaboratorNotFoundError,
  ProjectCollaboratorPermissionOverrideNotAllowedError,
  ProjectCollaboratorRoleInvalidError,
  ProjectCollaboratorsNotAllowedError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';

export class UpdateProjectCollaboratorRole {
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
    role: string;
    requestId: string;
  }) {
    return this.transactions.run(async () => {
      if (!isProjectCollaboratorRole(input.role)) {
        throw new ProjectCollaboratorRoleInvalidError();
      }

      const actor = await this.memberships.findActive({
        tenantId: input.tenantId,
        userId: input.actorUserId,
      });
      if (actor === null) {
        throw new ProjectCollaboratorManagementRequiredError();
      }
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

      const collaborator = await this.collaborators.findByProjectAndUserLocked({
        tenantId: input.tenantId,
        projectId: input.projectId,
        userId: input.userId,
      });
      if (collaborator === null) {
        throw new ProjectCollaboratorNotFoundError();
      }
      if (collaborator.role === input.role) {
        return { collaborator };
      }

      const updateRole = this.collaborators.updateRole;
      if (!updateRole) {
        throw new Error('Project collaborator role updates are unavailable');
      }
      const now = await this.databaseClock.now();
      const updated = await updateRole.call(this.collaborators, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        userId: input.userId,
        role: input.role as ProjectCollaboratorRole,
        updatedAt: now,
      });

      if (
        input.role === 'viewer' &&
        this.collaborators.listPermissionOverrides
      ) {
        const overrides = await this.collaborators.listPermissionOverrides({
          collaboratorId: collaborator.id,
        });
        const archiveAllow = overrides.find(
          (override) =>
            override.permissionKey === 'project.archive' &&
            override.effect === 'allow',
        );
        if (archiveAllow) {
          if (!this.collaborators.removePermissionOverride) {
            throw new ProjectCollaboratorPermissionOverrideNotAllowedError();
          }
          await this.collaborators.removePermissionOverride({
            collaboratorId: collaborator.id,
            permissionKey: 'project.archive',
          });
        }
      }

      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'STORY_PROJECT_COLLABORATOR_ROLE_CHANGED',
        targetType: 'PROJECT_COLLABORATOR',
        targetId: collaborator.id,
        beforeSummary: { role: collaborator.role },
        afterSummary: { role: updated.role },
        requestId: input.requestId,
        occurredAt: now,
      });
      return { collaborator: updated };
    });
  }
}
