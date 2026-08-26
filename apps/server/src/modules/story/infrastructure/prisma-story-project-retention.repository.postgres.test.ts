import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import { PrismaService } from '../../../platform/database/prisma.service.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import { PrismaStoryProjectRetentionRepository } from './prisma-story-project-retention.repository.js';

const databaseUrl = readServerTestDatabaseUrl();
const NOW = new Date('2026-08-10T02:00:00.000Z');

describe.skipIf(!databaseUrl)(
  'story project retention PostgreSQL boundary',
  () => {
    let pool: Pool;
    let prisma: PrismaService;
    let retention: PrismaStoryProjectRetentionRepository;
    let teamId: string;
    let userId: string;
    let projectId: string;
    let conversationId: string;
    let artifactId: string;
    let assetId: string;

    beforeAll(() => {
      const connectionString = databaseUrl!;
      const config: ServerConfig = {
        environment: 'test',
        port: 3001,
        cookieSecret: 'local-test-cookie-secret-change-me',
        trustedOrigins: ['http://localhost:3000'],
        databaseUrl: connectionString,
        publicWebUrl: 'http://localhost:3000',
        loginTokenPepper: 'local-test-login-token-pepper-change-me',
        trustedProxyHops: 0,
        agentServiceUrl: 'http://127.0.0.1:3002',
      };
      pool = new Pool({ connectionString, max: 8 });
      prisma = new PrismaService(config);
      retention = new PrismaStoryProjectRetentionRepository(prisma);
    });

    beforeEach(async () => {
      await pool.query(
        'TRUNCATE TABLE "story_artifact_versions", "story_artifacts", "story_import_jobs", "assets", "story_generation_requests", "messages", "conversations", "project_collaborators", "story_role_assets", "story_projects", "idempotency_records", "team_memberships", "spaces", "teams", "identity_security_events", "sessions", "email_login_challenges", "users" CASCADE',
      );
      teamId = randomUUID();
      userId = randomUUID();
      projectId = randomUUID();
      conversationId = randomUUID();
      artifactId = randomUUID();
      assetId = randomUUID();
      await pool.query(
        'INSERT INTO users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3)',
        [userId, 'retention@example.com', NOW],
      );
      await pool.query(
        'INSERT INTO teams (id, name, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
        [teamId, 'Retention Team', userId, NOW],
      );
      await pool.query(
        'INSERT INTO spaces (id, kind, owner_team_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
        [teamId, 'team', teamId, NOW],
      );
      await pool.query(
        'INSERT INTO team_memberships (id, tenant_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), teamId, userId, 'admin', NOW],
      );
      await pool.query(
        'INSERT INTO story_projects (id, tenant_id, space_id, created_by_user_id, owner_user_id, title, visibility, status, archived_at, purge_at, purge_started_at, revision, created_at, updated_at) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, 2, $11, $11)',
        [
          projectId,
          teamId,
          teamId,
          userId,
          '待清理故事',
          'team',
          'archived',
          new Date('2026-07-01T02:00:00.000Z'),
          new Date('2026-07-31T02:00:00.000Z'),
          new Date('2026-08-11T02:00:00.000Z'),
          NOW,
        ],
      );
      await pool.query(
        'INSERT INTO assets (id, tenant_id, project_id, uploaded_by_user_id, object_key, original_file_name, content_type, byte_size, status, upload_expires_at, completed_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10, $10)',
        [
          assetId,
          teamId,
          projectId,
          userId,
          `story/${projectId}/cover.png`,
          'cover.png',
          'image/png',
          10,
          'uploaded',
          NOW,
        ],
      );
      await pool.query(
        'INSERT INTO story_role_assets (id, tenant_id, project_id, category, name, cover_asset_id, created_by_user_id, updated_by_user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $8)',
        [randomUUID(), teamId, projectId, 'core', '角色', assetId, userId, NOW],
      );
      await pool.query(
        'INSERT INTO conversations (id, tenant_id, project_id, title, status, revision, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 1, $6, $6)',
        [conversationId, teamId, projectId, '对话', 'active', NOW],
      );
      const messageId = randomUUID();
      await pool.query(
        'INSERT INTO messages (id, tenant_id, conversation_id, author_type, author_user_id, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [messageId, teamId, conversationId, 'user', userId, '内容', NOW],
      );
      const generationRequestId = randomUUID();
      await pool.query(
        'INSERT INTO story_generation_requests (id, tenant_id, conversation_id, trigger_message_id, idempotency_key, input_snapshot, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)',
        [
          generationRequestId,
          teamId,
          conversationId,
          messageId,
          'retention-key',
          '{}',
          'pending',
          NOW,
        ],
      );
      await pool.query(
        'INSERT INTO story_artifacts (id, tenant_id, project_id, type, title, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)',
        [artifactId, teamId, projectId, 'outline', '大纲', 'active', NOW],
      );
      const versionId = randomUUID();
      await pool.query(
        'INSERT INTO story_artifact_versions (id, tenant_id, artifact_id, version_number, content, content_format, status, source_type, source_message_id, generation_request_id, created_by_user_id, created_at) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11)',
        [
          versionId,
          teamId,
          artifactId,
          '大纲内容',
          'text',
          'confirmed',
          'user',
          messageId,
          generationRequestId,
          userId,
          NOW,
        ],
      );
      await pool.query(
        'UPDATE story_artifacts SET current_version_id = $1 WHERE id = $2',
        [versionId, artifactId],
      );
      await pool.query(
        'UPDATE story_generation_requests SET status = $1, completed_at = $2, agent_message_id = $3, artifact_id = $4, artifact_version_id = $5 WHERE id = $6',
        [
          'succeeded',
          NOW,
          messageId,
          artifactId,
          versionId,
          generationRequestId,
        ],
      );
      await pool.query(
        'INSERT INTO story_import_jobs (id, tenant_id, project_id, created_by_user_id, source_file_name, source_content_type, source_byte_size, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $8)',
        [
          randomUUID(),
          teamId,
          projectId,
          userId,
          'story.txt',
          'text/plain',
          'succeeded',
          NOW,
        ],
      );
      await pool.query(
        'INSERT INTO project_collaborators (id, tenant_id, project_id, user_id, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)',
        [randomUUID(), teamId, projectId, userId, 'editor', NOW],
      );
      await pool.query(
        'INSERT INTO idempotency_records (id, tenant_id, scope_key, operation_type, idempotency_key, request_hash, result_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          randomUUID(),
          teamId,
          `story-project:${projectId}`,
          'test',
          'key',
          'a'.repeat(64),
          projectId,
          NOW,
        ],
      );
    });

    afterAll(async () => {
      await prisma.onModuleDestroy();
      await pool.end();
    });

    it('claims expired projects and removes project-scoped children', async () => {
      const claimed = await retention.claimExpired({
        now: new Date('2026-08-22T02:00:00.000Z'),
        leaseUntil: new Date('2026-08-22T04:00:00.000Z'),
        limit: 20,
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.objectKeys).toEqual([`story/${projectId}/cover.png`]);

      await prisma.runInTransaction(() =>
        retention.purgeProject({
          projectId,
          now: new Date('2026-08-22T02:00:00.000Z'),
        }),
      );

      const counts = await pool.query(
        `SELECT
        (SELECT COUNT(*) FROM story_projects WHERE id = $1) AS projects,
        (SELECT COUNT(*) FROM assets WHERE project_id = $1) AS assets,
        (SELECT COUNT(*) FROM story_role_assets WHERE project_id = $1) AS roles,
        (SELECT COUNT(*) FROM conversations WHERE project_id = $1) AS conversations,
        (SELECT COUNT(*) FROM story_artifacts WHERE project_id = $1) AS artifacts,
        (SELECT COUNT(*) FROM idempotency_records WHERE result_id = $1) AS idempotency`,
        [projectId],
      );
      expect(Object.values(counts.rows[0] ?? {})).toEqual([
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ]);
    });
  },
);
