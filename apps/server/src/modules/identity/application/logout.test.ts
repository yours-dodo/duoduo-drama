import { describe, expect, it, vi } from 'vitest';

import { Logout } from './logout.js';
import type { IdentitySecurityEventRepository } from '../ports/identity-security-event-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';

describe('Logout', () => {
  it('revokes the session and records a security event atomically', async () => {
    const revokedAt = new Date('2026-08-09T00:00:00.000Z');
    const sessions = sessionRepository({
      id: 'session-id',
      userId: 'user-id',
      revokedAt,
    });
    const events = eventRepository();
    const transaction = {
      run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    };
    const logout = new Logout(sessions, events, transaction, {
      create: () => 'event-id',
    });

    await logout.execute({
      sessionId: 'session-id',
      requestId: 'request-id',
    });

    expect(transaction.run).toHaveBeenCalledOnce();
    expect(sessions.revoke).toHaveBeenCalledWith('session-id');
    expect(events.record).toHaveBeenCalledWith({
      id: 'event-id',
      userId: 'user-id',
      sessionId: 'session-id',
      action: 'SESSION_REVOKED',
      targetId: 'session-id',
      requestId: 'request-id',
      occurredAt: revokedAt,
    });
  });

  it('is idempotent when the session was already revoked', async () => {
    const sessions = sessionRepository(null);
    const events = eventRepository();
    const logout = new Logout(
      sessions,
      events,
      { run: async (operation) => operation() },
      { create: () => 'event-id' },
    );

    await expect(
      logout.execute({ sessionId: 'session-id', requestId: 'request-id' }),
    ).resolves.toBeUndefined();
    expect(events.record).not.toHaveBeenCalled();
  });
});

function sessionRepository(
  revoked: Awaited<ReturnType<SessionRepository['revoke']>>,
): SessionRepository & { revoke: ReturnType<typeof vi.fn> } {
  return {
    create: vi.fn(),
    findActiveByTokenHash: vi.fn(),
    revoke: vi.fn(async () => revoked),
  };
}

function eventRepository(): IdentitySecurityEventRepository & {
  record: ReturnType<typeof vi.fn>;
} {
  return { record: vi.fn(async () => undefined) };
}
