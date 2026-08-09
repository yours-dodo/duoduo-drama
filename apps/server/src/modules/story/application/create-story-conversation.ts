import { Conversation } from '../../../domain/story/conversation.js';
import type { IdempotencyRepository } from '../../tenancy/ports/idempotency-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { conversationOutput } from './conversation-output.js';
import { readProjectAccess } from './project-authorization.js';
import { requireConversationEdit } from './conversation-authorization.js';
import { StoryProjectAccessDeniedError } from './story-errors.js';
import { IdempotencyConflictError } from '../../tenancy/application/create-team.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

const OPERATION_TYPE = 'CREATE_STORY_CONVERSATION';

export class CreateStoryConversation {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly conversations: ConversationRepository,
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
    title: string;
    idempotencyKey: string;
  }) {
    const normalizedTitle = input.title.trim();
    const requestHash = this.fingerprint.hash(
      JSON.stringify([input.projectId, normalizedTitle]),
    );
    const scopeKey = `tenant:${input.tenantId}:user:${input.actorUserId}:project:${input.projectId}`;

    return this.transactions.run(async () => {
      const membership = await this.memberships.findActive({
        tenantId: input.tenantId,
        userId: input.actorUserId,
      });
      if (membership === null) throw new StoryProjectAccessDeniedError();
      const access = await readProjectAccess(
        this.projects,
        this.collaborators,
        {
          tenantId: input.tenantId,
          projectId: input.projectId,
          membership,
          lock: true,
        },
      );
      requireConversationEdit(access);

      const existing = await this.idempotency.findLocked({
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
      });
      if (existing !== null) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }
        const conversation = await this.conversations.findById({
          tenantId: input.tenantId,
          conversationId: existing.resultId,
        });
        if (conversation === null) {
          throw new Error('Idempotency result conversation is unavailable');
        }
        return { conversation: conversationOutput(conversation) };
      }

      const now = await this.databaseClock.now();
      const conversation = Conversation.create({
        id: this.ids.create(),
        tenantId: input.tenantId,
        projectId: input.projectId,
        title: input.title,
        createdAt: now,
      }).toSnapshot();
      await this.conversations.create(conversation);
      await this.idempotency.create({
        id: this.ids.create(),
        tenantId: input.tenantId,
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        resultId: conversation.id,
        createdAt: now,
      });

      return { conversation: conversationOutput(conversation) };
    });
  }
}
