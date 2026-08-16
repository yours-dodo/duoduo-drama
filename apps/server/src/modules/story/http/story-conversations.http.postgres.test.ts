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
const READER_ID = '30000000-0000-4000-8000-000000000001';

describe.skipIf(!databaseUrl)('story conversation HTTP PostgreSQL flow', () => {
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
    await insertUser(READER_ID, 'reader@example.com');
    await pool.query(
      'INSERT INTO teams (id, name, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp())',
      [TEAM_ID, '故事团队', CREATOR_ID],
    );
    await pool.query(
      'INSERT INTO spaces (id, kind, owner_team_id, created_at, updated_at) VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp())',
      [TEAM_ID, 'team', TEAM_ID],
    );
    await insertMembership(CREATOR_ID, 'admin');
    await insertMembership(READER_ID, 'member');
    currentUserId = CREATOR_ID;
    currentEmail = 'creator@example.com';
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('persists conversations, messages, pending generation, and idempotent retries', async () => {
    const auth = (builder: request.Test) =>
      builder.set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`);
    const write = (builder: request.Test) =>
      auth(builder).set('Origin', 'http://localhost:3000');
    const projectsPath = `/v1/teams/${TEAM_ID}/story-projects`;
    const project = await write(request(app.getHttpServer()).post(projectsPath))
      .set('Idempotency-Key', 'project-key')
      .send({ title: '对话项目' })
      .expect(201);
    const projectId = project.body.project.id as string;
    const conversationsPath = `${projectsPath}/${projectId}/conversations`;

    const created = await write(
      request(app.getHttpServer()).post(conversationsPath),
    )
      .set('Idempotency-Key', 'conversation-key')
      .send({ title: '人物关系' })
      .expect(201);
    const conversationId = created.body.conversation.id as string;
    const replayedConversation = await write(
      request(app.getHttpServer()).post(conversationsPath),
    )
      .set('Idempotency-Key', 'conversation-key')
      .send({ title: '人物关系' })
      .expect(201);
    expect(replayedConversation.body.conversation.id).toBe(conversationId);

    const messagesPath = `${conversationsPath}/${conversationId}/messages`;
    const appended = await write(
      request(app.getHttpServer()).post(messagesPath),
    )
      .set('Idempotency-Key', 'message-key')
      .send({ body: '请梳理人物关系' })
      .expect(201);
    expect(appended.body).toMatchObject({
      message: { authorType: 'user', body: '请梳理人物关系' },
      generationRequest: { status: 'pending' },
    });
    const messageId = appended.body.message.id as string;
    const replayedMessage = await write(
      request(app.getHttpServer()).post(messagesPath),
    )
      .set('Idempotency-Key', 'message-key')
      .send({ body: '请梳理人物关系' })
      .expect(201);
    expect(replayedMessage.body.message.id).toBe(messageId);

    const conflict = await write(
      request(app.getHttpServer()).post(messagesPath),
    )
      .set('Idempotency-Key', 'message-key')
      .send({ body: '不同内容' })
      .expect(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');

    const messages = await auth(request(app.getHttpServer()).get(messagesPath))
      .query({ limit: 25 })
      .expect(200);
    expect(messages.body).toMatchObject({
      items: [{ id: messageId, body: '请梳理人物关系' }],
      nextCursor: null,
    });
    await write(
      request(app.getHttpServer()).patch(
        `${conversationsPath}/${conversationId}`,
      ),
    )
      .send({ title: '新版人物关系', expectedRevision: 1 })
      .expect(200);
    await write(
      request(app.getHttpServer()).post(
        `${conversationsPath}/${conversationId}/archive`,
      ),
    )
      .send({ expectedRevision: 2 })
      .expect(200);
    await auth(request(app.getHttpServer()).get(messagesPath)).expect(200);
    await write(request(app.getHttpServer()).post(messagesPath))
      .set('Idempotency-Key', 'after-archive')
      .send({ body: '归档后不应追加' })
      .expect(409);
  });

  it('rechecks project permissions for conversation creation', async () => {
    const auth = (builder: request.Test) =>
      builder.set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`);
    const write = (builder: request.Test) =>
      auth(builder).set('Origin', 'http://localhost:3000');
    const projectsPath = `/v1/teams/${TEAM_ID}/story-projects`;
    const project = await write(request(app.getHttpServer()).post(projectsPath))
      .set('Idempotency-Key', 'private-project-key')
      .send({ title: '私人项目', visibility: 'private' })
      .expect(201);
    const projectId = project.body.project.id as string;
    currentUserId = READER_ID;
    currentEmail = 'reader@example.com';

    const denied = await auth(
      request(app.getHttpServer()).post(
        `${projectsPath}/${projectId}/conversations`,
      ),
    )
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', 'reader-conversation-key')
      .send({ title: '越权对话' });
    expect(denied.status).toBe(404);
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
