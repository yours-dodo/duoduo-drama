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
  failureCode: string | null;
  processingStartedAt: Date | null;
  completedAt: Date | null;
  agentMessageId: string | null;
  artifactId: string | null;
  artifactVersionId: string | null;
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

  findById(request: {
    tenantId: string;
    requestId: string;
  }): Promise<StoryGenerationRequestSnapshot | null> {
    return this.database.withClient(async (client) => {
      const generationRequest = await client.storyGenerationRequest.findUnique({
        where: {
          tenantId_id: {
            tenantId: request.tenantId,
            id: request.requestId,
          },
        },
      });
      return generationRequest === null
        ? null
        : readGenerationRequest(generationRequest);
    });
  }

  findByIdLocked(request: {
    tenantId: string;
    requestId: string;
  }): Promise<StoryGenerationRequestSnapshot | null> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<StoryGenerationRequestRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          conversation_id AS "conversationId",
          trigger_message_id AS "triggerMessageId",
          idempotency_key AS "idempotencyKey",
          input_snapshot AS "inputSnapshot",
          status,
          failure_code AS "failureCode",
          processing_started_at AS "processingStartedAt",
          completed_at AS "completedAt",
          agent_message_id AS "agentMessageId",
          artifact_id AS "artifactId",
          artifact_version_id AS "artifactVersionId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM story_generation_requests
        WHERE tenant_id = ${request.tenantId}::uuid
          AND id = ${request.requestId}::uuid
        FOR UPDATE
      `;
      const row = rows[0];
      return row === undefined ? null : readGenerationRequest(row);
    });
  }

  update(
    request: StoryGenerationRequestSnapshot,
  ): Promise<StoryGenerationRequestSnapshot> {
    return this.database.withClient(async (client) => {
      const row = await client.storyGenerationRequest.update({
        where: {
          tenantId_id: {
            tenantId: request.tenantId,
            id: request.id,
          },
        },
        data: {
          ...request,
          inputSnapshot: request.inputSnapshot as Prisma.InputJsonValue,
        },
      });
      return readGenerationRequest(row);
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
    failureCode: readFailureCode(row.failureCode),
    processingStartedAt: row.processingStartedAt
      ? new Date(row.processingStartedAt)
      : null,
    completedAt: row.completedAt ? new Date(row.completedAt) : null,
    agentMessageId: row.agentMessageId,
    artifactId: row.artifactId,
    artifactVersionId: row.artifactVersionId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function readFailureCode(value: string | null) {
  if (
    value !== null &&
    value !== 'agent_unavailable' &&
    value !== 'timeout' &&
    value !== 'protocol_error'
  ) {
    throw new Error(
      'Database returned an invalid story generation request failure code',
    );
  }
  return value;
}
