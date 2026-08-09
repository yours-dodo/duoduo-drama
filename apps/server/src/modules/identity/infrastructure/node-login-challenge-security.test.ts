import { describe, expect, it } from 'vitest';

import { NodeLoginChallengeSecurity } from './node-login-challenge-security.js';

describe('NodeLoginChallengeSecurity', () => {
  it('issues high-entropy URL-safe tokens', () => {
    const security = new NodeLoginChallengeSecurity(
      'test-login-token-pepper-32-chars',
    );

    const first = security.issueToken();
    const second = security.issueToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it('uses deterministic, purpose-separated HMAC digests', () => {
    const security = new NodeLoginChallengeSecurity(
      'test-login-token-pepper-32-chars',
    );

    expect(security.hashToken('raw-login-token')).toBe(
      'c00b24b0650ff7b533c76770f889c4554d65e7c0924b643068dbb3154647f01c',
    );
    expect(security.digestSource('203.0.113.9')).toBe(
      '1258e06257d5ce57f5bd4b658e2afcbbc1dfcb8b47124df7027932d4d9e460bb',
    );
  });
});
