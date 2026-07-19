import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { secret } from '../secret-value.js';
import { createCredentialRecordSealer } from '../record-sealer.js';
import { createAesGcmCredentialCodec } from './key-source.js';
import { createFileCredentialStore } from './file-store.js';

const scope = {
  tenantId: 'tenant-secret',
  subjectId: 'subject-secret',
  providerInstanceId: 'openai',
  credentialSlotId: 'primary',
};

describe('node file credential store', () => {
  it('shares sealed credentials across store instances without exposing scope or secret', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'duoduo-ai-credentials-'));
    const encryptionKey = randomBytes(32);
    const fileNameKey = randomBytes(32);
    const sealer = createCredentialRecordSealer({
      codec: createAesGcmCredentialCodec({
        activeKeyId: 'key-1',
        keys: { 'key-1': encryptionKey },
      }),
      storeNamespace: 'test-store',
    });
    const first = createFileCredentialStore({ directory, sealer, fileNameKey });
    const second = createFileCredentialStore({
      directory,
      sealer,
      fileNameKey,
    });
    const empty = await first.read(scope);
    const written = await first.compareAndSet(scope, empty.revision, {
      state: 'active',
      credential: {
        type: 'api_key',
        secret: secret('sk-canary-never-persist-plain'),
        scheme: 'Bearer',
      },
      credentialInstanceId: 'credential-instance-1',
      catalogAuth: { catalogVisibilityFingerprint: 'all' },
      authBinding: {
        version: 1,
        fingerprint: 'binding-1',
        providerKind: 'openai',
        allowedOrigins: ['https://api.openai.com'],
      },
      authState: { status: 'ready' },
    });
    expect(written.status).toBe('applied');

    const restored = await second.read(scope);
    expect(restored).toMatchObject({
      state: 'active',
      credentialInstanceId: 'credential-instance-1',
      credential: { type: 'api_key' },
    });
    const names = await import('node:fs/promises').then((fs) =>
      fs.readdir(directory),
    );
    const recordName = names.find((name) => name.endsWith('.json'));
    expect(recordName).toBeDefined();
    expect(recordName).not.toContain('tenant-secret');
    const persisted = await readFile(join(directory, recordName!), 'utf8');
    expect(persisted).not.toContain('sk-canary-never-persist-plain');
    expect(persisted).not.toContain('tenant-secret');
    expect(persisted).not.toContain('subject-secret');
    expect((await stat(directory)).mode & 0o077).toBe(0);
    expect((await stat(join(directory, recordName!))).mode & 0o077).toBe(0);
    expect(first.identityLifetime).toBe('cross-runtime');
  });

  it('returns a conflict when two instances race from the same revision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'duoduo-ai-cas-'));
    const key = randomBytes(32);
    const sealer = createCredentialRecordSealer({
      codec: createAesGcmCredentialCodec({
        activeKeyId: 'k',
        keys: { k: key },
      }),
      storeNamespace: 'cas-store',
    });
    const options = { directory, sealer, fileNameKey: randomBytes(32) };
    const first = createFileCredentialStore(options);
    const second = createFileCredentialStore(options);
    const empty = await first.read(scope);
    const [a, b] = await Promise.all([
      first.compareAndSet(scope, empty.revision, { state: 'empty' }),
      second.compareAndSet(scope, empty.revision, { state: 'empty' }),
    ]);
    expect([a.status, b.status].sort()).toEqual(['applied', 'conflict']);
  });
});
