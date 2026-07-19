import { randomUUID } from 'node:crypto';

import type { CatalogCacheKey } from '../catalog/cache-key.js';
import type { CachedCatalog, CatalogStore } from '../catalog/catalog-store.js';

import type {
  ActiveCredentialRecord,
  Clock,
  CredentialRecord,
  CredentialRecordUpdate,
  CredentialScopeKey,
  CredentialStore,
  RefreshLeaseHandle,
} from '../auth/credential-store.js';
import { canonicalizeCredentialScope } from '../auth/scope-authority.js';

export function createMemoryCredentialStore(
  options: {
    readonly clock?: Clock;
  } = {},
): CredentialStore {
  const clock = options.clock ?? { now: () => Date.now() };
  const records = new Map<string, CredentialRecord>();
  let revision = 0;
  const nextRevision = () => `memory-revision-${++revision}`;

  const readRecord = (scope: CredentialScopeKey): CredentialRecord => {
    const key = canonicalizeCredentialScope(scope);
    let record = records.get(key);
    if (!record) {
      record = Object.freeze({ state: 'empty', revision: nextRevision() });
      records.set(key, record);
    }
    return record;
  };
  const writeRecord = (
    scope: CredentialScopeKey,
    record: CredentialRecord,
  ): CredentialRecord => {
    records.set(canonicalizeCredentialScope(scope), record);
    return record;
  };
  const fromUpdate = (next: CredentialRecordUpdate): CredentialRecord =>
    next.state === 'empty'
      ? Object.freeze({ state: 'empty', revision: nextRevision() })
      : Object.freeze({ ...next, revision: nextRevision() });

  const store: CredentialStore = {
    identityLifetime: 'process-local',
    read: async (scope, signal) => {
      throwIfAborted(signal);
      return readRecord(scope);
    },
    compareAndSet: async (scope, expectedRevision, next, signal) => {
      throwIfAborted(signal);
      const current = readRecord(scope);
      if (current.revision !== expectedRevision)
        return { status: 'conflict', current } as const;
      const record = writeRecord(scope, fromUpdate(next));
      return { status: 'applied', record } as const;
    },
    acquireRefreshLease: async (scope, expectedRevision, request, signal) => {
      throwIfAborted(signal);
      const current = readRecord(scope);
      if (current.revision !== expectedRevision)
        return {
          status: 'not_acquired',
          reason: 'revision_changed',
          current,
        } as const;
      if (current.state !== 'active' || current.credential.type !== 'oauth')
        return {
          status: 'not_acquired',
          reason: 'not_oauth',
          current,
        } as const;
      if (current.authState.status === 'reauth_required')
        return {
          status: 'not_acquired',
          reason: 'reauth_required',
          current,
        } as const;
      const now = clock.now();
      if (
        current.authState.status === 'backoff' &&
        current.authState.retryAt > now
      )
        return {
          status: 'not_acquired',
          reason: 'backoff',
          current,
          retryAt: current.authState.retryAt,
        } as const;
      if (current.refreshLease && current.refreshLease.expiresAt > now)
        return {
          status: 'not_acquired',
          reason: 'lease_held',
          current,
          retryAt: current.refreshLease.takeoverNotBefore,
        } as const;
      if (!Number.isFinite(request.maxDurationMs) || request.maxDurationMs <= 0)
        throw new TypeError('refresh maxDurationMs must be positive');
      const expiresAt = now + request.maxDurationMs;
      const refreshLease = Object.freeze({
        leaseId: randomUUID(),
        ownerId: request.ownerId,
        acquiredAt: now,
        expiresAt,
        hardDeadlineAt: expiresAt,
        takeoverNotBefore: expiresAt,
      });
      const record = writeRecord(
        scope,
        Object.freeze({
          ...current,
          revision: nextRevision(),
          refreshLease,
        }),
      ) as ActiveCredentialRecord;
      return {
        status: 'acquired',
        record,
        lease: makeLeaseHandle(record),
      } as const;
    },
    renewRefreshLease: async (scope, lease, signal) => {
      throwIfAborted(signal);
      const current = readRecord(scope);
      if (!matchesLease(current, lease) || clock.now() >= lease.hardDeadlineAt)
        return { status: 'lost', current } as const;
      const record = writeRecord(
        scope,
        Object.freeze({ ...current, revision: nextRevision() }),
      ) as ActiveCredentialRecord;
      return {
        status: 'renewed',
        record,
        lease: makeLeaseHandle(record),
      } as const;
    },
    finishRefresh: async (scope, lease, next, signal) => {
      throwIfAborted(signal);
      const current = readRecord(scope);
      if (!matchesLease(current, lease))
        return { status: 'lost', current } as const;
      const record = writeRecord(
        scope,
        Object.freeze({
          ...current,
          revision: nextRevision(),
          ...(next.credential ? { credential: next.credential } : {}),
          ...(next.catalogAuth ? { catalogAuth: next.catalogAuth } : {}),
          authState: next.authState,
          refreshLease: undefined,
        }),
      ) as ActiveCredentialRecord;
      return { status: 'applied', record } as const;
    },
    waitForChange: async (scope, afterRevision, options, signal) => {
      for (;;) {
        throwIfAborted(signal);
        const current = readRecord(scope);
        if (
          current.revision !== afterRevision ||
          clock.now() >= options.notAfter
        )
          return current;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    },
    now: async (signal) => {
      throwIfAborted(signal);
      return clock.now();
    },
  };
  return Object.freeze(store);
}

function makeLeaseHandle(record: ActiveCredentialRecord): RefreshLeaseHandle {
  if (!record.refreshLease) throw new TypeError('record has no refresh lease');
  return Object.freeze({
    ...record.refreshLease,
    revision: record.revision,
    credentialInstanceId: record.credentialInstanceId,
    authBindingFingerprint: record.authBinding.fingerprint,
  });
}

function matchesLease(
  record: CredentialRecord,
  lease: RefreshLeaseHandle,
): record is ActiveCredentialRecord {
  return (
    record.state === 'active' &&
    record.revision === lease.revision &&
    record.credentialInstanceId === lease.credentialInstanceId &&
    record.authBinding.fingerprint === lease.authBindingFingerprint &&
    record.refreshLease?.leaseId === lease.leaseId &&
    record.refreshLease.ownerId === lease.ownerId
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

export interface MemoryCatalogStore extends CatalogStore {
  operationCounts(): Readonly<{
    read: number;
    beginRefresh: number;
    commitRefresh: number;
    delete: number;
  }>;
}

export function createMemoryCatalogStore(
  options: {
    readonly clock?: Clock;
  } = {},
): MemoryCatalogStore {
  const clock = options.clock ?? { now: () => Date.now() };
  const records = new Map<string, CachedCatalog>();
  const generations = new Map<string, number>();
  let revision = 0;
  const counts = { read: 0, beginRefresh: 0, commitRefresh: 0, delete: 0 };
  const id = (key: CatalogCacheKey) => JSON.stringify(key);
  const store: MemoryCatalogStore = {
    read: async (key, signal) => {
      throwIfAborted(signal);
      counts.read += 1;
      return records.get(id(key));
    },
    beginRefresh: async (key, signal) => {
      throwIfAborted(signal);
      counts.beginRefresh += 1;
      const cacheId = id(key);
      const generation = (generations.get(cacheId) ?? 0) + 1;
      generations.set(cacheId, generation);
      return Object.freeze({
        refreshGeneration: String(generation),
        startedAt: clock.now(),
      });
    },
    commitRefresh: async (key, ticket, value, signal) => {
      throwIfAborted(signal);
      counts.commitRefresh += 1;
      if (!Number.isFinite(value.ttlMs) || value.ttlMs <= 0)
        throw new TypeError('catalog ttlMs must be positive');
      const cacheId = id(key);
      if (String(generations.get(cacheId) ?? 0) !== ticket.refreshGeneration)
        return { status: 'superseded', record: records.get(cacheId) };
      const now = clock.now();
      const record = Object.freeze({
        payload: value.payload,
        storeRevision: String(++revision),
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
      counts.delete += 1;
      records.delete(id(key));
    },
    now: async (signal) => {
      throwIfAborted(signal);
      return clock.now();
    },
    operationCounts: () => Object.freeze({ ...counts }),
  };
  return Object.freeze(store);
}
