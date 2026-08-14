import type { TeamMembershipSnapshot } from '../../../domain/tenancy/team-membership.js';
import {
  requireProjectEdit,
  requireProjectView,
  readProjectAccess,
} from './project-authorization.js';
import {
  StoryArtifactNotFoundError,
  StoryProjectNotFoundError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export async function readArtifactAccess(
  projects: StoryProjectRepository,
  collaborators: ProjectCollaboratorRepository,
  artifacts: StoryArtifactRepository,
  input: {
    tenantId: string;
    projectId: string;
    artifactId: string;
    membership: TeamMembershipSnapshot;
    lock: boolean;
  },
) {
  const projectAccess = await readProjectAccess(projects, collaborators, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    membership: input.membership,
    lock: input.lock,
  }).catch((error: unknown) => {
    if (error instanceof StoryProjectNotFoundError) {
      throw new StoryArtifactNotFoundError();
    }
    throw error;
  });
  const artifact = input.lock
    ? await artifacts.findByIdLocked({
        tenantId: input.tenantId,
        artifactId: input.artifactId,
      })
    : await artifacts.findById({
        tenantId: input.tenantId,
        artifactId: input.artifactId,
      });
  if (artifact === null || artifact.projectId !== input.projectId) {
    throw new StoryArtifactNotFoundError();
  }
  return { ...projectAccess, artifact };
}

export function requireArtifactView(access: {
  project: Parameters<typeof requireProjectView>[0];
  subject: Parameters<typeof requireProjectView>[1];
}): void {
  requireProjectView(access.project, access.subject);
}

export function requireArtifactEdit(access: {
  project: Parameters<typeof requireProjectEdit>[0];
  subject: Parameters<typeof requireProjectEdit>[1];
}): void {
  requireProjectEdit(access.project, access.subject);
}
