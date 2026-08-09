import { describe, expect, it } from 'vitest';

import { EmailAddress } from './email-address.js';
import { LoginChallenge } from './login-challenge.js';

describe('LoginChallenge', () => {
  it('issues a challenge that expires exactly ten minutes later', () => {
    const issuedAt = new Date('2026-08-09T10:00:00.000Z');
    const challenge = LoginChallenge.issue({
      id: '01989c8f-7d20-7000-8000-000000000001',
      email: EmailAddress.parse('writer@example.com'),
      tokenHash: 'sha256:stored-hash-only',
      sourceDigest: 'sha256:source-address-digest',
      issuedAt,
    });

    expect(challenge.toSnapshot()).toEqual({
      id: '01989c8f-7d20-7000-8000-000000000001',
      email: 'writer@example.com',
      tokenHash: 'sha256:stored-hash-only',
      sourceDigest: 'sha256:source-address-digest',
      createdAt: issuedAt,
      expiresAt: new Date('2026-08-09T10:10:00.000Z'),
      attemptCount: 0,
      consumedAt: null,
    });
    expect(challenge.isExpired(new Date('2026-08-09T10:09:59.999Z'))).toBe(
      false,
    );
    expect(challenge.isExpired(new Date('2026-08-09T10:10:00.000Z'))).toBe(
      true,
    );
  });
});
