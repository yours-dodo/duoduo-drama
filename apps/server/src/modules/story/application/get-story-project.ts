import {
  canEditProject,
  canArchiveProject,
  canManageProjectCollaborators,
  canRestoreProject,
} from '../../../domain/story/project-access-policy.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { projectOutput } from './project-output.js';
import {
  readProjectAccess,
  requireProjectView,
} from './project-authorization.js';
import { StoryProjectAccessDeniedError } from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export class GetStoryProject {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly audit: AuditRepository,
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly ids: { create(): string },
  ) {}

  async execute(input: {
    tenantId: string | null;
    actorUserId: string;
    projectId: string;
    requestId: string;
  }) {
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
    const access = await readProjectAccess(this.projects, this.collaborators, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      membership,
      lock: false,
    });
    requireProjectView(access.project, access.subject);

    if (
      membership?.role === 'admin' &&
      input.tenantId !== null &&
      access.project.visibility === 'private' &&
      access.project.ownerUserId !== input.actorUserId
    ) {
      const now = await this.databaseClock.now();
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'STORY_PROJECT_PRIVATE_VIEWED',
        targetType: 'STORY_PROJECT',
        targetId: access.project.id,
        beforeSummary: null,
        afterSummary: { visibility: 'private' },
        requestId: input.requestId,
        occurredAt: now,
      });
    }

    const now = await this.databaseClock.now();

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
        canRestore: canRestoreProject(access.project, access.subject, now),
      }),
    };
  }
}
