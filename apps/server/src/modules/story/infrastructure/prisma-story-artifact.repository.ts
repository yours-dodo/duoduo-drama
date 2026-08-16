import { Inject, Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import type {
  StoryArtifactSnapshot,
  StoryArtifactType,
} from '../../../domain/story/story-artifact.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';

interface StoryArtifactRow {
  id: string;
  tenantId: string | null;
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
          id: artifact.id,
        },
        data: artifact,
      });
      return readArtifact(row);
    });
  }

  findById(request: {
    tenantId: string | null;
    artifactId: string;
  }): Promise<StoryArtifactSnapshot | null> {
    return this.database.withClient(async (client) => {
      const row = await client.storyArtifact.findFirst({
        where: { tenantId: request.tenantId, id: request.artifactId },
      });
      return row === null ? null : readArtifact(row);
    });
  }

  findByIdLocked(request: {
    tenantId: string | null;
    artifactId: string;
  }): Promise<StoryArtifactSnapshot | null> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<StoryArtifactRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          project_id AS "projectId",
          type,
          title,
          status,
          current_version_id AS "currentVersionId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM story_artifacts
        WHERE ${tenantScope(request.tenantId)}
          AND id = ${request.artifactId}::uuid
        FOR UPDATE
      `;
      const row = rows[0];
      return row === undefined ? null : readArtifact(row);
    });
  }

  findActiveForProjectAndTypeLocked(request: {
    tenantId: string | null;
    projectId: string;
    type: StoryArtifactType;
  }): Promise<StoryArtifactSnapshot | null> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<StoryArtifactRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          project_id AS "projectId",
          type,
          title,
          status,
          current_version_id AS "currentVersionId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM story_artifacts
        WHERE ${tenantScope(request.tenantId)}
          AND project_id = ${request.projectId}::uuid
          AND type = ${request.type}
          AND status = 'active'
        FOR UPDATE
      `;
      const row = rows[0];
      return row === undefined ? null : readArtifact(row);
    });
  }

  listForProject(request: {
    tenantId: string | null;
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

function tenantScope(tenantId: string | null) {
  return tenantId === null
    ? Prisma.sql`tenant_id IS NULL`
    : Prisma.sql`tenant_id = ${tenantId}::uuid`;
}

function readArtifact(row: StoryArtifactRow): StoryArtifactSnapshot {
  if (
    row.type !== 'outline' &&
    row.type !== 'roles' &&
    row.type !== 'worldview' &&
    row.type !== 'story'
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
