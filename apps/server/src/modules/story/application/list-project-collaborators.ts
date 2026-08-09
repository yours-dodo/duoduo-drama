import type { KeysetPageRequest } from '../../../platform/pagination/keyset-page.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import {
  readProjectAccess,
  requireProjectView,
} from './project-authorization.js';
import { StoryProjectAccessDeniedError } from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export class ListProjectCollaborators {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    page: KeysetPageRequest;
  }) {
    const membership = await this.memberships.findActive({
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    if (membership === null) {
      throw new StoryProjectAccessDeniedError();
    }
    const access = await readProjectAccess(this.projects, this.collaborators, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      membership,
      lock: false,
    });
    requireProjectView(access.project, access.subject);
    return this.collaborators.listForProject({
      tenantId: input.tenantId,
      projectId: input.projectId,
      page: input.page,
    });
  }
}
