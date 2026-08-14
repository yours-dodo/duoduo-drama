import { canArchiveProject } from '../../../domain/story/project-access-policy.js';
import { StoryProject } from '../../../domain/story/story-project.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import {
  readProjectAccess,
  requireProjectView,
} from './project-authorization.js';
import { projectOutput } from './project-output.js';
import {
  StoryProjectAccessDeniedError,
  StoryProjectNotFoundError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';

export class ArchiveStoryProject {
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
      requireProjectView(access.project, access.subject);
      if (
        access.project.status === 'active' &&
        !canArchiveProject(access.project, access.subject)
      ) {
        throw new StoryProjectNotFoundError();
      }
      if (access.project.status === 'archived') {
        return { project: projectOutput(access.project, accessOutput(access)) };
      }

      const project = StoryProject.restore(access.project);
      const now = await this.databaseClock.now();
      if (!project.archive(input.expectedRevision, now)) {
        return { project: projectOutput(access.project, accessOutput(access)) };
      }
      const archived = project.toSnapshot();
      await this.projects.update(archived);
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        spaceId: archived.spaceId,
        actorUserId: input.actorUserId,
        action: 'STORY_PROJECT_ARCHIVED',
        targetType: 'STORY_PROJECT',
        targetId: archived.id,
        beforeSummary: { status: 'active', revision: access.project.revision },
        afterSummary: { status: 'archived', revision: archived.revision },
        requestId: input.requestId,
        occurredAt: now,
      });
      return { project: projectOutput(archived, accessOutput(access)) };
    });
  }
}

function accessOutput(access: {
    project: { visibility: 'team' | 'private'; ownerUserId: string };
    subject: {
      collaborator: boolean;
      collaboratorRole?: string | null;
      role: 'admin' | 'member' | null;
    userId: string;
  };
}) {
  return {
    collaborator: access.subject.collaborator,
    collaboratorRole: access.subject.collaboratorRole ?? null,
    canEdit: false,
    canManageCollaborators:
      access.project.visibility === 'team' &&
      (access.subject.role === 'admin' ||
        access.project.ownerUserId === access.subject.userId),
  };
}
