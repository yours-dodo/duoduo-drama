import {
  canEditProject,
  canManageProjectCollaborators,
  canViewProject,
} from '../../../domain/story/project-access-policy.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { projectOutput } from './project-output.js';
import { StoryProjectAccessDeniedError } from './story-errors.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export class ListStoryProjects {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly audit?: AuditRepository,
    private readonly databaseClock?: { now(): Promise<Date> },
    private readonly ids?: { create(): string },
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    page: { limit: number; after: { at: Date; id: string } | null };
    requestId?: string;
  }) {
    const membership = await this.memberships.findActive({
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    if (membership === null) throw new StoryProjectAccessDeniedError();

    const page = await this.projects.listVisible({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: membership.role,
      page: input.page,
    });
    if (
      membership.role === 'admin' &&
      input.requestId !== undefined &&
      this.audit !== undefined &&
      this.databaseClock !== undefined &&
      this.ids !== undefined
    ) {
      for (const project of page.items) {
        if (
          project.visibility === 'private' &&
          project.createdByUserId !== input.actorUserId
        ) {
          await this.audit.record({
            id: this.ids.create(),
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            action: 'STORY_PROJECT_PRIVATE_VIEWED',
            targetType: 'STORY_PROJECT',
            targetId: project.id,
            beforeSummary: null,
            afterSummary: { visibility: 'private' },
            requestId: input.requestId,
            occurredAt: await this.databaseClock.now(),
          });
        }
      }
    }
    return {
      items: page.items
        .filter((project) =>
          canViewProject(project, {
            userId: input.actorUserId,
            role: membership.role,
            collaborator: project.collaborator,
          }),
        )
        .map((project) =>
          projectOutput(project, {
            collaborator: project.collaborator,
            canEdit: canEditProject(project, {
              userId: input.actorUserId,
              role: membership.role,
              collaborator: project.collaborator,
            }),
            canManageCollaborators: canManageProjectCollaborators(project, {
              userId: input.actorUserId,
              role: membership.role,
              collaborator: project.collaborator,
            }),
          }),
        ),
      next: page.next,
    };
  }
}
