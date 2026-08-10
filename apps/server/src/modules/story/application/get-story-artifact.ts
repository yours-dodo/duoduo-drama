import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import {
  artifactOutput,
  artifactVersionOutput,
} from './story-artifact-output.js';
import {
  readArtifactAccess,
  requireArtifactView,
} from './artifact-authorization.js';
import {
  StoryProjectAccessDeniedError,
  StoryArtifactVersionNotFoundError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';
import type { StoryArtifactVersionRepository } from '../ports/story-artifact-version-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export class GetStoryArtifact {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly artifacts: StoryArtifactRepository,
    private readonly versions: StoryArtifactVersionRepository,
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    artifactId: string;
  }) {
    const membership = await this.memberships.findActive({
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    if (membership === null) throw new StoryProjectAccessDeniedError();
    const access = await readArtifactAccess(
      this.projects,
      this.collaborators,
      this.artifacts,
      { ...input, membership, lock: false },
    );
    requireArtifactView(access);
    const version = access.artifact.currentVersionId
      ? await this.versions.findById({
          tenantId: input.tenantId,
          versionId: access.artifact.currentVersionId,
        })
      : null;
    if (
      access.artifact.currentVersionId !== null &&
      (version === null || version.artifactId !== access.artifact.id)
    ) {
      throw new StoryArtifactVersionNotFoundError();
    }
    return {
      artifact: artifactOutput(access.artifact),
      currentVersion: version ? artifactVersionOutput(version) : null,
    };
  }
}
