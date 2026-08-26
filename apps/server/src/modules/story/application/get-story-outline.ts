import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import {
  artifactOutput,
  artifactVersionOutput,
} from './story-artifact-output.js';
import { readStoryOutlineAccess } from './story-outline-access.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';
import type { StoryArtifactVersionRepository } from '../ports/story-artifact-version-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export class GetStoryOutline {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly artifacts: StoryArtifactRepository,
    private readonly versions: StoryArtifactVersionRepository,
  ) {}

  async execute(input: {
    tenantId: string | null;
    actorUserId: string;
    projectId: string;
  }) {
    const access = await readStoryOutlineAccess(
      {
        projects: this.projects,
        memberships: this.memberships,
        collaborators: this.collaborators,
        artifacts: this.artifacts,
      },
      { ...input, lock: false, permission: 'view' },
    );
    const version = access.artifact.currentVersionId
      ? await this.versions.findById({
          tenantId: access.artifact.tenantId,
          versionId: access.artifact.currentVersionId,
        })
      : null;
    return {
      artifact: artifactOutput(access.artifact),
      currentVersion:
        version && version.artifactId === access.artifact.id
          ? artifactVersionOutput(version)
          : null,
    };
  }
}
