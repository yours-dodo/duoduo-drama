import { describe, expect, it, vi } from 'vitest';

import { RequestEmailLogin } from './request-email-login.js';

const NOW = new Date('2026-08-09T10:00:00.000Z');
const CHALLENGE_ID = '01989c8f-7d20-7000-8000-000000000002';
const RAW_TOKEN = 'raw-login-token-that-must-not-be-persisted';
const TOKEN_HASH = 'sha256:login-token-hash';
const SOURCE_DIGEST = 'sha256:source-address-digest';
const ACCEPTED_RESPONSE = {
  message: 'If the address can receive email, sign-in instructions were sent.',
};

describe('RequestEmailLogin', () => {
  it('persists only protected challenge data and delivers the raw token', async () => {
    const createIfAllowed = vi.fn().mockResolvedValue({
      created: true,
      challenge: {
        id: CHALLENGE_ID,
        email: 'writer@example.com',
        tokenHash: TOKEN_HASH,
        sourceDigest: SOURCE_DIGEST,
        createdAt: new Date('2026-08-09T10:00:01.000Z'),
        expiresAt: new Date('2026-08-09T10:10:01.000Z'),
        attemptCount: 0,
        consumedAt: null,
      },
    });
    const deliver = vi.fn().mockResolvedValue(undefined);
    const useCase = new RequestEmailLogin(
      { createIfAllowed },
      { deliver },
      {
        issueToken: () => RAW_TOKEN,
        hashToken: (token) => (token === RAW_TOKEN ? TOKEN_HASH : 'unexpected'),
        digestSource: (source) =>
          source === '203.0.113.9' ? SOURCE_DIGEST : 'unexpected',
      },
      { now: () => NOW },
      { create: () => CHALLENGE_ID },
    );

    await expect(
      useCase.execute({
        email: '  Writer@Example.COM ',
        sourceAddress: '203.0.113.9',
      }),
    ).resolves.toEqual(ACCEPTED_RESPONSE);

    expect(createIfAllowed).toHaveBeenCalledWith({
      challenge: {
        id: CHALLENGE_ID,
        email: 'writer@example.com',
        tokenHash: TOKEN_HASH,
        sourceDigest: SOURCE_DIGEST,
        createdAt: NOW,
        expiresAt: new Date('2026-08-09T10:10:00.000Z'),
        attemptCount: 0,
        consumedAt: null,
      },
      limits: {
        email: { maximum: 5, windowMs: 900_000 },
        source: { maximum: 20, windowMs: 900_000 },
      },
    });
    expect(JSON.stringify(createIfAllowed.mock.calls[0])).not.toContain(
      RAW_TOKEN,
    );
    expect(deliver).toHaveBeenCalledWith({
      email: 'writer@example.com',
      token: RAW_TOKEN,
      expiresAt: new Date('2026-08-09T10:10:01.000Z'),
    });
  });

  it('silently accepts a rate-limited request without delivering email', async () => {
    const createIfAllowed = vi.fn().mockResolvedValue({ created: false });
    const deliver = vi.fn().mockResolvedValue(undefined);
    const useCase = new RequestEmailLogin(
      { createIfAllowed },
      { deliver },
      {
        issueToken: () => RAW_TOKEN,
        hashToken: () => TOKEN_HASH,
        digestSource: () => SOURCE_DIGEST,
      },
      { now: () => NOW },
      { create: () => CHALLENGE_ID },
    );

    await expect(
      useCase.execute({
        email: 'writer@example.com',
        sourceAddress: '203.0.113.9',
      }),
    ).resolves.toEqual(ACCEPTED_RESPONSE);
    expect(deliver).not.toHaveBeenCalled();
  });
});
