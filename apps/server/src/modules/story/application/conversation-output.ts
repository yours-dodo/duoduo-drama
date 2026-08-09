import type { ConversationSnapshot } from '../../../domain/story/conversation.js';

export function conversationOutput(conversation: ConversationSnapshot) {
  return {
    id: conversation.id,
    tenantId: conversation.tenantId,
    projectId: conversation.projectId,
    title: conversation.title,
    status: conversation.status,
    revision: conversation.revision,
    createdAt: new Date(conversation.createdAt),
    updatedAt: new Date(conversation.updatedAt),
  };
}
