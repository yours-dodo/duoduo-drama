import { describe, expect, it, vi } from 'vitest';

import {
  InvalidLoginChallengeError,
  VerifyEmailLogin,
} from './verify-email-login.js';
import type { IdentitySecurityEventRepository } from '../ports/identity-security-event-repository.js';
import type { LoginChallengeRepository } from '../ports/login-challenge-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { UserRepository } from '../ports/user-repository.js';

const CONSUMED_AT = new Date('2026-08-09T00:00:00.000Z');

describe('VerifyEmailLogin', () => {
  it('atomically consumes a challenge, creates the user and persists only the session hash', async () => {
    const events = eventRepository();
    const challenges = challengeRepository({
      status: 'verified',
      challengeId: 'challenge-id',
      email: 'creator@example.com',
      consumedAt: CONSUMED_AT,
    });
    const users = userRepository();
    const sessions = sessionRepository();
    const transaction = {
      run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    };
    const verify = new VerifyEmailLogin(
      challenges,
      users,
      sessions,
      events,
      {
        issueSessionToken: () => 'raw-session-token',
        hashLoginToken: (token) => `login-hash:${token}`,
        hashSessionToken: () => 'persisted-session-hash',
      },
      transaction,
      sequentialIds('user-id', 'session-id', 'event-id'),
    );

    const result = await verify.execute({
      token: 'raw-login-token',
      requestId: 'request-id',
    });

    expect(transaction.run).toHaveBeenCalledOnce();
    expect(challenges.consumeForVerification).toHaveBeenCalledWith({
      tokenHash: 'login-hash:raw-login-token',
      maximumAttempts: 5,
    });
    expect(users.findOrCreateByEmail).toHaveBeenCalledWith({
      email: 'creator@example.com',
      newUserId: 'user-id',
    });
    expect(sessions.create).toHaveBeenCalledWith({
      id: 'session-id',
      userId: 'user-id',
      tokenHash: 'persisted-session-hash',
      createdAt: CONSUMED_AT,
      expiresAt: new Date('2026-09-08T00:00:00.000Z'),
      revokedAt: null,
    });
    expect(JSON.stringify(sessions.create.mock.calls)).not.toContain(
      'raw-session-token',
    );
    expect(events.record).not.toHaveBeenCalled();
    expect(result).toEqual({
      user: { id: 'user-id', email: 'creator@example.com' },
      sessionToken: 'raw-session-token',
      sessionExpiresAt: new Date('2026-09-08T00:00:00.000Z'),
    });
  });

  it.each(['invalid', 'expired', 'consumed', 'locked'] as const)(
    'returns one safe error for a %s challenge',
    async (status) => {
      const challenges = challengeRepository(
        status === 'locked'
          ? {
              status,
              challengeId: 'challenge-id',
              occurredAt: CONSUMED_AT,
              newlyLocked: false,
            }
          : { status },
      );
      const users = userRepository();
      const sessions = sessionRepository();
      const verify = new VerifyEmailLogin(
        challenges,
        users,
        sessions,
        eventRepository(),
        {
          issueSessionToken: () => 'raw-session-token',
          hashLoginToken: () => 'login-hash',
          hashSessionToken: () => 'session-hash',
        },
        { run: async (operation) => operation() },
        sequentialIds('user-id', 'session-id', 'event-id'),
      );

      await expect(
        verify.execute({ token: 'login-token', requestId: 'request-id' }),
      ).rejects.toEqual(
        expect.objectContaining<Partial<InvalidLoginChallengeError>>({
          name: 'InvalidLoginChallengeError',
          message: 'Login challenge is invalid or expired',
        }),
      );
      expect(users.findOrCreateByEmail).not.toHaveBeenCalled();
      expect(sessions.create).not.toHaveBeenCalled();
    },
  );

  it('records a newly locked challenge in the same transaction', async () => {
    const events = eventRepository();
    const verify = new VerifyEmailLogin(
      challengeRepository({
        status: 'locked',
        challengeId: 'challenge-id',
        occurredAt: CONSUMED_AT,
        newlyLocked: true,
      }),
      userRepository(),
      sessionRepository(),
      events,
      {
        issueSessionToken: () => 'raw-session-token',
        hashLoginToken: () => 'login-hash',
        hashSessionToken: () => 'session-hash',
      },
      { run: async (operation) => operation() },
      sequentialIds('event-id'),
    );

    await expect(
      verify.execute({ token: 'login-token', requestId: 'request-id' }),
    ).rejects.toBeInstanceOf(InvalidLoginChallengeError);
    expect(events.record).toHaveBeenCalledWith({
      id: 'event-id',
      userId: null,
      sessionId: null,
      action: 'LOGIN_CHALLENGE_LOCKED',
      targetId: 'challenge-id',
      requestId: 'request-id',
      occurredAt: CONSUMED_AT,
    });
  });
});

function challengeRepository(
  result: Awaited<
    ReturnType<LoginChallengeRepository['consumeForVerification']>
  >,
): LoginChallengeRepository & {
  consumeForVerification: ReturnType<typeof vi.fn>;
} {
  return {
    createIfAllowed: vi.fn(),
    findActiveByTokenHash: vi.fn(),
    consumeForVerification: vi.fn(async () => result),
  };
}

function userRepository(): UserRepository & {
  findOrCreateByEmail: ReturnType<typeof vi.fn>;
} {
  return {
    findOrCreateByEmail: vi.fn(async ({ email, newUserId }) => ({
      id: newUserId,
      email,
      createdAt: CONSUMED_AT,
    })),
  };
}

function sessionRepository(): SessionRepository & {
  create: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(async (session) => session),
    findActiveByTokenHash: vi.fn(),
    revoke: vi.fn(),
  };
}

function eventRepository(): IdentitySecurityEventRepository & {
  record: ReturnType<typeof vi.fn>;
} {
  return { record: vi.fn(async () => undefined) };
}

function sequentialIds(...ids: string[]): { create(): string } {
  return {
    create: vi.fn(() => {
      const id = ids.shift();
      if (id === undefined) {
        throw new Error('No test ID remains');
      }
      return id;
    }),
  };
}
