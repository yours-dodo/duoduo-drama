import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import { StoryRoleAsset } from '../../../domain/story/story-role-asset.js';
import { PrismaService } from '../../../platform/database/prisma.service.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import { PrismaStoryRoleAssetRepository } from './prisma-story-role-asset.repository.js';

const databaseUrl = readServerTestDatabaseUrl();
const NOW = new Date('2026-08-20T15:00:00.000Z');
const LATER = new Date('2026-08-20T16:00:00.000Z');
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe.skipIf(!databaseUrl)('story role asset PostgreSQL boundary', () => {
  let pool: Pool;
  let prisma: PrismaService;
  let roles: PrismaStoryRoleAssetRepository;
  let teamId: string;
  let otherTeamId: string;
  let creatorId: string;
  let otherCreatorId: string;
  let projectId: string;

  beforeAll(() => {
    const connectionString = requireDatabaseUrl(databaseUrl);
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
    roles = new PrismaStoryRoleAssetRepository(prisma);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE "story_role_assets", "story_artifact_versions", "story_artifacts", "story_import_jobs", "assets", "story_generation_requests", "messages", "conversations", "project_collaborators", "story_projects", "team_invitations", "audit_records", "idempotency_records", "team_memberships", "spaces", "teams", "identity_security_events", "sessions", "email_login_challenges", "users" CASCADE',
    );
    teamId = randomUUID();
    otherTeamId = randomUUID();
    creatorId = randomUUID();
    otherCreatorId = randomUUID();
    projectId = randomUUID();
    await insertUser(creatorId, 'role-creator@example.com');
    await insertUser(otherCreatorId, 'other-role-creator@example.com');
    await insertTeam(teamId, creatorId, '角色团队');
    await insertTeam(otherTeamId, otherCreatorId, '其他团队');
    await insertMembership(teamId, creatorId);
    await insertMembership(otherTeamId, otherCreatorId);
    await pool.query(
      'INSERT INTO story_projects (id, tenant_id, space_id, created_by_user_id, owner_user_id, title, visibility, status, revision, created_at, updated_at) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, 1, $8, $8)',
      [projectId, teamId, teamId, creatorId, '角色项目', 'team', 'active', NOW],
    );
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await pool.end();
  });

  it('persists, updates, scopes, and soft-archives a generated UUID role', async () => {
    const role = StoryRoleAsset.create({
      id: randomUUID(),
      tenantId: teamId,
      projectId,
      category: 'protagonists',
      name: '林遥',
      occupation: '档案修复师',
      mainlineRelation: '主视角；调查者',
      actorUserId: creatorId,
      createdAt: NOW,
    });

    const created = await roles.create(role.toSnapshot());
    expect(created.id).toMatch(UUID_V4_PATTERN);
    await expect(
      roles.listByProject({ tenantId: teamId, projectId }),
    ).resolves.toMatchObject([
      { id: created.id, name: '林遥', mainlineRelation: '主视角；调查者' },
    ]);
    await expect(
      roles.listByProject({ tenantId: otherTeamId, projectId }),
    ).resolves.toEqual([]);

    role.update({ name: '林遥（新版）' }, 1, creatorId, LATER);
    await roles.update(role.toSnapshot());
    await expect(
      roles.findById({ tenantId: teamId, projectId, roleId: created.id }),
    ).resolves.toMatchObject({ name: '林遥（新版）', revision: 2 });

    role.archive(2, creatorId, LATER);
    await roles.update(role.toSnapshot());
    await expect(
      roles.listByProject({ tenantId: teamId, projectId }),
    ).resolves.toEqual([]);
  });

  it('uses the PostgreSQL UUID default when no id is supplied', async () => {
    const result = await pool.query<{ id: string }>(
      'INSERT INTO story_role_assets (tenant_id, project_id, category, name, created_by_user_id, updated_by_user_id) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id',
      [teamId, projectId, 'core', '周砚', creatorId],
    );

    expect(result.rows[0]?.id).toMatch(UUID_V4_PATTERN);
  });

  it('rejects cross-tenant and missing-project role records', async () => {
    await expect(
      pool.query(
        'INSERT INTO story_role_assets (tenant_id, project_id, category, name, created_by_user_id, updated_by_user_id) VALUES ($1, $2, $3, $4, $5, $5)',
        [otherTeamId, projectId, 'core', '跨团队角色', otherCreatorId],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    await expect(
      pool.query(
        'INSERT INTO story_role_assets (tenant_id, project_id, category, name, created_by_user_id, updated_by_user_id) VALUES (NULL, $1, $2, $3, $4, $4)',
        [randomUUID(), 'background', '无项目角色', creatorId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  async function insertUser(id: string, email: string): Promise<void> {
    await pool.query(
      'INSERT INTO users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3)',
      [id, email, NOW],
    );
  }

  async function insertTeam(
    id: string,
    createdByUserId: string,
    name: string,
  ): Promise<void> {
    await pool.query(
      'INSERT INTO teams (id, name, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
      [id, name, createdByUserId, NOW],
    );
    await pool.query(
      'INSERT INTO spaces (id, kind, owner_team_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
      [id, 'team', id, NOW],
    );
  }

  async function insertMembership(
    tenantId: string,
    userId: string,
  ): Promise<void> {
    await pool.query(
      'INSERT INTO team_memberships (id, tenant_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), tenantId, userId, 'admin', NOW],
    );
  }
});

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('SERVER_TEST_POSTGRES_URL is required');
  return value;
}
