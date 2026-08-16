import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import { StoryArtifact } from '../../../domain/story/story-artifact.js';
import { StoryArtifactVersion } from '../../../domain/story/story-artifact-version.js';
import { PrismaService } from '../../../platform/database/prisma.service.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import { PrismaStoryArtifactRepository } from './prisma-story-artifact.repository.js';
import { PrismaStoryArtifactVersionRepository } from './prisma-story-artifact-version.repository.js';

const databaseUrl = readServerTestDatabaseUrl();
const NOW = new Date('2026-08-10T04:00:00.000Z');

describe.skipIf(!databaseUrl)('story artifact PostgreSQL boundary', () => {
  let pool: Pool;
  let prisma: PrismaService;
  let artifacts: PrismaStoryArtifactRepository;
  let versions: PrismaStoryArtifactVersionRepository;
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
    artifacts = new PrismaStoryArtifactRepository(prisma);
    versions = new PrismaStoryArtifactVersionRepository(prisma);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE "story_artifact_versions", "story_artifacts", "story_import_jobs", "assets", "story_generation_requests", "messages", "conversations", "project_collaborators", "story_projects", "team_invitations", "audit_records", "idempotency_records", "team_memberships", "spaces", "teams", "identity_security_events", "sessions", "email_login_challenges", "users" CASCADE',
    );
    teamId = randomUUID();
    otherTeamId = randomUUID();
    creatorId = randomUUID();
    otherCreatorId = randomUUID();
    projectId = randomUUID();
    await insertUser(creatorId, 'creator@example.com');
    await insertUser(otherCreatorId, 'other@example.com');
    await insertTeam(teamId, creatorId, '故事团队');
    await insertTeam(otherTeamId, otherCreatorId, '另一个团队');
    await insertMembership(teamId, creatorId, 'admin');
    await insertMembership(otherTeamId, otherCreatorId, 'admin');
    await pool.query(
      'INSERT INTO story_projects (id, tenant_id, space_id, created_by_user_id, owner_user_id, title, visibility, status, revision, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)',
      [
        projectId,
        teamId,
        teamId,
        creatorId,
        creatorId,
        '故事项目',
        'team',
        'active',
        1,
        NOW,
      ],
    );
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await pool.end();
  });

  it('persists artifacts, versions, and the current version pointer', async () => {
    const artifact = StoryArtifact.create({
      id: randomUUID(),
      tenantId: teamId,
      projectId,
      type: 'outline',
      title: '故事大纲',
      createdAt: NOW,
    }).toSnapshot();
    const version = StoryArtifactVersion.createDraft({
      id: randomUUID(),
      tenantId: teamId,
      artifactId: artifact.id,
      versionNumber: 1,
      content: '第一版故事大纲',
      contentFormat: 'markdown',
      sourceType: 'user',
      sourceMessageId: null,
      generationRequestId: null,
      createdByUserId: creatorId,
      createdAt: NOW,
    }).toSnapshot();

    await artifacts.create(artifact);
    await versions.create(version);
    await artifacts.update({
      ...artifact,
      currentVersionId: version.id,
      updatedAt: new Date('2026-08-10T04:01:00.000Z'),
    });

    await expect(
      artifacts.findById({ tenantId: teamId, artifactId: artifact.id }),
    ).resolves.toMatchObject({
      id: artifact.id,
      currentVersionId: version.id,
    });
    await expect(
      versions.listForArtifact({
        tenantId: teamId,
        artifactId: artifact.id,
      }),
    ).resolves.toMatchObject([
      { id: version.id, content: '第一版故事大纲', status: 'draft' },
    ]);
    await expect(
      artifacts.listForProject({ tenantId: teamId, projectId }),
    ).resolves.toMatchObject([{ id: artifact.id, type: 'outline' }]);
  });

  it('locks an artifact before changing a version lifecycle state', async () => {
    const artifact = StoryArtifact.create({
      id: randomUUID(),
      tenantId: teamId,
      projectId,
      type: 'outline',
      title: '故事大纲',
      createdAt: NOW,
    }).toSnapshot();
    const version = StoryArtifactVersion.createDraft({
      id: randomUUID(),
      tenantId: teamId,
      artifactId: artifact.id,
      versionNumber: 1,
      content: '待确认大纲',
      contentFormat: 'text',
      sourceType: 'agent',
      sourceMessageId: null,
      generationRequestId: null,
      createdByUserId: null,
      createdAt: NOW,
    }).toSnapshot();
    await artifacts.create(artifact);
    await versions.create(version);
    await artifacts.update({
      ...artifact,
      currentVersionId: version.id,
      updatedAt: NOW,
    });

    await expect(
      artifacts.findByIdLocked({
        tenantId: teamId,
        artifactId: artifact.id,
      }),
    ).resolves.toMatchObject({ currentVersionId: version.id });

    const aggregate = StoryArtifactVersion.restore(version);
    aggregate.confirm();
    await versions.update(aggregate.toSnapshot());
    await expect(
      versions.findById({ tenantId: teamId, versionId: version.id }),
    ).resolves.toMatchObject({ id: version.id, status: 'confirmed' });
  });

  it('rejects cross-tenant artifact and version references', async () => {
    const artifact = StoryArtifact.create({
      id: randomUUID(),
      tenantId: teamId,
      projectId,
      type: 'roles',
      title: '角色资产',
      createdAt: NOW,
    }).toSnapshot();
    await artifacts.create(artifact);

    await expect(
      pool.query(
        'INSERT INTO story_artifacts (id, tenant_id, project_id, type, title, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)',
        [
          randomUUID(),
          otherTeamId,
          projectId,
          'outline',
          '跨租户成果',
          'active',
          NOW,
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    await expect(
      pool.query(
        'INSERT INTO story_artifact_versions (id, tenant_id, artifact_id, version_number, content, content_format, status, source_type, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          randomUUID(),
          otherTeamId,
          artifact.id,
          1,
          '跨租户版本',
          'text',
          'draft',
          'user',
          NOW,
        ],
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
    role: 'admin' | 'member',
  ): Promise<void> {
    await pool.query(
      'INSERT INTO team_memberships (id, tenant_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), tenantId, userId, role, NOW],
    );
  }
});

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('SERVER_TEST_POSTGRES_URL is required');
  return value;
}
