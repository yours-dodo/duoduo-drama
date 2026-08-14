import type { KeysetPageRequest } from '../../../platform/pagination/keyset-page.js';
import { canViewProject } from '../../../domain/story/project-access-policy.js';
import type { AuditQueryRepository } from '../../audit/ports/audit-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { StoryProjectNotFoundError } from './story-errors.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export class ListProjectAuditRecords {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly audit: AuditQueryRepository,
  ) {}

  async execute(input: {
    tenantId: string | null;
    actorUserId: string;
    projectId: string;
    page: KeysetPageRequest;
  }) {
    const membership =
      input.tenantId === null
        ? null
        : await this.memberships.findActive({
            tenantId: input.tenantId,
            userId: input.actorUserId,
          });
    const project = await this.projects.findById({
      tenantId: input.tenantId,
      projectId: input.projectId,
    });
    if (
      membership === null ||
      project === null ||
      !canViewProject(project, {
        userId: input.actorUserId,
        role: membership?.role ?? null,
        collaborator: false,
      }) ||
      (membership?.role !== 'admin' && project.ownerUserId !== input.actorUserId)
    ) {
      throw new StoryProjectNotFoundError();
    }
    return this.audit.listForTarget({
      tenantId: input.tenantId,
      spaceId: project.spaceId,
      targetType: 'STORY_PROJECT',
      targetId: input.projectId,
      page: input.page,
    });
  }
}
