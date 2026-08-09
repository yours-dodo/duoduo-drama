import {
  canEditProject,
  canManageProjectCollaborators,
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
    tenantId: string;
    actorUserId: string;
    projectId: string;
    requestId: string;
  }) {
    const membership = await this.memberships.findActive({
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    if (membership === null) throw new StoryProjectAccessDeniedError();
    const access = await readProjectAccess(this.projects, this.collaborators, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      membership,
      lock: false,
    });
    requireProjectView(access.project, access.subject);

    if (
      membership.role === 'admin' &&
      access.project.visibility === 'private' &&
      access.project.createdByUserId !== input.actorUserId
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

    return {
      project: projectOutput(access.project, {
        collaborator: access.subject.collaborator,
        canEdit: canEditProject(access.project, access.subject),
        canManageCollaborators: canManageProjectCollaborators(
          access.project,
          access.subject,
        ),
      }),
    };
  }
}
