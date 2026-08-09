import type { MessageSnapshot } from '../../../domain/story/message.js';
import type {
  KeysetPage,
  KeysetPageRequest,
} from '../../../platform/pagination/keyset-page.js';

export const MESSAGE_REPOSITORY = Symbol('MESSAGE_REPOSITORY');

export interface MessageRepository {
  create(message: MessageSnapshot): Promise<MessageSnapshot>;
  findById(request: {
    tenantId: string;
    messageId: string;
  }): Promise<MessageSnapshot | null>;
  listForConversation(request: {
    tenantId: string;
    conversationId: string;
    page: KeysetPageRequest;
  }): Promise<KeysetPage<MessageSnapshot>>;
}
