import { describe, expect, it } from 'vitest';

import { NodeEmailCodeSecurity } from './node-email-code-security.js';

describe('NodeEmailCodeSecurity', () => {
  it('issues six digit codes and purpose-bound digests', () => {
    const security = new NodeEmailCodeSecurity('a'.repeat(32));
    const code = security.issueCode();

    expect(code).toMatch(/^\d{6}$/);
    expect(security.hashCode('writer@example.com', 'login', code)).toBe(
      security.hashCode('writer@example.com', 'login', code),
    );
    expect(security.hashCode('writer@example.com', 'login', code)).not.toBe(
      security.hashCode('writer@example.com', 'password_reset', code),
    );
    expect(security.digestSource(' 127.0.0.1 ')).toBe(
      security.digestSource('127.0.0.1'),
    );
  });
});
