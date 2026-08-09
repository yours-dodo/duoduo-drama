import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import { createTestApp } from '../../../test/create-test-app.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import { LocalEmailDelivery } from '../../identity/infrastructure/local-email-delivery.js';

const databaseUrl = readServerTestDatabaseUrl();

describe.skipIf(!databaseUrl)('team tenancy HTTP PostgreSQL flow', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    pool = new Pool({ connectionString });
    await pool.query(
      'TRUNCATE TABLE "project_collaborators", "story_projects", "team_invitations", "audit_records", "idempotency_records", "team_memberships", "teams", "identity_security_events", "sessions", "email_login_challenges", "users"',
    );
    const serverConfig: ServerConfig = {
      environment: 'test',
      port: 3001,
      cookieSecret: 'local-test-cookie-secret-change-me',
      trustedOrigins: ['http://localhost:3000'],
      databaseUrl: connectionString,
      publicWebUrl: 'http://localhost:3000',
      loginTokenPepper: 'local-test-login-token-pepper-change-me',
      trustedProxyHops: 1,
    };
    app = await createTestApp({ serverConfig });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('creates and lists multiple isolated team contexts for one session', async () => {
    const browser = request.agent(app.getHttpServer());
    await browser
      .post('/v1/auth/email-login-requests')
      .send({ email: 'multi.team.creator@example.com' })
      .expect(202);
    const delivered = app.get(LocalEmailDelivery).readLatestForTest();
    if (delivered === null) {
      throw new Error('Expected a local login token');
    }
    await browser
      .post('/v1/auth/email-login-verifications')
      .send({ token: delivered.token })
      .expect(200);

    const first = await createTeam(browser, '团队一', 'team-one-key');
    const replay = await createTeam(browser, '团队一', 'team-one-key');
    const second = await createTeam(browser, '团队二', 'team-two-key');

    expect(replay.body.team.id).toBe(first.body.team.id);
    expect(second.body.team.id).not.toBe(first.body.team.id);
    const teams = await browser.get('/v1/teams').expect(200);
    const me = await browser.get('/v1/me').expect(200);
    expect(teams.body.teams).toHaveLength(2);
    expect(me.body.teams).toEqual(teams.body.teams);
    expect(me.body.session).not.toHaveProperty('currentTeamId');
    await expect(countRows(pool, 'teams')).resolves.toBe(2);
    await expect(countRows(pool, 'audit_records')).resolves.toBe(2);
  });
});

function createTeam(
  browser: ReturnType<typeof request.agent>,
  name: string,
  idempotencyKey: string,
) {
  return browser
    .post('/v1/teams')
    .set('Origin', 'http://localhost:3000')
    .set('Idempotency-Key', idempotencyKey)
    .send({ name })
    .expect(201);
}

async function countRows(pool: Pool, table: 'teams' | 'audit_records') {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error('SERVER_TEST_POSTGRES_URL is required');
  }
  return value;
}
