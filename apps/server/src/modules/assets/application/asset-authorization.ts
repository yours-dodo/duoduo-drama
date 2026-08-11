import type { ProjectCollaboratorRepository } from '../../story/ports/project-collaborator-repository.js';
import {
  readProjectAccess,
  requireProjectEdit,
  requireProjectView,
} from '../../story/application/project-authorization.js';
import type { StoryProjectRepository } from '../../story/ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { StoryProjectAccessDeniedError } from '../../story/application/story-errors.js';

export async function requireAssetProjectEdit(input: {
  tenantId: string;
  actorUserId: string;
  projectId: string;
  projects: StoryProjectRepository;
  memberships: TeamMembershipRepository;
  collaborators: ProjectCollaboratorRepository;
}) {
  const access = await readAssetProjectAccess(input);
  requireProjectEdit(access.project, access.subject);
  return access;
}

export async function requireAssetProjectView(input: {
  tenantId: string;
  actorUserId: string;
  projectId: string;
  projects: StoryProjectRepository;
  memberships: TeamMembershipRepository;
  collaborators: ProjectCollaboratorRepository;
}) {
  const access = await readAssetProjectAccess(input);
  requireProjectView(access.project, access.subject);
  return access;
}

async function readAssetProjectAccess(input: {
  tenantId: string;
  actorUserId: string;
  projectId: string;
  projects: StoryProjectRepository;
  memberships: TeamMembershipRepository;
  collaborators: ProjectCollaboratorRepository;
}) {
  const membership = await input.memberships.findActive({
    tenantId: input.tenantId,
    userId: input.actorUserId,
  });
  if (membership === null) throw new StoryProjectAccessDeniedError();

  return readProjectAccess(input.projects, input.collaborators, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    membership,
    lock: false,
  });
}
