import {
  StoryProject,
  type StoryProjectEra,
} from '../../../domain/story/story-project.js';
import {
  canArchiveProject,
  canRestoreProject,
} from '../../../domain/story/project-access-policy.js';
import type { ProjectCollaboratorRole } from '../../../domain/story/project-collaborator.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { projectOutput } from './project-output.js';
import {
  readProjectAccess,
  requireProjectEdit,
} from './project-authorization.js';
import {
  StoryProjectAccessDeniedError,
  StoryProjectSpaceMoveRequiredError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';

export class UpdateStoryProject {
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
    tenantId: string | null;
    actorUserId: string;
    projectId: string;
    title?: string;
    description?: string;
    era?: StoryProjectEra;
    tags?: string[];
    visibility?: 'team' | 'private';
    expectedRevision: number;
    requestId: string;
  }) {
    return this.transactions.run(async () => {
      const membership =
        input.tenantId === null
          ? null
          : await this.memberships.findActive({
              tenantId: input.tenantId,
              userId: input.actorUserId,
            });
      if (input.tenantId !== null && membership === null) {
        throw new StoryProjectAccessDeniedError();
      }
      const access = await readProjectAccess(
        this.projects,
        this.collaborators,
        {
          tenantId: input.tenantId,
          projectId: input.projectId,
          actorUserId: input.actorUserId,
          membership,
          lock: true,
        },
      );
      requireProjectEdit(access.project, access.subject);

      const before = access.project;
      if (
        input.visibility !== undefined &&
        input.visibility !== before.visibility
      ) {
        throw new StoryProjectSpaceMoveRequiredError();
      }
      const project = StoryProject.restore(before);
      const now = await this.databaseClock.now();
      const changed = project.update(
        {
          title: input.title,
          description: input.description,
          era: input.era,
          tags: input.tags,
          visibility: input.visibility,
        },
        input.expectedRevision,
        now,
      );
      if (!changed)
        return { project: projectOutput(before, accessOutput(access)) };

      const updated = project.toSnapshot();
      if (
        before.visibility === 'team' &&
        updated.visibility === 'private' &&
        input.tenantId !== null
      ) {
        await this.collaborators.removeAll({
          tenantId: input.tenantId,
          projectId: input.projectId,
          revokedAt: now,
        });
      }
      await this.projects.update(updated);
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        spaceId: updated.spaceId,
        actorUserId: input.actorUserId,
        action:
          before.visibility !== updated.visibility
            ? 'STORY_PROJECT_VISIBILITY_CHANGED'
            : 'STORY_PROJECT_UPDATED',
        targetType: 'STORY_PROJECT',
        targetId: updated.id,
        beforeSummary: {
          title: before.title,
          description: before.description ?? '',
          era: before.era ?? '现代',
          tags: before.tags ?? [],
          visibility: before.visibility,
          revision: before.revision,
        },
        afterSummary: {
          title: updated.title,
          description: updated.description ?? '',
          era: updated.era ?? '现代',
          tags: updated.tags ?? [],
          visibility: updated.visibility,
          revision: updated.revision,
        },
        requestId: input.requestId,
        occurredAt: now,
      });

      return {
        project: projectOutput(updated, {
          collaborator: false,
          collaboratorRole: null,
          canEdit: true,
          canManageCollaborators: updated.visibility === 'team',
          canArchive: canArchiveProject(updated, access.subject),
          canRestore: canRestoreProject(updated, access.subject, now),
        }),
      };
    });
  }
}

function accessOutput(access: {
  project: {
    visibility: 'team' | 'private';
    ownerUserId: string;
    status: 'active' | 'archived';
    purgeAt?: Date | null;
    purgeStartedAt?: Date | null;
  };
  subject: {
    collaborator: boolean;
    collaboratorRole?: ProjectCollaboratorRole | null;
    role: 'admin' | 'member' | null;
    userId: string;
  };
}) {
  const owner = access.project;
  return {
    collaborator: access.subject.collaborator,
    collaboratorRole: access.subject.collaboratorRole ?? null,
    canEdit: true,
    canManageCollaborators:
      owner.visibility === 'team' &&
      (access.subject.role === 'admin' ||
        owner.ownerUserId === access.subject.userId),
    canArchive: canArchiveProject(access.project, access.subject),
    canRestore: canRestoreProject(access.project, access.subject),
  };
}
