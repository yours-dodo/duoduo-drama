import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp } from '../../../test/create-test-app.js';
import { SESSION_COOKIE_NAME } from '../../identity/http/session-auth.guard.js';
import {
  IDENTITY_TOKEN_SECURITY,
  type IdentityTokenSecurity,
} from '../../identity/ports/identity-token-security.js';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from '../../identity/ports/session-repository.js';
import {
  CreateTeam,
  IdempotencyConflictError,
} from '../application/create-team.js';
import { ListMyTeams } from '../application/list-my-teams.js';

const SESSION_TOKEN = 's'.repeat(43);
const CREATED_AT = new Date('2026-08-10T00:00:00.000Z');
const TEAMS = [
  { id: 'team-id', name: '多多编剧组', role: 'admin', createdAt: CREATED_AT },
];

describe('team tenancy HTTP API', () => {
  let app: INestApplication;
  let createTeam: { execute: ReturnType<typeof vi.fn> };
  let listMyTeams: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    createTeam = {
      execute: vi.fn(async () => ({ team: TEAMS[0] })),
    };
    listMyTeams = {
      execute: vi.fn(async () => ({ teams: TEAMS })),
    };
    const sessions: SessionRepository = {
      create: vi.fn(),
      findActiveByTokenHash: vi.fn(async () => ({
        id: 'session-id',
        userId: 'user-id',
        email: 'creator@example.com',
        expiresAt: new Date('2026-09-10T00:00:00.000Z'),
      })),
      revoke: vi.fn(),
    };
    const security: IdentityTokenSecurity = {
      issueToken: () => 'l'.repeat(43),
      hashToken: () => 'login-hash',
      digestSource: () => 'source-digest',
      issueSessionToken: () => SESSION_TOKEN,
      hashLoginToken: () => 'login-hash',
      hashSessionToken: () => 'session-hash',
    };

    app = await createTestApp({
      providerOverrides: [
        { token: CreateTeam, value: createTeam },
        { token: ListMyTeams, value: listMyTeams },
        { token: SESSION_REPOSITORY, value: sessions },
        { token: IDENTITY_TOKEN_SECURITY, value: security },
      ],
    });
  });

  afterEach(async () => {
    await app?.close();
  });

  it('creates a team for the authenticated user with an idempotency key', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/teams')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', 'create-team-key')
      .set('x-request-id', 'create-team-request')
      .send({ name: '多多编剧组' })
      .expect(201);

    expect(createTeam.execute).toHaveBeenCalledWith({
      actorUserId: 'user-id',
      name: '多多编剧组',
      idempotencyKey: 'create-team-key',
      requestId: 'create-team-request',
    });
    expect(response.body).toEqual({
      team: {
        id: 'team-id',
        name: '多多编剧组',
        role: 'admin',
        createdAt: CREATED_AT.toISOString(),
      },
    });
  });

  it('lists all teams and includes them in the current-user response', async () => {
    const cookie = `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`;
    const teams = await request(app.getHttpServer())
      .get('/v1/teams')
      .set('Cookie', cookie)
      .expect(200);
    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Cookie', cookie)
      .expect(200);

    expect(listMyTeams.execute).toHaveBeenCalledWith({ userId: 'user-id' });
    expect(teams.body).toEqual({
      teams: [
        {
          id: 'team-id',
          name: '多多编剧组',
          role: 'admin',
          createdAt: CREATED_AT.toISOString(),
        },
      ],
    });
    expect(me.body).toMatchObject({
      user: { id: 'user-id', email: 'creator@example.com' },
      teams: teams.body.teams,
    });
  });

  it('requires authentication, a trusted Origin, and an idempotency key', async () => {
    await request(app.getHttpServer())
      .post('/v1/teams')
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', 'create-team-key')
      .send({ name: '多多编剧组' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/v1/teams')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('Origin', 'https://evil.example.com')
      .set('Idempotency-Key', 'create-team-key')
      .send({ name: '多多编剧组' })
      .expect(403);
    const missingKey = await request(app.getHttpServer())
      .post('/v1/teams')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('Origin', 'http://localhost:3000')
      .set('x-request-id', 'missing-key-request')
      .send({ name: '多多编剧组' })
      .expect(400);

    expect(missingKey.body.error).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      requestId: 'missing-key-request',
    });
  });

  it('maps idempotency input reuse to a stable conflict response', async () => {
    createTeam.execute.mockRejectedValueOnce(new IdempotencyConflictError());

    const response = await request(app.getHttpServer())
      .post('/v1/teams')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', 'reused-key')
      .set('x-request-id', 'conflict-request')
      .send({ name: '另一个团队' })
      .expect(409);

    expect(response.body).toEqual({
      error: {
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'The idempotency key was used with different input',
        requestId: 'conflict-request',
        details: [],
      },
    });
  });
});
