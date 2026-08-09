import {
  canEditProject,
  canManageProjectCollaborators,
  canViewProject,
  type ProjectAccessSubject,
} from '../../../domain/story/project-access-policy.js';
import type { StoryProjectSnapshot } from '../../../domain/story/story-project.js';
import type { TeamMembershipSnapshot } from '../../../domain/tenancy/team-membership.js';
import {
  ProjectCollaboratorManagementRequiredError,
  StoryProjectNotFoundError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export async function readProjectAccess(
  projects: StoryProjectRepository,
  collaborators: ProjectCollaboratorRepository,
  input: {
    tenantId: string;
    projectId: string;
    membership: TeamMembershipSnapshot;
    lock: boolean;
  },
): Promise<{
  project: StoryProjectSnapshot;
  subject: ProjectAccessSubject;
}> {
  const project = input.lock
    ? await projects.findByIdLocked({
        tenantId: input.tenantId,
        projectId: input.projectId,
      })
    : await projects.findById({
        tenantId: input.tenantId,
        projectId: input.projectId,
      });
  if (project === null) throw new StoryProjectNotFoundError();

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
}

export function requireProjectView(
  project: StoryProjectSnapshot,
  subject: ProjectAccessSubject,
): void {
  if (!canViewProject(project, subject)) {
    throw new StoryProjectNotFoundError();
  }
}

export function requireProjectEdit(
  project: StoryProjectSnapshot,
  subject: ProjectAccessSubject,
): void {
  if (!canEditProject(project, subject)) {
    throw new StoryProjectNotFoundError();
  }
}

export function requireCollaboratorManagement(
  project: StoryProjectSnapshot,
  subject: ProjectAccessSubject,
): void {
  if (!canManageProjectCollaborators(project, subject)) {
    if (!canViewProject(project, subject)) {
      throw new StoryProjectNotFoundError();
    }
    throw new ProjectCollaboratorManagementRequiredError();
  }
}
