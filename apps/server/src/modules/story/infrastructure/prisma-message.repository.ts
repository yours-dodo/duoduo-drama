import { Inject, Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import type { MessageSnapshot } from '../../../domain/story/message.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { MessageRepository } from '../ports/message-repository.js';

interface MessageRow {
  id: string;
  tenantId: string;
  conversationId: string;
  authorType: string;
  authorUserId: string | null;
  body: string;
  createdAt: Date;
}

@Injectable()
export class PrismaMessageRepository implements MessageRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(message: MessageSnapshot): Promise<MessageSnapshot> {
    return this.database.withClient((client) =>
      client.message.create({ data: message }),
    ) as Promise<MessageSnapshot>;
  }

  findById(request: {
    tenantId: string;
    messageId: string;
  }): Promise<MessageSnapshot | null> {
    return this.database.withClient(async (client) => {
      const message = await client.message.findUnique({
        where: {
          tenantId_id: {
            tenantId: request.tenantId,
            id: request.messageId,
          },
        },
      });
      return message === null ? null : readMessage(message);
    });
  }

  listForConversation(request: {
    tenantId: string;
    conversationId: string;
    page: { limit: number; after: { at: Date; id: string } | null };
  }) {
    return this.database.withClient(async (client) => {
      const after = request.page.after
        ? Prisma.sql`AND (message.created_at, message.id) < (${request.page.after.at}, ${request.page.after.id}::uuid)`
        : Prisma.empty;
      const rows = await client.$queryRaw<MessageRow[]>`
        SELECT
          message.id,
          message.tenant_id AS "tenantId",
          message.conversation_id AS "conversationId",
          message.author_type AS "authorType",
          message.author_user_id AS "authorUserId",
          message.body,
          message.created_at AS "createdAt"
        FROM messages AS message
        WHERE message.tenant_id = ${request.tenantId}::uuid
          AND message.conversation_id = ${request.conversationId}::uuid
          ${after}
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT ${request.page.limit + 1}
      `;
      const selected = rows.slice(0, request.page.limit);
      const last = selected.at(-1);
      return {
        items: selected.map(readMessage),
        next:
          rows.length > request.page.limit && last
            ? { at: new Date(last.createdAt), id: last.id }
            : null,
      };
    });
  }
}

function readMessage(row: MessageRow): MessageSnapshot {
  if (
    row.authorType !== 'user' &&
    row.authorType !== 'agent' &&
    row.authorType !== 'system'
  ) {
    throw new Error('Database returned an invalid message author type');
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    authorType: row.authorType,
    authorUserId: row.authorUserId,
    body: row.body,
    createdAt: new Date(row.createdAt),
  };
}
