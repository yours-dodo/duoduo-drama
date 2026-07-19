import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../core/content.js';
import type { CredentialIdentityLifetime } from '../core/models.js';
import type { CatalogCacheKey } from '../catalog/cache-key.js';
import type {
  CachedCatalog,
  CatalogStore,
  CatalogWriteValue,
} from '../catalog/catalog-store.js';

export interface CatalogResolution {
  readonly source: 'fresh' | 'cached' | 'stale';
  readonly payload: JsonValue;
  readonly record: CachedCatalog;
  readonly refreshError?: unknown;
}

export interface CatalogCoordinator {
  resolve(
    key: CatalogCacheKey,
    identityLifetime: CredentialIdentityLifetime,
    refresh: () => Promise<CatalogWriteValue>,
    options?: Readonly<{ force?: boolean; signal?: AbortSignal }>,
  ): Promise<CatalogResolution>;
}

export function createCatalogCoordinator(
  options: {
    readonly persistentStore?: CatalogStore;
    readonly ephemeralStore?: CatalogStore;
  } = {},
): CatalogCoordinator {
  const ephemeralStore =
    options.ephemeralStore ?? createEphemeralCatalogStore();
  const inFlight = new Map<string, Promise<CatalogResolution>>();

  const coordinator: CatalogCoordinator = {
    resolve: async (key, identityLifetime, refresh, callOptions) => {
      const store =
        identityLifetime === 'cross-runtime' && options.persistentStore
          ? options.persistentStore
          : ephemeralStore;
      const cacheId = `${identityLifetime}:${JSON.stringify(key)}`;
      const cached = await store.read(key, callOptions?.signal);
      const now = await store.now(callOptions?.signal);
      if (!callOptions?.force && cached && cached.expiresAt > now)
        return { source: 'cached', payload: cached.payload, record: cached };
      const active = inFlight.get(cacheId);
      if (active) return active;
      const promise = refreshAndCommit(
        store,
        key,
        refresh,
        cached,
        callOptions?.signal,
      );
      inFlight.set(cacheId, promise);
      try {
        return await promise;
      } finally {
        if (inFlight.get(cacheId) === promise) inFlight.delete(cacheId);
      }
    },
  };
  return Object.freeze(coordinator);
}

async function refreshAndCommit(
  store: CatalogStore,
  key: CatalogCacheKey,
  refresh: () => Promise<CatalogWriteValue>,
  cached: CachedCatalog | undefined,
  signal?: AbortSignal,
): Promise<CatalogResolution> {
  try {
    const ticket = await store.beginRefresh(key, signal);
    const value = await refresh();
    const result = await store.commitRefresh(key, ticket, value, signal);
    if (result.status === 'written')
      return {
        source: 'fresh',
        payload: result.record.payload,
        record: result.record,
      };
    const latest = result.record ?? (await store.read(key, signal));
    if (!latest)
      throw new Error('catalog refresh was superseded without a value');
    return { source: 'cached', payload: latest.payload, record: latest };
  } catch (error) {
    if (!cached) throw error;
    return {
      source: 'stale',
      payload: cached.payload,
      record: cached,
      refreshError: error,
    };
  }
}

function createEphemeralCatalogStore(): CatalogStore {
  const records = new Map<string, CachedCatalog>();
  const generations = new Map<string, number>();
  const id = (key: CatalogCacheKey) => JSON.stringify(key);
  const store: CatalogStore = {
    read: async (key, signal) => {
      throwIfAborted(signal);
      return records.get(id(key));
    },
    beginRefresh: async (key, signal) => {
      throwIfAborted(signal);
      const cacheId = id(key);
      const generation = (generations.get(cacheId) ?? 0) + 1;
      generations.set(cacheId, generation);
      return { refreshGeneration: String(generation), startedAt: Date.now() };
    },
    commitRefresh: async (key, ticket, value, signal) => {
      throwIfAborted(signal);
      if (!Number.isFinite(value.ttlMs) || value.ttlMs <= 0)
        throw new TypeError('catalog ttlMs must be positive');
      const cacheId = id(key);
      if (String(generations.get(cacheId) ?? 0) !== ticket.refreshGeneration)
        return { status: 'superseded', record: records.get(cacheId) };
      const now = Date.now();
      const record = Object.freeze({
        payload: value.payload,
        storeRevision: randomUUID(),
        discoveredAt: now,
        expiresAt: now + value.ttlMs,
        ...(value.sourceRevision === undefined
          ? {}
          : { sourceRevision: value.sourceRevision }),
        digest: value.digest,
      });
      records.set(cacheId, record);
      return { status: 'written', record };
    },
    delete: async (key, signal) => {
      throwIfAborted(signal);
      records.delete(id(key));
    },
    now: async (signal) => {
      throwIfAborted(signal);
      return Date.now();
    },
  };
  return Object.freeze(store);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
