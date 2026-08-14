import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import { createTestApp } from '../../../test/create-test-app.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import { LocalEmailDelivery } from '../../identity/infrastructure/local-email-delivery.js';
import { LocalTeamInvitationDelivery } from '../infrastructure/local-team-invitation-delivery.js';

const databaseUrl = readServerTestDatabaseUrl();

describe.skipIf(!databaseUrl)('team lifecycle HTTP PostgreSQL flow', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    pool = new Pool({ connectionString });
    await pool.query(
      'TRUNCATE TABLE "story_generation_requests", "messages", "conversations", "project_collaborators", "story_projects", "team_invitations", "audit_records", "idempotency_records", "team_memberships", "spaces", "teams", "identity_security_events", "sessions", "email_login_challenges", "users"',
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

  it('invites, joins, manages, removes, and audits one team member', async () => {
    const administrator = await login('admin@example.com');
    const invitedUser = await login('member@example.com');
    const team = await administrator
      .post('/v1/teams')
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', 'team-key')
      .send({ name: '多多创作团队' })
      .expect(201);
    const teamId = team.body.team.id as string;

    await administrator
      .post(`/v1/teams/${teamId}/invitations`)
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', 'invitation-key')
      .send({ email: 'member@example.com' })
      .expect(201);
    const delivered = app.get(LocalTeamInvitationDelivery).readLatestForTest();
    if (delivered === null) throw new Error('Expected an invitation token');

    await invitedUser
      .post('/v1/team-invitation-acceptances')
      .set('Origin', 'http://localhost:3000')
      .send({ token: delivered.token })
      .expect(201);
    await invitedUser
      .post('/v1/team-invitation-acceptances')
      .set('Origin', 'http://localhost:3000')
      .send({ token: delivered.token })
      .expect(404);
    const invitedTeams = await invitedUser.get('/v1/teams').expect(200);
    expect(
      invitedTeams.body.teams.map((item: { id: string }) => item.id),
    ).toContain(teamId);

    await invitedUser.get(`/v1/teams/${teamId}/audit-records`).expect(403);
    const firstMembersPage = await administrator
      .get(`/v1/teams/${teamId}/members`)
      .query({ limit: 1 })
      .expect(200);
    expect(firstMembersPage.body.nextCursor).toEqual(expect.any(String));
    const secondMembersPage = await administrator
      .get(`/v1/teams/${teamId}/members`)
      .query({ limit: 1, cursor: firstMembersPage.body.nextCursor })
      .expect(200);
    expect(secondMembersPage.body.nextCursor).toBeNull();
    const allMembers = [
      ...firstMembersPage.body.items,
      ...secondMembersPage.body.items,
    ];
    expect(
      new Set(allMembers.map((item: { id: string }) => item.id)).size,
    ).toBe(2);
    const member = allMembers.find(
      (item: { email: string }) => item.email === 'member@example.com',
    ) as { id: string } | undefined;
    if (!member) throw new Error('Expected accepted team member');

    await administrator
      .patch(`/v1/teams/${teamId}/members/${member.id}`)
      .set('Origin', 'http://localhost:3000')
      .send({ role: 'admin' })
      .expect(200);
    await administrator
      .delete(`/v1/teams/${teamId}/members/${member.id}`)
      .set('Origin', 'http://localhost:3000')
      .expect(204);

    await invitedUser.get(`/v1/teams/${teamId}/members`).expect(404);
    const remainingTeams = await invitedUser.get('/v1/teams').expect(200);
    expect(
      remainingTeams.body.teams.map((item: { id: string }) => item.id),
    ).not.toContain(teamId);

    const audit = await administrator
      .get(`/v1/teams/${teamId}/audit-records`)
      .expect(200);
    expect(
      audit.body.items.map((record: { action: string }) => record.action),
    ).toEqual(
      expect.arrayContaining([
        'TEAM_CREATED',
        'TEAM_INVITATION_CREATED',
        'TEAM_MEMBER_JOINED',
        'TEAM_MEMBER_ROLE_CHANGED',
        'TEAM_MEMBER_REMOVED',
      ]),
    );
  });

  async function login(email: string) {
    const browser = request.agent(app.getHttpServer());
    await browser
      .post('/v1/auth/email-login-requests')
      .send({ email })
      .expect(202);
    const delivered = app.get(LocalEmailDelivery).readLatestForTest();
    if (delivered === null) throw new Error('Expected a login token');
    await browser
      .post('/v1/auth/email-login-verifications')
      .send({ token: delivered.token })
      .expect(200);
    return browser;
  }
});

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('SERVER_TEST_POSTGRES_URL is required');
  return value;
}
