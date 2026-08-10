import {
  StoryGenerationRequest,
  type StoryGenerationRequestSnapshot,
} from '../../../domain/story/story-generation-request.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryGenerationRequestRepository } from '../ports/story-generation-request-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { GenerateStoryDraft } from './generate-story-draft.js';
import {
  readConversationAccess,
  requireConversationEdit,
} from './conversation-authorization.js';
import {
  ConversationArchivedError,
  StoryGenerationRequestNotFoundError,
  StoryProjectAccessDeniedError,
} from './story-errors.js';

export class RetryStoryGeneration {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly conversations: ConversationRepository,
    private readonly generationRequests: StoryGenerationRequestRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly generate: Pick<GenerateStoryDraft, 'execute'>,
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    conversationId: string;
    requestId: string;
  }) {
    await this.transactions.run(async () => {
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
          lock: true,
        },
      );
      requireConversationEdit(access);
      if (access.conversation.status === 'archived') {
        throw new ConversationArchivedError();
      }

      const request = await this.generationRequests.findByIdLocked({
        tenantId: input.tenantId,
        requestId: input.requestId,
      });
      assertRequestConversation(request, input.conversationId);
      if (request.status !== 'failed' && request.status !== 'processing') {
        return;
      }
      const aggregate = StoryGenerationRequest.restore(request);
      aggregate.retry(await this.databaseClock.now());
      await this.generationRequests.update(aggregate.toSnapshot());
    });

    return this.generate.execute(input);
  }
}

function assertRequestConversation(
  request: StoryGenerationRequestSnapshot | null,
  conversationId: string,
): asserts request is StoryGenerationRequestSnapshot {
  if (request === null || request.conversationId !== conversationId) {
    throw new StoryGenerationRequestNotFoundError();
  }
}
