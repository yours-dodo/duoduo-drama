import { Inject, Injectable } from '@nestjs/common';

import type { StoryArtifactVersionSnapshot } from '../../../domain/story/story-artifact-version.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { StoryArtifactVersionRepository } from '../ports/story-artifact-version-repository.js';

interface StoryArtifactVersionRow {
  id: string;
  tenantId: string;
  artifactId: string;
  versionNumber: number;
  content: string;
  contentFormat: string;
  status: string;
  sourceType: string;
  sourceMessageId: string | null;
  generationRequestId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}

@Injectable()
export class PrismaStoryArtifactVersionRepository implements StoryArtifactVersionRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(
    version: StoryArtifactVersionSnapshot,
  ): Promise<StoryArtifactVersionSnapshot> {
    return this.database.withClient(async (client) => {
      const row = await client.storyArtifactVersion.create({ data: version });
      return readVersion(row);
    });
  }

  findById(request: {
    tenantId: string;
    versionId: string;
  }): Promise<StoryArtifactVersionSnapshot | null> {
    return this.database.withClient(async (client) => {
      const row = await client.storyArtifactVersion.findUnique({
        where: {
          tenantId_id: {
            tenantId: request.tenantId,
            id: request.versionId,
          },
        },
      });
      return row === null ? null : readVersion(row);
    });
  }

  listForArtifact(request: {
    tenantId: string;
    artifactId: string;
  }): Promise<StoryArtifactVersionSnapshot[]> {
    return this.database.withClient(async (client) => {
      const rows = await client.storyArtifactVersion.findMany({
        where: {
          tenantId: request.tenantId,
          artifactId: request.artifactId,
        },
        orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
      });
      return rows.map(readVersion);
    });
  }
}

function readVersion(
  row: StoryArtifactVersionRow,
): StoryArtifactVersionSnapshot {
  if (row.contentFormat !== 'markdown' && row.contentFormat !== 'text') {
    throw new Error(
      'Database returned an invalid story artifact content format',
    );
  }
  if (
    row.status !== 'draft' &&
    row.status !== 'confirmed' &&
    row.status !== 'discarded'
  ) {
    throw new Error(
      'Database returned an invalid story artifact version status',
    );
  }
  if (
    row.sourceType !== 'user' &&
    row.sourceType !== 'agent' &&
    row.sourceType !== 'import'
  ) {
    throw new Error(
      'Database returned an invalid story artifact version source',
    );
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    artifactId: row.artifactId,
    versionNumber: Number(row.versionNumber),
    content: row.content,
    contentFormat: row.contentFormat,
    status: row.status,
    sourceType: row.sourceType,
    sourceMessageId: row.sourceMessageId,
    generationRequestId: row.generationRequestId,
    createdByUserId: row.createdByUserId,
    createdAt: new Date(row.createdAt),
  };
}
