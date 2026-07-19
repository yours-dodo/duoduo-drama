import { describe, expect, it } from 'vitest';

import { secret } from './secret-value.js';
import { createFakeClock, createMemoryCredentialStore } from '../testing.js';
import type { CredentialScopeKey } from './credential-store.js';

const scope: CredentialScopeKey = {
  tenantId: 'tenant-a',
  subjectId: 'subject-a',
  providerInstanceId: 'openai',
  credentialSlotId: 'primary',
};

function oauthUpdate() {
  return {
    state: 'active' as const,
    credential: {
      type: 'oauth' as const,
      accessToken: secret('access-token'),
      refreshToken: secret('refresh-token'),
      expiresAt: 10_000,
    },
    credentialInstanceId: 'credential-1',
    catalogAuth: { catalogVisibilityFingerprint: 'all-models' },
    authBinding: {
      version: 1 as const,
      fingerprint: 'auth-binding-1',
      providerKind: 'openai',
      allowedOrigins: ['https://api.openai.com'],
    },
    authState: { status: 'ready' as const },
  };
}

describe('credential store contract', () => {
  it('uses revision CAS and returns the current record on conflict', async () => {
    const clock = createFakeClock(1_000);
    const store = createMemoryCredentialStore({ clock });
    const empty = await store.read(scope);
    const applied = await store.compareAndSet(
      scope,
      empty.revision,
      oauthUpdate(),
    );
    expect(applied.status).toBe('applied');

    const conflict = await store.compareAndSet(scope, empty.revision, {
      state: 'empty',
    });
    expect(conflict).toMatchObject({
      status: 'conflict',
      current: { state: 'active', credentialInstanceId: 'credential-1' },
    });
  });

  it('fences refresh leases and allows takeover after expiry', async () => {
    const clock = createFakeClock(1_000);
    const store = createMemoryCredentialStore({ clock });
    const empty = await store.read(scope);
    const applied = await store.compareAndSet(
      scope,
      empty.revision,
      oauthUpdate(),
    );
    if (applied.status !== 'applied' || applied.record.state !== 'active')
      throw new Error('expected active credential');

    const first = await store.acquireRefreshLease(
      scope,
      applied.record.revision,
      { ownerId: 'worker-1', maxDurationMs: 1_000 },
    );
    expect(first.status).toBe('acquired');
    if (first.status !== 'acquired') throw new Error('expected first lease');

    const held = await store.acquireRefreshLease(scope, first.record.revision, {
      ownerId: 'worker-2',
      maxDurationMs: 1_000,
    });
    expect(held).toMatchObject({
      status: 'not_acquired',
      reason: 'lease_held',
    });

    clock.advance(1_001);
    const current = await store.read(scope);
    const takeover = await store.acquireRefreshLease(scope, current.revision, {
      ownerId: 'worker-2',
      maxDurationMs: 1_000,
    });
    expect(takeover.status).toBe('acquired');
    if (takeover.status !== 'acquired') throw new Error('expected takeover');

    const staleFinish = await store.finishRefresh(scope, first.lease, {
      authState: { status: 'ready' },
    });
    expect(staleFinish.status).toBe('lost');
  });
});
