import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { artifactOutput } from './story-artifact-output.js';
import {
  readProjectAccess,
  requireProjectView,
} from './project-authorization.js';
import { StoryProjectAccessDeniedError } from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export class ListStoryArtifacts {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly artifacts: StoryArtifactRepository,
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
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
    const artifacts = await this.artifacts.listForProject({
      tenantId: input.tenantId,
      projectId: input.projectId,
    });
    return { items: artifacts.map(artifactOutput) };
  }
}
