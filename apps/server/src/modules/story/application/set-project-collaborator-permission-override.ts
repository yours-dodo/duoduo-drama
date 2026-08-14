import { canManageProjectCollaborators } from '../../../domain/story/project-access-policy.js';
import {
  canSetProjectPermissionOverride,
  isProjectPermissionKey,
  type ProjectPermissionEffect,
  type ProjectPermissionKey,
} from '../../../domain/story/project-collaborator.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { readProjectAccess } from './project-authorization.js';
import {
  ProjectCollaboratorManagementRequiredError,
  ProjectCollaboratorNotFoundError,
  ProjectCollaboratorPermissionOverrideNotAllowedError,
  ProjectCollaboratorsNotAllowedError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';

export class SetProjectCollaboratorPermissionOverride {
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
    permissionKey: string;
    effect: string;
    requestId: string;
  }) {
    return this.transactions.run(async () => {
      if (
        !isProjectPermissionKey(input.permissionKey) ||
        (input.effect !== 'allow' && input.effect !== 'deny')
      ) {
        throw new ProjectCollaboratorPermissionOverrideNotAllowedError();
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
      const permissionKey = input.permissionKey as ProjectPermissionKey;
      const effect = input.effect as ProjectPermissionEffect;
      if (
        !canSetProjectPermissionOverride(
          collaborator.role,
          permissionKey,
          effect,
        )
      ) {
        throw new ProjectCollaboratorPermissionOverrideNotAllowedError();
      }
      const existingOverrides = this.collaborators.listPermissionOverrides
        ? await this.collaborators.listPermissionOverrides({
            collaboratorId: collaborator.id,
          })
        : [];
      const before = existingOverrides.find(
        (candidate) => candidate.permissionKey === permissionKey,
      );
      const upsert = this.collaborators.upsertPermissionOverride;
      if (!upsert) {
        throw new Error(
          'Project collaborator permission overrides are unavailable',
        );
      }

      const now = await this.databaseClock.now();
      const override = await upsert.call(this.collaborators, {
        id: this.ids.create(),
        collaboratorId: collaborator.id,
        permissionKey,
        effect,
        grantedByUserId: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      });
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'STORY_PROJECT_COLLABORATOR_PERMISSION_CHANGED',
        targetType: 'PROJECT_COLLABORATOR',
        targetId: collaborator.id,
        beforeSummary: before
          ? { permissionKey: before.permissionKey, effect: before.effect }
          : null,
        afterSummary: {
          permissionKey: override.permissionKey,
          effect: override.effect,
        },
        requestId: input.requestId,
        occurredAt: now,
      });
      return { override };
    });
  }
}
