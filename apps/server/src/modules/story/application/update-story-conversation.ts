import { Conversation } from '../../../domain/story/conversation.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { conversationOutput } from './conversation-output.js';
import {
  readConversationAccess,
  requireConversationEdit,
} from './conversation-authorization.js';
import { StoryProjectAccessDeniedError } from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export class UpdateStoryConversation {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly conversations: ConversationRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
  ) {}

  execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    conversationId: string;
    title: string;
    expectedRevision: number;
  }) {
    return this.transactions.run(async () => {
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
          actorUserId: input.actorUserId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          membership,
          lock: true,
        },
      );
      requireConversationEdit(access);
      const conversation = Conversation.restore(access.conversation);
      const changed = conversation.rename(
        input.title,
        input.expectedRevision,
        await this.databaseClock.now(),
      );
      if (!changed) {
        return { conversation: conversationOutput(access.conversation) };
      }
      const updated = conversation.toSnapshot();
      await this.conversations.update(updated);
      return { conversation: conversationOutput(updated) };
    });
  }
}
