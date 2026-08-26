import {
  canArchiveProject,
  canEditProject,
  canManageProjectCollaborators,
  canRestoreProject,
} from '../../../domain/story/project-access-policy.js';
import { StoryProject } from '../../../domain/story/story-project.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import {
  readProjectAccess,
  requireProjectView,
} from './project-authorization.js';
import { projectOutput } from './project-output.js';
import {
  StoryProjectAccessDeniedError,
  StoryProjectNotFoundError,
  StoryProjectPurgeUnavailableError,
} from './story-errors.js';

export class RestoreStoryProject {
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

      const now = await this.databaseClock.now();
      if (access.project.status === 'active') {
        return {
          project: projectOutput(access.project, {
            collaborator: access.subject.collaborator,
            collaboratorRole: access.subject.collaboratorRole ?? null,
            canEdit: canEditProject(access.project, access.subject),
            canManageCollaborators: canManageProjectCollaborators(
              access.project,
              access.subject,
            ),
            canArchive: canArchiveProject(access.project, access.subject),
            canRestore: false,
          }),
        };
      }
      if (!canRestoreProject(access.project, access.subject, now)) {
        if (
          access.project.purgeStartedAt !== null ||
          (access.project.purgeAt !== null && access.project.purgeAt <= now)
        ) {
          throw new StoryProjectPurgeUnavailableError();
        }
        throw new StoryProjectNotFoundError();
      }

      const project = StoryProject.restore(access.project);
      project.restoreFromArchive(input.expectedRevision, now);
      const restored = project.toSnapshot();
      await this.projects.update(restored);
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        spaceId: restored.spaceId,
        actorUserId: input.actorUserId,
        action: 'STORY_PROJECT_RESTORED',
        targetType: 'STORY_PROJECT',
        targetId: restored.id,
        beforeSummary: {
          status: 'archived',
          revision: access.project.revision,
        },
        afterSummary: { status: 'active', revision: restored.revision },
        requestId: input.requestId,
        occurredAt: now,
      });
      return {
        project: projectOutput(restored, {
          collaborator: access.subject.collaborator,
          collaboratorRole: access.subject.collaboratorRole ?? null,
          canEdit: canEditProject(restored, access.subject),
          canManageCollaborators: canManageProjectCollaborators(
            restored,
            access.subject,
          ),
          canArchive: canArchiveProject(restored, access.subject),
          canRestore: false,
        }),
      };
    });
  }
}
