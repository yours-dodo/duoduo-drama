import type { MessageSnapshot } from '../../../domain/story/message.js';
import type { StoryGenerationRequestSnapshot } from '../../../domain/story/story-generation-request.js';

export function messageOutput(message: MessageSnapshot) {
  return {
    id: message.id,
    tenantId: message.tenantId,
    conversationId: message.conversationId,
    authorType: message.authorType,
    authorUserId: message.authorUserId,
    body: message.body,
    createdAt: new Date(message.createdAt),
  };
}

export function generationRequestOutput(
  request: StoryGenerationRequestSnapshot,
) {
  return {
    id: request.id,
    tenantId: request.tenantId,
    conversationId: request.conversationId,
    triggerMessageId: request.triggerMessageId,
    status: request.status,
    createdAt: new Date(request.createdAt),
    updatedAt: new Date(request.updatedAt),
  };
}
