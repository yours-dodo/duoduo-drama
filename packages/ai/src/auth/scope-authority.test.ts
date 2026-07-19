import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AiRuntimeError } from '../core/errors.js';
import { createLocalScopeAuthority } from './node/local-scope.js';
import { validateResolvedScope } from './scope-authority.js';

describe('local credential scope authority', () => {
  it('binds a scope to the expected provider and rejects mismatches', async () => {
    const { authority, scope } = createLocalScopeAuthority({
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      credentialSlotId: 'primary',
    });
    await expect(
      authority.resolve(scope, {
        expectedProviderInstanceId: 'openai',
        action: 'manage_auth',
      }),
    ).resolves.toMatchObject({
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      providerInstanceId: 'openai',
      credentialSlotId: 'primary',
    });
    expect(() =>
      validateResolvedScope(
        {
          tenantId: 'tenant-a',
          subjectId: 'subject-a',
          providerInstanceId: 'openai',
        },
        'azure',
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'CREDENTIAL_SCOPE_MISMATCH',
        category: 'auth',
      } satisfies Partial<AiRuntimeError>),
    );
  });

  it('verifies active and retained scope fingerprint keys', async () => {
    const oldKey = randomBytes(32);
    const activeKey = randomBytes(32);
    const old = createLocalScopeAuthority({
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      activeKeyId: 'old',
      keys: { old: oldKey },
    });
    const current = createLocalScopeAuthority({
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      activeKeyId: 'current',
      keys: { old: oldKey, current: activeKey },
    });
    const resolved = await old.authority.resolve(old.scope, {
      expectedProviderInstanceId: 'openai',
      action: 'inspect_auth',
    });
    const oldFingerprint = await old.authority.fingerprint(resolved);

    await expect(
      current.authority.verifyFingerprint(resolved, oldFingerprint),
    ).resolves.toEqual({ status: 'verified', keyId: 'old' });
    await expect(
      current.authority.verifyFingerprint(
        { ...resolved, subjectId: 'subject-b' },
        oldFingerprint,
      ),
    ).resolves.toEqual({ status: 'mismatch', keyId: 'old' });
    await expect(
      current.authority.verifyFingerprint(resolved, 'retired.deadbeef'),
    ).resolves.toEqual({ status: 'key_unavailable', keyId: 'retired' });
    expect(current.authority.fingerprintLifetime).toBe('cross-runtime');
    expect(
      createLocalScopeAuthority({ tenantId: 't', subjectId: 's' }).authority
        .fingerprintLifetime,
    ).toBe('process-local');
  });
});
