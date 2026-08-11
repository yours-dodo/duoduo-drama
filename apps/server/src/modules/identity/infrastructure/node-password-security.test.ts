import { describe, expect, it } from 'vitest';

import { NodePasswordSecurity } from './node-password-security.js';

describe('NodePasswordSecurity', () => {
  it('hashes and verifies passwords without storing the raw value', async () => {
    const security = new NodePasswordSecurity();
    const password = 'correct horse battery staple';
    const hash = await security.hashPassword(password);

    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(hash).not.toContain(password);
    await expect(security.verifyPassword(password, hash)).resolves.toBe(true);
    await expect(security.verifyPassword('wrong password', hash)).resolves.toBe(
      false,
    );
  });

  it('rejects malformed or unsupported password hashes', async () => {
    const security = new NodePasswordSecurity();

    await expect(
      security.verifyPassword('password', 'not-a-hash'),
    ).resolves.toBe(false);
    await expect(
      security.verifyPassword('password', 'scrypt$32768$8$1$bad$bad'),
    ).resolves.toBe(false);
  });
});
