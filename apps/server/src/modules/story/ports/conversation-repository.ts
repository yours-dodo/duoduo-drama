import type { ConversationSnapshot } from '../../../domain/story/conversation.js';
import type {
  KeysetPage,
  KeysetPageRequest,
} from '../../../platform/pagination/keyset-page.js';

export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');

export interface ConversationRepository {
  create(conversation: ConversationSnapshot): Promise<ConversationSnapshot>;
  update(conversation: ConversationSnapshot): Promise<ConversationSnapshot>;
  findById(request: {
    tenantId: string | null;
    conversationId: string;
  }): Promise<ConversationSnapshot | null>;
  findByIdLocked(request: {
    tenantId: string | null;
    conversationId: string;
  }): Promise<ConversationSnapshot | null>;
  listForProject(request: {
    tenantId: string | null;
    projectId: string;
    page: KeysetPageRequest;
  }): Promise<KeysetPage<ConversationSnapshot>>;
}
