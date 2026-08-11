import { describe, expect, it, vi } from 'vitest';

import { RequestEmailCode } from './request-email-code.js';

describe('RequestEmailCode', () => {
  it('normalizes the email, stores only a digest, and delivers the raw code', async () => {
    const repository = {
      createIfAllowed: vi.fn(async (request) => ({
        created: true as const,
        code: request.code,
      })),
    };
    const delivery = { deliver: vi.fn(async () => undefined) };
    const security = {
      issueCode: () => '012345',
      hashCode: vi.fn(() => 'code-digest'),
      digestSource: vi.fn(() => 'source-digest'),
    };
    const clock = { now: async () => new Date('2026-08-11T10:00:00.000Z') };
    const requestEmailCode = new RequestEmailCode(
      repository,
      delivery,
      security,
      clock,
    );

    await expect(
      requestEmailCode.execute({
        email: ' Writer@Example.COM ',
        sourceAddress: '127.0.0.1',
        purpose: 'login',
      }),
    ).resolves.toEqual({
      message:
        'If the address can receive email, a verification code was sent.',
    });
    expect(repository.createIfAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        code: expect.objectContaining({
          email: 'writer@example.com',
          purpose: 'login',
          codeHash: 'code-digest',
          sourceDigest: 'source-digest',
        }),
      }),
    );
    expect(delivery.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'writer@example.com',
        code: '012345',
        purpose: 'login',
      }),
    );
  });
});
