import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { conversationOutput } from './conversation-output.js';
import {
  readProjectAccess,
  requireProjectView,
} from './project-authorization.js';
import { StoryProjectAccessDeniedError } from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export class ListStoryConversations {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly conversations: ConversationRepository,
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    page: { limit: number; after: { at: Date; id: string } | null };
  }) {
    const membership = await this.memberships.findActive({
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    if (membership === null) throw new StoryProjectAccessDeniedError();
    const access = await readProjectAccess(this.projects, this.collaborators, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      membership,
      lock: false,
    });
    requireProjectView(access.project, access.subject);
    const page = await this.conversations.listForProject({
      tenantId: input.tenantId,
      projectId: input.projectId,
      page: input.page,
    });
    return {
      items: page.items.map(conversationOutput),
      next: page.next,
    };
  }
}
