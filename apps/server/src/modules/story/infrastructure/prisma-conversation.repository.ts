import { Inject, Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import type { ConversationSnapshot } from '../../../domain/story/conversation.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';

interface ConversationRow {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  status: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PrismaConversationRepository implements ConversationRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(conversation: ConversationSnapshot): Promise<ConversationSnapshot> {
    return this.database.withClient((client) =>
      client.conversation.create({ data: conversation }),
    ) as Promise<ConversationSnapshot>;
  }

  update(conversation: ConversationSnapshot): Promise<ConversationSnapshot> {
    return this.database.withClient((client) =>
      client.conversation.update({
        where: {
          tenantId_id: {
            tenantId: conversation.tenantId,
            id: conversation.id,
          },
        },
        data: conversation,
      }),
    ) as Promise<ConversationSnapshot>;
  }

  findById(request: {
    tenantId: string;
    conversationId: string;
  }): Promise<ConversationSnapshot | null> {
    return this.database.withClient(async (client) => {
      const conversation = await client.conversation.findUnique({
        where: {
          tenantId_id: {
            tenantId: request.tenantId,
            id: request.conversationId,
          },
        },
      });
      return conversation === null ? null : readConversation(conversation);
    });
  }

  findByIdLocked(request: {
    tenantId: string;
    conversationId: string;
  }): Promise<ConversationSnapshot | null> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<ConversationRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          project_id AS "projectId",
          title,
          status,
          revision,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM conversations
        WHERE tenant_id = ${request.tenantId}::uuid
          AND id = ${request.conversationId}::uuid
        FOR UPDATE
      `;
      return rows[0] === undefined ? null : readConversation(rows[0]);
    });
  }

  listForProject(request: {
    tenantId: string;
    projectId: string;
    page: { limit: number; after: { at: Date; id: string } | null };
  }) {
    return this.database.withClient(async (client) => {
      const after = request.page.after
        ? Prisma.sql`AND (conversation.created_at, conversation.id) < (${request.page.after.at}, ${request.page.after.id}::uuid)`
        : Prisma.empty;
      const rows = await client.$queryRaw<ConversationRow[]>`
        SELECT
          conversation.id,
          conversation.tenant_id AS "tenantId",
          conversation.project_id AS "projectId",
          conversation.title,
          conversation.status,
          conversation.revision,
          conversation.created_at AS "createdAt",
          conversation.updated_at AS "updatedAt"
        FROM conversations AS conversation
        WHERE conversation.tenant_id = ${request.tenantId}::uuid
          AND conversation.project_id = ${request.projectId}::uuid
          ${after}
        ORDER BY conversation.created_at DESC, conversation.id DESC
        LIMIT ${request.page.limit + 1}
      `;
      const selected = rows.slice(0, request.page.limit);
      const last = selected.at(-1);
      return {
        items: selected.map(readConversation),
        next:
          rows.length > request.page.limit && last
            ? { at: new Date(last.createdAt), id: last.id }
            : null,
      };
    });
  }
}

function readConversation(row: ConversationRow): ConversationSnapshot {
  if (row.status !== 'active' && row.status !== 'archived') {
    throw new Error('Database returned an invalid conversation status');
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    title: row.title,
    status: row.status,
    revision: Number(row.revision),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
