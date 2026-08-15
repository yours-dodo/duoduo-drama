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
  const inputSnapshot = request.inputSnapshot as
    | { pipelineStage?: unknown }
    | undefined;
  return {
    id: request.id,
    tenantId: request.tenantId,
    conversationId: request.conversationId,
    triggerMessageId: request.triggerMessageId,
    status: request.status,
    failureCode: request.failureCode,
    processingStartedAt: request.processingStartedAt
      ? new Date(request.processingStartedAt)
      : null,
    completedAt: request.completedAt ? new Date(request.completedAt) : null,
    agentMessageId: request.agentMessageId,
    artifactId: request.artifactId,
    artifactVersionId: request.artifactVersionId,
    pipelineStage:
      typeof inputSnapshot?.pipelineStage === 'string'
        ? inputSnapshot.pipelineStage
        : null,
    createdAt: new Date(request.createdAt),
    updatedAt: new Date(request.updatedAt),
  };
}
