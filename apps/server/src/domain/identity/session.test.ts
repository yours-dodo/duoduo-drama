import { describe, expect, it } from 'vitest';

import { Session } from './session.js';

describe('Session', () => {
  it('issues a 30-day session without retaining the raw token', () => {
    const issuedAt = new Date('2026-08-09T00:00:00.000Z');
    const session = Session.issue({
      id: 'session-id',
      userId: 'user-id',
      tokenHash: 'a'.repeat(64),
      issuedAt,
    });

    expect(session.toSnapshot()).toEqual({
      id: 'session-id',
      userId: 'user-id',
      tokenHash: 'a'.repeat(64),
      createdAt: issuedAt,
      expiresAt: new Date('2026-09-08T00:00:00.000Z'),
      revokedAt: null,
    });
    expect(session.toSnapshot()).not.toHaveProperty('token');
  });

  it('is active only before expiration and before revocation', () => {
    const session = Session.issue({
      id: 'session-id',
      userId: 'user-id',
      tokenHash: 'a'.repeat(64),
      issuedAt: new Date('2026-08-09T00:00:00.000Z'),
    });

    expect(session.isActive(new Date('2026-09-07T23:59:59.999Z'))).toBe(true);
    expect(session.isActive(new Date('2026-09-08T00:00:00.000Z'))).toBe(false);

    session.revoke(new Date('2026-08-10T00:00:00.000Z'));

    expect(session.isActive(new Date('2026-08-10T00:00:00.000Z'))).toBe(false);
    expect(session.toSnapshot().revokedAt).toEqual(
      new Date('2026-08-10T00:00:00.000Z'),
    );
  });

  it('keeps the first revocation timestamp when logout is retried', () => {
    const session = Session.issue({
      id: 'session-id',
      userId: 'user-id',
      tokenHash: 'a'.repeat(64),
      issuedAt: new Date('2026-08-09T00:00:00.000Z'),
    });

    expect(session.revoke(new Date('2026-08-10T00:00:00.000Z'))).toBe(true);
    expect(session.revoke(new Date('2026-08-11T00:00:00.000Z'))).toBe(false);
    expect(session.toSnapshot().revokedAt).toEqual(
      new Date('2026-08-10T00:00:00.000Z'),
    );
  });
});
