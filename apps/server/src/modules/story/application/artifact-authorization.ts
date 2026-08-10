import type { TeamMembershipSnapshot } from '../../../domain/tenancy/team-membership.js';
import {
  requireProjectEdit,
  requireProjectView,
} from './project-authorization.js';
import { StoryArtifactNotFoundError } from './story-errors.js';
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
  const projectAccess = await (async () => {
    const project = input.lock
      ? await projects.findByIdLocked({
          tenantId: input.tenantId,
          projectId: input.projectId,
        })
      : await projects.findById({
          tenantId: input.tenantId,
          projectId: input.projectId,
        });
    if (project === null) throw new StoryArtifactNotFoundError();
    const collaborator =
      project.visibility === 'team'
        ? (await collaborators.findByProjectAndUserLocked({
            tenantId: input.tenantId,
            projectId: input.projectId,
            userId: input.membership.userId,
          })) !== null
        : false;
    return {
      project,
      subject: {
        userId: input.membership.userId,
        role: input.membership.role,
        collaborator,
      },
    };
  })();
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
