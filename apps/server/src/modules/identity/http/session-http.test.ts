import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp } from '../../../test/create-test-app.js';
import { Logout } from '../application/logout.js';
import {
  InvalidLoginChallengeError,
  VerifyEmailLogin,
} from '../application/verify-email-login.js';
import {
  IDENTITY_TOKEN_SECURITY,
  type IdentityTokenSecurity,
} from '../ports/identity-token-security.js';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from '../ports/session-repository.js';
import { ListMyTeams } from '../../tenancy/application/list-my-teams.js';
import { SESSION_COOKIE_NAME } from './session-auth.guard.js';

const LOGIN_TOKEN = 'a'.repeat(43);
const SESSION_TOKEN = 'b'.repeat(43);
const SESSION_EXPIRES_AT = new Date('2026-09-08T00:00:00.000Z');

describe('passwordless session HTTP API', () => {
  let app: INestApplication;
  let verifyEmailLogin: { execute: ReturnType<typeof vi.fn> };
  let logout: { execute: ReturnType<typeof vi.fn> };
  let sessions: SessionRepository;

  beforeEach(async () => {
    verifyEmailLogin = {
      execute: vi.fn(async () => ({
        user: { id: 'user-id', email: 'creator@example.com' },
        sessionToken: SESSION_TOKEN,
        sessionExpiresAt: SESSION_EXPIRES_AT,
      })),
    };
    logout = { execute: vi.fn(async () => undefined) };
    sessions = {
      create: vi.fn(),
      findActiveByTokenHash: vi.fn(async () => ({
        id: 'session-id',
        userId: 'user-id',
        email: 'creator@example.com',
        expiresAt: SESSION_EXPIRES_AT,
      })),
      revoke: vi.fn(),
    };
    const security: IdentityTokenSecurity = {
      issueToken: () => LOGIN_TOKEN,
      hashToken: () => 'login-hash',
      digestSource: () => 'source-digest',
      issueSessionToken: () => SESSION_TOKEN,
      hashLoginToken: () => 'login-hash',
      hashSessionToken: (token) => `session-hash:${token}`,
    };

    app = await createTestApp({
      providerOverrides: [
        { token: VerifyEmailLogin, value: verifyEmailLogin },
        { token: Logout, value: logout },
        {
          token: ListMyTeams,
          value: { execute: vi.fn(async () => ({ teams: [] })) },
        },
        { token: SESSION_REPOSITORY, value: sessions },
        { token: IDENTITY_TOKEN_SECURITY, value: security },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('verifies a login token and returns an HttpOnly SameSite session Cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/email-login-verifications')
      .set('x-request-id', 'verification-request')
      .send({ token: LOGIN_TOKEN })
      .expect(200);

    expect(verifyEmailLogin.execute).toHaveBeenCalledWith({
      token: LOGIN_TOKEN,
      requestId: 'verification-request',
    });
    expect(response.body).toEqual({
      user: { id: 'user-id', email: 'creator@example.com' },
      session: { expiresAt: SESSION_EXPIRES_AT.toISOString() },
    });
    expect(JSON.stringify(response.body)).not.toContain(SESSION_TOKEN);
    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('reads the current user through a protected session', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .expect(200);

    expect(sessions.findActiveByTokenHash).toHaveBeenCalledWith(
      `session-hash:${SESSION_TOKEN}`,
    );
    expect(response.body).toEqual({
      user: { id: 'user-id', email: 'creator@example.com' },
      session: { expiresAt: SESSION_EXPIRES_AT.toISOString() },
      teams: [],
    });
  });

  it('returns the same safe response for an invalid or expired login token', async () => {
    verifyEmailLogin.execute.mockRejectedValueOnce(
      new InvalidLoginChallengeError(),
    );

    const response = await request(app.getHttpServer())
      .post('/v1/auth/email-login-verifications')
      .set('x-request-id', 'invalid-token-request')
      .send({ token: LOGIN_TOKEN })
      .expect(401);

    expect(response.body).toEqual({
      error: {
        code: 'INVALID_LOGIN_CHALLENGE',
        message: 'The login token is invalid or expired',
        requestId: 'invalid-token-request',
        details: [],
      },
    });
  });

  it('rejects malformed login tokens before executing the use case', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/email-login-verifications')
      .set('x-request-id', 'malformed-token-request')
      .send({ token: 'not-a-valid-token' })
      .expect(400);

    expect(verifyEmailLogin.execute).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        requestId: 'malformed-token-request',
        details: ['token must be a valid login token'],
      },
    });
  });

  it('rejects an expired or revoked session Cookie', async () => {
    vi.mocked(sessions.findActiveByTokenHash).mockResolvedValueOnce(null);

    const response = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('x-request-id', 'stale-session-request')
      .expect(401);

    expect(response.body).toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required',
        requestId: 'stale-session-request',
        details: [],
      },
    });
  });

  it('logs out from a trusted Origin and expires the Cookie', async () => {
    const response = await request(app.getHttpServer())
      .delete('/v1/auth/session')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('Origin', 'http://localhost:3000')
      .set('x-request-id', 'logout-request')
      .expect(204);

    expect(logout.execute).toHaveBeenCalledWith({
      sessionId: 'session-id',
      requestId: 'logout-request',
    });
    expect(response.headers['set-cookie']?.[0] ?? '').toContain(
      `${SESSION_COOKIE_NAME}=;`,
    );
  });

  it('blocks Cookie-authenticated writes from an untrusted Origin', async () => {
    const response = await request(app.getHttpServer())
      .delete('/v1/auth/session')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('Origin', 'https://evil.example.com')
      .set('x-request-id', 'csrf-request')
      .expect(403);

    expect(logout.execute).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      error: {
        code: 'UNTRUSTED_ORIGIN',
        message: 'The request Origin is not trusted',
        requestId: 'csrf-request',
        details: [],
      },
    });
  });
});
