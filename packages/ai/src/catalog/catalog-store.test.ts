import { describe, expect, it } from 'vitest';
import { createFakeClock, createMemoryCatalogStore } from '../testing.js';
import { canonicalizeCatalogCacheKey } from './cache-key.js';

const key = {
  capability: 'chat',
  providerInstanceId: 'openai',
  providerCatalogBindingFingerprint: 'catalog-binding',
  providerConfigFingerprint: 'provider-config',
  authBindingFingerprint: 'auth-binding',
  credentialScopeFingerprint: 'scope-fingerprint',
  credentialInstanceId: 'credential-1',
  catalogVisibilityFingerprint: 'visibility',
  schemaVersion: 1,
};

describe('catalog store', () => {
  it('includes every isolation dimension in the canonical cache key', () => {
    const baseline = canonicalizeCatalogCacheKey(key);
    for (const [field, value] of Object.entries({
      capability: 'images',
      providerInstanceId: 'azure',
      providerCatalogBindingFingerprint: 'catalog-binding-2',
      providerConfigFingerprint: 'provider-config-2',
      authBindingFingerprint: 'auth-binding-2',
      credentialScopeFingerprint: 'scope-fingerprint-2',
      credentialInstanceId: 'credential-2',
      catalogVisibilityFingerprint: 'visibility-2',
      schemaVersion: 2,
    })) {
      expect(canonicalizeCatalogCacheKey({ ...key, [field]: value })).not.toBe(
        baseline,
      );
    }
    expect(baseline).not.toContain('tenant');
  });

  it('fences stale refresh tickets with monotonic generations', async () => {
    const clock = createFakeClock(1_000);
    const store = createMemoryCatalogStore({ clock });
    const first = await store.beginRefresh(key);
    clock.advance(1);
    const second = await store.beginRefresh(key);
    expect(Number(second.refreshGeneration)).toBeGreaterThan(
      Number(first.refreshGeneration),
    );
    await expect(
      store.commitRefresh(key, first, {
        payload: { models: ['old'] },
        ttlMs: 1_000,
        digest: 'old',
      }),
    ).resolves.toEqual({ status: 'superseded', record: undefined });
    await expect(
      store.commitRefresh(key, second, {
        payload: { models: ['new'] },
        ttlMs: 1_000,
        digest: 'new',
      }),
    ).resolves.toMatchObject({
      status: 'written',
      record: { discoveredAt: 1_001, expiresAt: 2_001, digest: 'new' },
    });
  });
});
