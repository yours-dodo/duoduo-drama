import {
  readProjectAccess,
  requireProjectEdit,
  requireProjectView,
} from './project-authorization.js';
import {
  ConversationNotFoundError,
  StoryProjectArchivedError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type { TeamMembershipSnapshot } from '../../../domain/tenancy/team-membership.js';

export async function readConversationAccess(
  projects: StoryProjectRepository,
  collaborators: ProjectCollaboratorRepository,
  conversations: ConversationRepository,
  input: {
    tenantId: string;
    projectId: string;
    conversationId: string;
    membership: TeamMembershipSnapshot;
    lock: boolean;
  },
) {
  const projectAccess = await readProjectAccess(projects, collaborators, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    membership: input.membership,
    lock: input.lock,
  });
  const conversation = input.lock
    ? await conversations.findByIdLocked({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
      })
    : await conversations.findById({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
      });
  if (conversation === null || conversation.projectId !== input.projectId) {
    throw new ConversationNotFoundError();
  }
  return { ...projectAccess, conversation };
}

export function requireConversationView(access: {
  project: Parameters<typeof requireProjectView>[0];
  subject: Parameters<typeof requireProjectView>[1];
}): void {
  requireProjectView(access.project, access.subject);
}

export function requireConversationEdit(access: {
  project: Parameters<typeof requireProjectEdit>[0];
  subject: Parameters<typeof requireProjectEdit>[1];
}): void {
  if (access.project.status === 'archived') {
    throw new StoryProjectArchivedError();
  }
  requireProjectEdit(access.project, access.subject);
}
