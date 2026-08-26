import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { readStoryRoleProjectAccess } from './story-role-asset-access.js';
import {
  storyRoleAssetOutput,
  type StoryRoleAssetOutputDependencies,
} from './story-role-asset-output.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type { StoryRoleAssetRepository } from '../ports/story-role-asset-repository.js';

export class ListStoryRoleAssets {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly roles: StoryRoleAssetRepository,
    private readonly outputDependencies?: StoryRoleAssetOutputDependencies,
  ) {}

  async execute(input: {
    tenantId: string | null;
    actorUserId: string;
    projectId: string;
  }) {
    const access = await readStoryRoleProjectAccess(
      {
        projects: this.projects,
        memberships: this.memberships,
        collaborators: this.collaborators,
      },
      {
        ...input,
        lock: false,
        permission: 'view',
      },
    );
    const roles = await this.roles.listByProject({
      tenantId: access.project.tenantId,
      projectId: access.project.id,
    });
    return {
      items: await Promise.all(
        roles.map((role) => storyRoleAssetOutput(role, this.outputDependencies)),
      ),
    };
  }
}
