import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import {
  readProjectAccess,
  requireProjectEdit,
  requireProjectView,
} from './project-authorization.js';
import {
  StoryArtifactNotFoundError,
  StoryProjectAccessDeniedError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export async function readStoryOutlineAccess(
  dependencies: {
    projects: StoryProjectRepository;
    memberships: TeamMembershipRepository;
    collaborators: ProjectCollaboratorRepository;
    artifacts: StoryArtifactRepository;
  },
  input: {
    tenantId: string | null;
    actorUserId: string;
    projectId: string;
    lock: boolean;
    permission: 'view' | 'edit';
  },
) {
  const membership =
    input.tenantId === null
      ? null
      : await dependencies.memberships.findActive({
          tenantId: input.tenantId,
          userId: input.actorUserId,
        });
  if (input.tenantId !== null && membership === null) {
    throw new StoryProjectAccessDeniedError();
  }

  const access = await readProjectAccess(
    dependencies.projects,
    dependencies.collaborators,
    {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      membership,
      lock: input.lock,
    },
  );
  if (input.permission === 'edit') {
    requireProjectEdit(access.project, access.subject);
  } else {
    requireProjectView(access.project, access.subject);
  }

  const artifact = input.lock
    ? await dependencies.artifacts.findActiveForProjectAndTypeLocked({
        tenantId: access.project.tenantId,
        projectId: access.project.id,
        type: 'outline',
      })
    : ((
        await dependencies.artifacts.listForProject({
          tenantId: access.project.tenantId,
          projectId: access.project.id,
        })
      ).find(
        (candidate) =>
          candidate.type === 'outline' && candidate.status === 'active',
      ) ?? null);
  if (artifact === null) throw new StoryArtifactNotFoundError();
  return { ...access, artifact };
}
