import {
  canEditProject,
  canArchiveProject,
  canManageProjectCollaborators,
  canRestoreProject,
  canViewProject,
} from '../../../domain/story/project-access-policy.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import type { SpaceRepository } from '../../spaces/ports/space-repository.js';
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
    private readonly spaces?: SpaceRepository,
  ) {}

  async execute(input: {
    tenantId: string | null;
    spaceId?: string;
    actorUserId: string;
    page: { limit: number; after: { at: Date; id: string } | null };
    requestId?: string;
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
    const spaceId =
      input.spaceId ??
      (input.tenantId === null
        ? (await this.spaces?.findPersonalByUserId(input.actorUserId))?.id
        : (await this.spaces?.findTeamByTeamId(input.tenantId))?.id) ??
      input.tenantId;
    if (spaceId === undefined || spaceId === null) {
      throw new StoryProjectAccessDeniedError();
    }

    const page = await this.projects.listVisible({
      tenantId: input.tenantId,
      spaceId,
      actorUserId: input.actorUserId,
      actorRole: membership?.role ?? null,
      page: input.page,
    });
    const now = this.databaseClock
      ? await this.databaseClock.now()
      : new Date();
    if (
      membership?.role === 'admin' &&
      input.tenantId !== null &&
      input.requestId !== undefined &&
      this.audit !== undefined &&
      this.databaseClock !== undefined &&
      this.ids !== undefined
    ) {
      for (const project of page.items) {
        if (
          project.visibility === 'private' &&
          project.ownerUserId !== input.actorUserId
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
            role: membership?.role ?? null,
            collaborator: project.collaborator,
            collaboratorRole: project.collaboratorRole,
            permissionOverrides: [],
          }),
        )
        .map((project) =>
          projectOutput(project, {
            collaborator: project.collaborator,
            canEdit: canEditProject(project, {
              userId: input.actorUserId,
              role: membership?.role ?? null,
              collaborator: project.collaborator,
              collaboratorRole: project.collaboratorRole,
              permissionOverrides: [],
            }),
            canManageCollaborators: canManageProjectCollaborators(project, {
              userId: input.actorUserId,
              role: membership?.role ?? null,
              collaborator: project.collaborator,
              collaboratorRole: project.collaboratorRole,
              permissionOverrides: [],
            }),
            canArchive: canArchiveProject(project, {
              userId: input.actorUserId,
              role: membership?.role ?? null,
              collaborator: project.collaborator,
              collaboratorRole: project.collaboratorRole,
              permissionOverrides: [],
            }),
            canRestore: canRestoreProject(
              project,
              {
                userId: input.actorUserId,
                role: membership?.role ?? null,
                collaborator: project.collaborator,
                collaboratorRole: project.collaboratorRole,
                permissionOverrides: [],
              },
              now,
            ),
          }),
        ),
      next: page.next,
    };
  }
}
