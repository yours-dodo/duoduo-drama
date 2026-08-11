import type { ProjectCollaboratorRepository } from '../../story/ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../../story/ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import type { AssetRepository } from '../ports/asset-repository.js';
import { requireAssetProjectView } from './asset-authorization.js';
import { assetOutput } from './asset-output.js';

export class ListProjectAssets {
  constructor(
    private readonly assets: AssetRepository,
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    page: { limit: number; after: { at: Date; id: string } | null };
  }) {
    await requireAssetProjectView({
      ...input,
      projects: this.projects,
      memberships: this.memberships,
      collaborators: this.collaborators,
    });
    const page = await this.assets.listForProject(input);
    return {
      items: page.items.map(assetOutput),
      next: page.next,
    };
  }
}
