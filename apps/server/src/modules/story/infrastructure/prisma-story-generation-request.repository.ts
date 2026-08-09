import { Inject, Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import type { StoryGenerationRequestSnapshot } from '../../../domain/story/story-generation-request.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { StoryGenerationRequestRepository } from '../ports/story-generation-request-repository.js';

interface StoryGenerationRequestRow {
  id: string;
  tenantId: string;
  conversationId: string;
  triggerMessageId: string;
  idempotencyKey: string;
  inputSnapshot: Prisma.JsonValue;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PrismaStoryGenerationRequestRepository implements StoryGenerationRequestRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(
    request: StoryGenerationRequestSnapshot,
  ): Promise<StoryGenerationRequestSnapshot> {
    return this.database.withClient((client) =>
      client.storyGenerationRequest.create({
        data: {
          ...request,
          inputSnapshot: request.inputSnapshot as Prisma.InputJsonValue,
        },
      }),
    ) as Promise<StoryGenerationRequestSnapshot>;
  }

  findByTriggerMessageId(request: {
    tenantId: string;
    triggerMessageId: string;
  }): Promise<StoryGenerationRequestSnapshot | null> {
    return this.database.withClient(async (client) => {
      const generationRequest = await client.storyGenerationRequest.findUnique({
        where: {
          tenantId_triggerMessageId: {
            tenantId: request.tenantId,
            triggerMessageId: request.triggerMessageId,
          },
        },
      });
      return generationRequest === null
        ? null
        : readGenerationRequest(generationRequest);
    });
  }
}

function readGenerationRequest(
  row: StoryGenerationRequestRow,
): StoryGenerationRequestSnapshot {
  if (
    row.status !== 'pending' &&
    row.status !== 'processing' &&
    row.status !== 'succeeded' &&
    row.status !== 'failed'
  ) {
    throw new Error('Database returned an invalid generation request status');
  }
  if (
    typeof row.inputSnapshot !== 'object' ||
    row.inputSnapshot === null ||
    Array.isArray(row.inputSnapshot)
  ) {
    throw new Error('Database returned an invalid generation request snapshot');
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    triggerMessageId: row.triggerMessageId,
    idempotencyKey: row.idempotencyKey,
    inputSnapshot: row.inputSnapshot as Record<string, unknown>,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
