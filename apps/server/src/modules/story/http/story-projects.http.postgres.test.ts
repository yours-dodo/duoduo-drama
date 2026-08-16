import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import { createTestApp } from '../../../test/create-test-app.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import { SESSION_COOKIE_NAME } from '../../identity/http/session-auth.guard.js';
import { IDENTITY_TOKEN_SECURITY } from '../../identity/ports/identity-token-security.js';
import { SESSION_REPOSITORY } from '../../identity/ports/session-repository.js';

const databaseUrl = readServerTestDatabaseUrl();
const SESSION_TOKEN = 's'.repeat(43);
const TEAM_ID = '10000000-0000-4000-8000-000000000001';
const CREATOR_ID = '20000000-0000-4000-8000-000000000001';
const ADMIN_ID = '30000000-0000-4000-8000-000000000001';
const WRITER_ID = '40000000-0000-4000-8000-000000000001';
const PROJECT_ID = '50000000-0000-4000-8000-000000000001';

describe.skipIf(!databaseUrl)('story project HTTP PostgreSQL flow', () => {
  let app: INestApplication;
  let pool: Pool;
  let currentUserId = CREATOR_ID;
  let currentEmail = 'creator@example.com';

  beforeAll(async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    pool = new Pool({ connectionString, max: 8 });
    const config: ServerConfig = {
      environment: 'test',
      port: 3001,
      cookieSecret: 'local-test-cookie-secret-change-me',
      trustedOrigins: ['http://localhost:3000'],
      databaseUrl: connectionString,
      publicWebUrl: 'http://localhost:3000',
      loginTokenPepper: 'local-test-login-token-pepper-change-me',
      trustedProxyHops: 0,
    };
    app = await createTestApp({
      serverConfig: config,
      providerOverrides: [
        {
          token: SESSION_REPOSITORY,
          value: {
            findActiveByTokenHash: async () => ({
              id: 'session-id',
              userId: currentUserId,
              email: currentEmail,
              expiresAt: new Date('2026-09-10T00:00:00.000Z'),
            }),
          },
        },
        {
          token: IDENTITY_TOKEN_SECURITY,
          value: { hashSessionToken: () => 'session-hash' },
        },
      ],
    });
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE "story_artifact_versions", "story_artifacts", "story_import_jobs", "assets", "story_generation_requests", "messages", "conversations", "project_collaborators", "story_projects", "team_invitations", "audit_records", "idempotency_records", "team_memberships", "spaces", "teams", "identity_security_events", "sessions", "email_login_challenges", "users" CASCADE',
    );
    await insertUser(CREATOR_ID, 'creator@example.com');
    await insertUser(ADMIN_ID, 'admin@example.com');
    await insertUser(WRITER_ID, 'writer@example.com');
    await pool.query(
      'INSERT INTO teams (id, name, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp())',
      [TEAM_ID, '故事团队', CREATOR_ID],
    );
    await pool.query(
      'INSERT INTO spaces (id, kind, owner_team_id, created_at, updated_at) VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp())',
      [TEAM_ID, 'team', TEAM_ID],
    );
    await insertMembership(CREATOR_ID, 'admin');
    await insertMembership(ADMIN_ID, 'admin');
    await insertMembership(WRITER_ID, 'member');
    currentUserId = CREATOR_ID;
    currentEmail = 'creator@example.com';
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('creates an immersive project with four modules and a pending import job', async () => {
    const write = (builder: request.Test) =>
      builder
        .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
        .set('Origin', 'http://localhost:3000');
    const collection = `/v1/teams/${TEAM_ID}/story-projects`;

    const created = await write(request(app.getHttpServer()).post(collection))
      .set('Idempotency-Key', 'create-immersive-project')
      .send({ title: '导入故事', creationMode: 'immersive' })
      .expect(201);
    expect(created.body.project).toMatchObject({
      title: '导入故事',
      creationMode: 'immersive',
    });
    expect(
      created.body.modules.map((module: { type: string }) => module.type),
    ).toEqual(['outline', 'roles', 'worldview', 'story']);

    const projectId = created.body.project.id as string;
    const imported = await write(
      request(app.getHttpServer()).post(
        `${collection}/${projectId}/import-jobs`,
      ),
    )
      .set('Idempotency-Key', 'create-import-job')
      .send({
        fileName: '旧故事.md',
        contentType: 'text/markdown',
        byteSize: 2048,
      })
      .expect(201);
    expect(imported.body.importJob).toMatchObject({
      projectId,
      sourceFileName: '旧故事.md',
      status: 'pending',
    });

    const persisted = await pool.query<{
      module_count: string;
      job_count: string;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM story_artifacts WHERE project_id = $1 AND status = 'active') AS module_count,
        (SELECT COUNT(*) FROM story_import_jobs WHERE project_id = $1) AS job_count`,
      [projectId],
    );
    expect(persisted.rows[0]).toEqual({ module_count: '4', job_count: '1' });
  });

  it('keeps private projects hidden, revokes collaborators, and audits admin access', async () => {
    const auth = (builder: request.Test) =>
      builder.set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`);
    const write = (builder: request.Test) =>
      auth(builder).set('Origin', 'http://localhost:3000');
    const collection = `/v1/teams/${TEAM_ID}/story-projects`;

    const created = await write(request(app.getHttpServer()).post(collection))
      .set('Idempotency-Key', 'create-project')
      .send({ title: '数据库项目' })
      .expect(201);
    const projectId = created.body.project.id as string;
    await write(
      request(app.getHttpServer()).post(
        `${collection}/${projectId}/collaborators`,
      ),
    )
      .send({ userId: WRITER_ID })
      .expect(201);
    await auth(
      request(app.getHttpServer()).get(
        `${collection}/${projectId}/collaborators`,
      ),
    ).expect(200);

    await write(
      request(app.getHttpServer()).patch(`${collection}/${projectId}`),
    )
      .send({ visibility: 'private', expectedRevision: 1 })
      .expect(200);
    await auth(
      request(app.getHttpServer()).get(
        `${collection}/${projectId}/collaborators`,
      ),
    ).expect(200, { items: [], nextCursor: null });

    currentUserId = WRITER_ID;
    currentEmail = 'writer@example.com';
    await auth(
      request(app.getHttpServer()).get(`${collection}/${projectId}`),
    ).expect(404);
    await auth(request(app.getHttpServer()).get(collection)).expect(200, {
      items: [],
      nextCursor: null,
    });

    currentUserId = ADMIN_ID;
    currentEmail = 'admin@example.com';
    await auth(
      request(app.getHttpServer()).get(`${collection}/${projectId}`),
    ).expect(200);
    const audit = await auth(
      request(app.getHttpServer()).get(
        `${collection}/${projectId}/audit-records`,
      ),
    ).expect(200);
    expect(
      audit.body.items.some(
        (item: { action: string }) =>
          item.action === 'STORY_PROJECT_PRIVATE_VIEWED',
      ),
    ).toBe(true);

    const conflict = await write(
      request(app.getHttpServer()).patch(`${collection}/${projectId}`),
    )
      .send({ title: '过期修改', expectedRevision: 1 })
      .expect(409);
    expect(conflict.body.error.code).toBe('STORY_PROJECT_REVISION_CONFLICT');
  });

  it('rejects a project identifier from another tenant as not found', async () => {
    const otherTeamId = randomUUID();
    const otherCreatorId = randomUUID();
    await insertUser(otherCreatorId, 'other@example.com');
    await pool.query(
      'INSERT INTO teams (id, name, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp())',
      [otherTeamId, '另一个团队', otherCreatorId],
    );
    await pool.query(
      'INSERT INTO spaces (id, kind, owner_team_id, created_at, updated_at) VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp())',
      [otherTeamId, 'team', otherTeamId],
    );
    await pool.query(
      'INSERT INTO team_memberships (id, tenant_id, user_id, role) VALUES ($1, $2, $3, $4)',
      [randomUUID(), otherTeamId, otherCreatorId, 'admin'],
    );
    await pool.query(
      'INSERT INTO story_projects (id, tenant_id, space_id, created_by_user_id, owner_user_id, title, visibility, status, revision) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        PROJECT_ID,
        otherTeamId,
        otherTeamId,
        otherCreatorId,
        otherCreatorId,
        '别人的项目',
        'team',
        'active',
        1,
      ],
    );

    const response = await request(app.getHttpServer())
      .get(`/v1/teams/${TEAM_ID}/story-projects/${PROJECT_ID}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .expect(404);
    expect(response.body.error.code).toBe('STORY_PROJECT_NOT_FOUND');
  });

  async function insertUser(id: string, email: string): Promise<void> {
    await pool.query(
      'INSERT INTO users (id, email, created_at, updated_at) VALUES ($1, $2, clock_timestamp(), clock_timestamp())',
      [id, email],
    );
  }

  async function insertMembership(
    userId: string,
    role: 'admin' | 'member',
  ): Promise<void> {
    await pool.query(
      'INSERT INTO team_memberships (id, tenant_id, user_id, role) VALUES ($1, $2, $3, $4)',
      [randomUUID(), TEAM_ID, userId, role],
    );
  }
});

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('SERVER_TEST_POSTGRES_URL is required');
  return value;
}
