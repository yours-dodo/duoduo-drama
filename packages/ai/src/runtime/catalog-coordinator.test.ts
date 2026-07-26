import { describe, expect, it } from 'vitest';
import { createFakeClock, createMemoryCatalogStore } from '../testing.js';
import { createCatalogCoordinator } from './catalog-coordinator.js';

const key = {
  capability: 'chat',
  providerInstanceId: 'openai',
  providerCatalogBindingFingerprint: 'catalog-binding',
  providerConfigFingerprint: 'provider-config',
  authBindingFingerprint: 'auth-binding',
  credentialScopeFingerprint: 'scope',
  credentialInstanceId: 'credential',
  catalogVisibilityFingerprint: 'visibility',
  schemaVersion: 1,
};

describe('catalog coordinator', () => {
  it('uses persistent cache across coordinators for cross-runtime identities', async () => {
    const clock = createFakeClock(1_000);
    const persistent = createMemoryCatalogStore({ clock });
    const first = createCatalogCoordinator({ persistentStore: persistent });
    await expect(
      first.resolve(key, 'cross-runtime', async () => ({
        payload: { models: ['gpt'] },
        ttlMs: 100,
        digest: 'digest-1',
      })),
    ).resolves.toMatchObject({ source: 'fresh' });
    const second = createCatalogCoordinator({ persistentStore: persistent });
    await expect(
      second.resolve(key, 'cross-runtime', async () => {
        throw new Error('must not refresh');
      }),
    ).resolves.toMatchObject({
      source: 'cached',
      payload: { models: ['gpt'] },
    });
  });

  it('never touches persistent cache for process-local identities', async () => {
    const persistent = createMemoryCatalogStore();
    const coordinator = createCatalogCoordinator({
      persistentStore: persistent,
    });
    await coordinator.resolve(key, 'process-local', async () => ({
      payload: { models: ['ambient'] },
      ttlMs: 100,
      digest: 'ambient',
    }));
    expect(persistent.operationCounts()).toEqual({
      read: 0,
      beginRefresh: 0,
      commitRefresh: 0,
      delete: 0,
    });
  });

  it('isolates singleflight work by identity lifetime', async () => {
    const persistent = createMemoryCatalogStore();
    const coordinator = createCatalogCoordinator({
      persistentStore: persistent,
    });
    let releaseProcessLocal: (() => void) | undefined;
    const processLocalRefresh = new Promise<void>((resolve) => {
      releaseProcessLocal = resolve;
    });

    const processLocal = coordinator.resolve(key, 'process-local', async () => {
      await processLocalRefresh;
      return {
        payload: { models: ['ambient'] },
        ttlMs: 100,
        digest: 'ambient',
      };
    });
    const crossRuntime = coordinator.resolve(
      key,
      'cross-runtime',
      async () => ({
        payload: { models: ['stored'] },
        ttlMs: 100,
        digest: 'stored',
      }),
    );

    await expect(crossRuntime).resolves.toMatchObject({
      source: 'fresh',
      payload: { models: ['stored'] },
    });
    expect(persistent.operationCounts()).toEqual({
      read: 1,
      beginRefresh: 1,
      commitRefresh: 1,
      delete: 0,
    });

    releaseProcessLocal?.();
    await expect(processLocal).resolves.toMatchObject({
      source: 'fresh',
      payload: { models: ['ambient'] },
    });
  });

  it('returns expired last-known-good data as stale when refresh fails', async () => {
    const clock = createFakeClock(1_000);
    const persistent = createMemoryCatalogStore({ clock });
    const coordinator = createCatalogCoordinator({
      persistentStore: persistent,
    });
    await coordinator.resolve(key, 'cross-runtime', async () => ({
      payload: { models: ['known-good'] },
      ttlMs: 10,
      digest: 'known-good',
    }));
    clock.advance(11);
    await expect(
      coordinator.resolve(key, 'cross-runtime', async () => {
        throw new Error('offline');
      }),
    ).resolves.toMatchObject({
      source: 'stale',
      payload: { models: ['known-good'] },
      refreshError: expect.any(Error),
    });
  });

  it('rejects expired data after the stale-if-error window closes', async () => {
    const clock = createFakeClock(1_000);
    const persistent = createMemoryCatalogStore({ clock });
    const coordinator = createCatalogCoordinator({
      persistentStore: persistent,
      catalogPolicy: { staleIfErrorMs: 20 },
    });
    await coordinator.resolve(key, 'cross-runtime', async () => ({
      payload: { models: ['too-old'] },
      ttlMs: 10,
      digest: 'too-old',
    }));
    clock.advance(31);

    await expect(
      coordinator.resolve(key, 'cross-runtime', async () => {
        throw new Error('refresh unavailable');
      }),
    ).rejects.toThrow('refresh unavailable');
  });

  it('disables stale fallback when stale-if-error is zero', async () => {
    const clock = createFakeClock(1_000);
    const persistent = createMemoryCatalogStore({ clock });
    const coordinator = createCatalogCoordinator({
      persistentStore: persistent,
      catalogPolicy: { staleIfErrorMs: 0 },
    });
    await coordinator.resolve(key, 'cross-runtime', async () => ({
      payload: { models: ['expired'] },
      ttlMs: 10,
      digest: 'expired',
    }));
    clock.advance(10);

    await expect(
      coordinator.resolve(key, 'cross-runtime', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
  });
});
