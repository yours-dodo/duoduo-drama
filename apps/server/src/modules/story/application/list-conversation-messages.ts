import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { messageOutput } from './message-output.js';
import {
  readConversationAccess,
  requireConversationView,
} from './conversation-authorization.js';
import { StoryProjectAccessDeniedError } from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { MessageRepository } from '../ports/message-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export class ListConversationMessages {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    conversationId: string;
    page: { limit: number; after: { at: Date; id: string } | null };
  }) {
    const membership = await this.memberships.findActive({
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    if (membership === null) throw new StoryProjectAccessDeniedError();
    const access = await readConversationAccess(
      this.projects,
      this.collaborators,
      this.conversations,
      {
        tenantId: input.tenantId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        membership,
        lock: false,
      },
    );
    requireConversationView(access);
    const page = await this.messages.listForConversation({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      page: input.page,
    });
    return { items: page.items.map(messageOutput), next: page.next };
  }
}
