import { Message } from '../../../domain/story/message.js';
import { StoryGenerationRequest } from '../../../domain/story/story-generation-request.js';
import type { IdempotencyRepository } from '../../tenancy/ports/idempotency-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { IdempotencyConflictError } from '../../tenancy/application/create-team.js';
import { generationRequestOutput, messageOutput } from './message-output.js';
import {
  readConversationAccess,
  requireConversationEdit,
} from './conversation-authorization.js';
import {
  ConversationArchivedError,
  StoryProjectAccessDeniedError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { MessageRepository } from '../ports/message-repository.js';
import type { StoryGenerationRequestRepository } from '../ports/story-generation-request-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

const OPERATION_TYPE = 'APPEND_STORY_MESSAGE';

export class AppendStoryMessage {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly generationRequests: StoryGenerationRequestRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly fingerprint: { hash(value: string): string },
    private readonly ids: { create(): string },
  ) {}

  execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    conversationId: string;
    body: string;
    idempotencyKey: string;
  }) {
    const normalizedBody = input.body.trim();
    const requestHash = this.fingerprint.hash(normalizedBody);
    const scopeKey = `tenant:${input.tenantId}:user:${input.actorUserId}:conversation:${input.conversationId}`;

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

      const existing = await this.idempotency.findLocked({
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
      });
      if (existing !== null) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }
        const message = await this.messages.findById({
          tenantId: input.tenantId,
          messageId: existing.resultId,
        });
        const generationRequest = message
          ? await this.generationRequests.findByTriggerMessageId({
              tenantId: input.tenantId,
              triggerMessageId: message.id,
            })
          : null;
        if (message === null || generationRequest === null) {
          throw new Error('Idempotency result message is unavailable');
        }
        return {
          message: messageOutput(message),
          generationRequest: generationRequestOutput(generationRequest),
        };
      }

      const now = await this.databaseClock.now();
      const message = Message.create({
        id: this.ids.create(),
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        authorType: 'user',
        authorUserId: input.actorUserId,
        body: input.body,
        createdAt: now,
      }).toSnapshot();
      const generationRequest = StoryGenerationRequest.createPending({
        id: this.ids.create(),
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        triggerMessageId: message.id,
        idempotencyKey: input.idempotencyKey,
        inputSnapshot: { body: message.body },
        createdAt: now,
      }).toSnapshot();
      await this.messages.create(message);
      await this.generationRequests.create(generationRequest);
      await this.idempotency.create({
        id: this.ids.create(),
        tenantId: input.tenantId,
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        resultId: message.id,
        createdAt: now,
      });
      return {
        message: messageOutput(message),
        generationRequest: generationRequestOutput(generationRequest),
      };
    });
  }
}
