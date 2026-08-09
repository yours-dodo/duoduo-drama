import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { SessionRepository } from '../ports/session-repository.js';
import {
  readAuthenticatedSession,
  SessionAuthGuard,
  SESSION_COOKIE_NAME,
} from './session-auth.guard.js';

describe('SessionAuthGuard', () => {
  it('authenticates an active opaque session and attaches immutable context', async () => {
    const request: { cookies: Record<string, string> } = {
      cookies: { [SESSION_COOKIE_NAME]: 'raw-session-token' },
    };
    const sessions = sessionRepository({
      id: 'session-id',
      userId: 'user-id',
      email: 'creator@example.com',
      expiresAt: new Date('2026-09-08T00:00:00.000Z'),
    });
    const guard = new SessionAuthGuard(sessions, {
      hashSessionToken: (token) => `hash:${token}`,
    });

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(sessions.findActiveByTokenHash).toHaveBeenCalledWith(
      'hash:raw-session-token',
    );
    const authenticated = readAuthenticatedSession(request);
    expect(authenticated).toEqual({
      sessionId: 'session-id',
      userId: 'user-id',
      email: 'creator@example.com',
      expiresAt: '2026-09-08T00:00:00.000Z',
    });
    expect(Object.isFrozen(authenticated)).toBe(true);
  });

  it.each([
    { cookies: {} },
    { cookies: { [SESSION_COOKIE_NAME]: '' } },
    { cookies: { [SESSION_COOKIE_NAME]: ['unexpected'] } },
  ])('rejects a missing or malformed session cookie', async (request) => {
    const guard = new SessionAuthGuard(sessionRepository(null), {
      hashSessionToken: () => 'hash',
    });

    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      statusCode: 401,
    });
  });

  it('rejects a session that is expired or revoked in the repository', async () => {
    const guard = new SessionAuthGuard(sessionRepository(null), {
      hashSessionToken: () => 'hash',
    });

    await expect(
      guard.canActivate(
        contextFor({ cookies: { [SESSION_COOKIE_NAME]: 'stale-token' } }),
      ),
    ).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      statusCode: 401,
    });
  });
});

function sessionRepository(
  active: Awaited<ReturnType<SessionRepository['findActiveByTokenHash']>>,
): SessionRepository & {
  findActiveByTokenHash: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findActiveByTokenHash: vi.fn(async () => active),
    revoke: vi.fn(),
  };
}

function contextFor(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}
