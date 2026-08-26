import { Inject, Injectable } from '@nestjs/common';

import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type {
  ExpiredStoryProject,
  StoryProjectRetentionRepository,
} from '../ports/story-project-retention-repository.js';

interface ExpiredStoryProjectRow {
  id: string;
  tenantId: string | null;
  spaceId: string;
  ownerUserId: string;
  purgeAt: Date;
  objectKeys: string[] | null;
}

@Injectable()
export class PrismaStoryProjectRetentionRepository implements StoryProjectRetentionRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  claimExpired(input: {
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<ExpiredStoryProject[]> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<ExpiredStoryProjectRow[]>`
        WITH candidates AS (
          SELECT id
          FROM story_projects
          WHERE status = 'archived'
            AND purge_at <= ${input.now}
            AND (purge_started_at IS NULL OR purge_started_at < ${input.now})
          ORDER BY purge_at ASC, id ASC
          LIMIT ${input.limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE story_projects AS project
        SET purge_started_at = ${input.leaseUntil}
        FROM candidates
        WHERE project.id = candidates.id
        RETURNING
          project.id,
          project.tenant_id AS "tenantId",
          project.space_id AS "spaceId",
          project.owner_user_id AS "ownerUserId",
          project.purge_at AS "purgeAt",
          ARRAY(
            SELECT asset.object_key
            FROM assets AS asset
            WHERE asset.project_id = project.id
          ) AS "objectKeys"
      `;
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        spaceId: row.spaceId,
        ownerUserId: row.ownerUserId,
        purgeAt: new Date(row.purgeAt),
        objectKeys: row.objectKeys ?? [],
      }));
    });
  }

  purgeProject(input: { projectId: string; now: Date }): Promise<boolean> {
    return this.database.withClient(async (client) => {
      const eligible = await client.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM story_projects
        WHERE id = ${input.projectId}::uuid
          AND status = 'archived'
          AND purge_at <= ${input.now}
          AND purge_started_at IS NOT NULL
        FOR UPDATE
      `;
      if (eligible.length === 0) return false;

      await client.$executeRaw`
        UPDATE story_artifacts
        SET current_version_id = NULL
        WHERE project_id = ${input.projectId}::uuid
      `;
      await client.$executeRaw`
        UPDATE story_artifact_versions
        SET source_message_id = NULL,
            generation_request_id = NULL
        WHERE artifact_id IN (
          SELECT id FROM story_artifacts
          WHERE project_id = ${input.projectId}::uuid
        )
      `;
      await client.$executeRaw`
        DELETE FROM story_generation_requests
        WHERE conversation_id IN (
          SELECT id FROM conversations
          WHERE project_id = ${input.projectId}::uuid
        )
      `;
      await client.$executeRaw`
        DELETE FROM story_artifact_versions
        WHERE artifact_id IN (
          SELECT id FROM story_artifacts
          WHERE project_id = ${input.projectId}::uuid
        )
      `;
      await client.$executeRaw`
        DELETE FROM story_artifacts
        WHERE project_id = ${input.projectId}::uuid
      `;
      await client.$executeRaw`
        DELETE FROM story_import_jobs
        WHERE project_id = ${input.projectId}::uuid
      `;
      await client.$executeRaw`
        DELETE FROM messages
        WHERE conversation_id IN (
          SELECT id FROM conversations
          WHERE project_id = ${input.projectId}::uuid
        )
      `;
      await client.$executeRaw`
        DELETE FROM conversations
        WHERE project_id = ${input.projectId}::uuid
      `;
      await client.$executeRaw`
        UPDATE story_role_assets
        SET cover_asset_id = NULL,
            view_asset_id = NULL
        WHERE project_id = ${input.projectId}::uuid
      `;
      await client.$executeRaw`
        DELETE FROM story_role_assets
        WHERE project_id = ${input.projectId}::uuid
      `;
      await client.$executeRaw`
        DELETE FROM assets
        WHERE project_id = ${input.projectId}::uuid
      `;
      await client.$executeRaw`
        DELETE FROM project_collaborators
        WHERE project_id = ${input.projectId}::uuid
      `;
      await client.$executeRaw`
        DELETE FROM idempotency_records
        WHERE result_id = ${input.projectId}::uuid
           OR scope_key LIKE '%' || ${input.projectId} || '%'
      `;
      const deleted = await client.$executeRaw`
        DELETE FROM story_projects
        WHERE id = ${input.projectId}::uuid
      `;
      return deleted > 0;
    });
  }
}
