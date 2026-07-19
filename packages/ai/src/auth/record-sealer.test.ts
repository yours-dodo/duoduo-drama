import { describe, expect, it } from 'vitest';

import { AiRuntimeError } from '../core/errors.js';
import { createAesGcmCredentialCodec } from './node/key-source.js';
import { createCredentialRecordSealer } from './record-sealer.js';
import { revealSecret, secret } from './secret-value.js';
import type {
  ActiveCredentialRecord,
  CredentialScopeKey,
} from './credential-store.js';

const scope: CredentialScopeKey = {
  tenantId: 'tenant-a',
  subjectId: 'subject-a',
  providerInstanceId: 'openai',
  credentialSlotId: 'primary',
};

function activeRecord(): ActiveCredentialRecord {
  return {
    state: 'active',
    revision: 'revision-1',
    credential: {
      type: 'api_key',
      secret: secret('sk-sealer-canary'),
      scheme: 'Bearer',
    },
    credentialInstanceId: 'credential-1',
    catalogAuth: { catalogVisibilityFingerprint: 'all-models' },
    authBinding: {
      version: 1,
      fingerprint: 'auth-binding-1',
      providerKind: 'openai',
      allowedOrigins: ['https://api.openai.com'],
    },
    authState: { status: 'ready' },
  };
}

describe('credential record sealer', () => {
  it('encrypts the complete record and restores secret values', async () => {
    const sealer = createCredentialRecordSealer({
      codec: createAesGcmCredentialCodec({
        activeKeyId: 'key-1',
        keys: { 'key-1': new Uint8Array(32).fill(7) },
      }),
      storeNamespace: 'test-store',
    });

    const persisted = await sealer.seal(scope, activeRecord());
    const serialized = JSON.stringify(persisted);

    expect(serialized).not.toContain('sk-sealer-canary');
    expect(serialized).not.toContain('tenant-a');
    expect(serialized).not.toContain('subject-a');

    const opened = await sealer.open(scope, persisted);
    expect(opened).toMatchObject({
      state: 'active',
      revision: 'revision-1',
      credentialInstanceId: 'credential-1',
      authBinding: { fingerprint: 'auth-binding-1' },
    });
    if (opened.state !== 'active' || opened.credential.type !== 'api_key')
      throw new Error('expected active API key credential');
    expect(revealSecret(opened.credential.secret)).toBe('sk-sealer-canary');
  });

  it('rejects header tampering instead of opening under different AAD', async () => {
    const sealer = createCredentialRecordSealer({
      codec: createAesGcmCredentialCodec({
        activeKeyId: 'key-1',
        keys: { 'key-1': new Uint8Array(32).fill(9) },
      }),
      storeNamespace: 'test-store',
    });
    const persisted = await sealer.seal(scope, activeRecord());
    const tampered = {
      ...persisted,
      header: { ...persisted.header, credentialInstanceId: 'credential-2' },
    };

    await expect(sealer.open(scope, tampered)).rejects.toEqual(
      expect.objectContaining<Partial<AiRuntimeError>>({
        code: 'CREDENTIAL_STORE_CORRUPT',
        category: 'auth',
      }),
    );
  });
});
