import { Inject, Injectable } from '@nestjs/common';

import type { StoryArtifactSnapshot } from '../../../domain/story/story-artifact.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';

interface StoryArtifactRow {
  id: string;
  tenantId: string;
  projectId: string;
  type: string;
  title: string;
  status: string;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PrismaStoryArtifactRepository implements StoryArtifactRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(artifact: StoryArtifactSnapshot): Promise<StoryArtifactSnapshot> {
    return this.database.withClient(async (client) => {
      const row = await client.storyArtifact.create({ data: artifact });
      return readArtifact(row);
    });
  }

  update(artifact: StoryArtifactSnapshot): Promise<StoryArtifactSnapshot> {
    return this.database.withClient(async (client) => {
      const row = await client.storyArtifact.update({
        where: {
          tenantId_id: {
            tenantId: artifact.tenantId,
            id: artifact.id,
          },
        },
        data: artifact,
      });
      return readArtifact(row);
    });
  }

  findById(request: {
    tenantId: string;
    artifactId: string;
  }): Promise<StoryArtifactSnapshot | null> {
    return this.database.withClient(async (client) => {
      const row = await client.storyArtifact.findUnique({
        where: {
          tenantId_id: {
            tenantId: request.tenantId,
            id: request.artifactId,
          },
        },
      });
      return row === null ? null : readArtifact(row);
    });
  }

  listForProject(request: {
    tenantId: string;
    projectId: string;
  }): Promise<StoryArtifactSnapshot[]> {
    return this.database.withClient(async (client) => {
      const rows = await client.storyArtifact.findMany({
        where: {
          tenantId: request.tenantId,
          projectId: request.projectId,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return rows.map(readArtifact);
    });
  }
}

function readArtifact(row: StoryArtifactRow): StoryArtifactSnapshot {
  if (
    row.type !== 'idea' &&
    row.type !== 'world_setting' &&
    row.type !== 'character' &&
    row.type !== 'outline' &&
    row.type !== 'script'
  ) {
    throw new Error('Database returned an invalid story artifact type');
  }
  if (row.status !== 'active' && row.status !== 'archived') {
    throw new Error('Database returned an invalid story artifact status');
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    type: row.type,
    title: row.title,
    status: row.status,
    currentVersionId: row.currentVersionId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
