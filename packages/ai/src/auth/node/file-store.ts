import { createHmac, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import type {
  ActiveCredentialRecord,
  Clock,
  CredentialRecord,
  CredentialRecordUpdate,
  CredentialScopeKey,
  CredentialStore,
  RefreshLeaseHandle,
} from '../credential-store.js';
import type {
  CredentialRecordSealer,
  PersistedCredentialRecord,
} from '../record-sealer.js';
import { canonicalizeCredentialScope } from '../scope-authority.js';

export interface CreateFileCredentialStoreOptions {
  readonly directory: string;
  readonly sealer: CredentialRecordSealer;
  readonly fileNameKey: Uint8Array;
  readonly clock?: Clock;
  readonly lockTimeoutMs?: number;
}

export function createFileCredentialStore(
  options: CreateFileCredentialStoreOptions,
): CredentialStore {
  if (options.fileNameKey.byteLength < 32)
    throw new TypeError('credential filename key must be at least 32 bytes');
  const clock = options.clock ?? { now: () => Date.now() };
  const lockTimeoutMs = options.lockTimeoutMs ?? 5_000;

  const pathsFor = (scope: CredentialScopeKey) => {
    const name = createHmac('sha256', options.fileNameKey)
      .update(canonicalizeCredentialScope(scope))
      .digest('base64url');
    return {
      record: join(options.directory, `${name}.json`),
      lock: join(options.directory, `${name}.lock`),
    };
  };

  const ensureDirectory = async () => {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    await chmod(options.directory, 0o700);
  };

  const readExisting = async (
    scope: CredentialScopeKey,
  ): Promise<CredentialRecord | undefined> => {
    const { record } = pathsFor(scope);
    try {
      const parsed = JSON.parse(
        await readFile(record, 'utf8'),
      ) as PersistedCredentialRecord;
      return await options.sealer.open(scope, parsed);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  };

  const writeRecord = async (
    scope: CredentialScopeKey,
    record: CredentialRecord,
  ): Promise<void> => {
    const paths = pathsFor(scope);
    const persisted = await options.sealer.seal(scope, record);
    const temp = `${paths.record}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(persisted)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    try {
      await rename(temp, paths.record);
      await chmod(paths.record, 0o600);
    } finally {
      await rm(temp, { force: true });
    }
  };

  const withLock = async <T>(
    scope: CredentialScopeKey,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    await ensureDirectory();
    const { lock } = pathsFor(scope);
    const deadline = Date.now() + lockTimeoutMs;
    for (;;) {
      throwIfAborted(signal);
      try {
        const handle = await open(lock, 'wx', 0o600);
        try {
          return await action();
        } finally {
          await handle.close();
          await rm(lock, { force: true });
        }
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        if (Date.now() >= deadline)
          throw new Error('timed out acquiring credential store lock');
        await sleep(5, signal);
      }
    }
  };

  const materialize = async (
    scope: CredentialScopeKey,
    signal?: AbortSignal,
  ): Promise<CredentialRecord> => {
    throwIfAborted(signal);
    await ensureDirectory();
    const existing = await readExisting(scope);
    if (existing) return existing;
    return withLock(
      scope,
      async () => {
        const raced = await readExisting(scope);
        if (raced) return raced;
        const empty = Object.freeze({
          state: 'empty' as const,
          revision: randomUUID(),
        });
        await writeRecord(scope, empty);
        return empty;
      },
      signal,
    );
  };

  const replaceUnderLock = async (
    scope: CredentialScopeKey,
    record: CredentialRecord,
  ) => {
    await writeRecord(scope, record);
    return record;
  };

  const store: CredentialStore = {
    identityLifetime: 'cross-runtime',
    read: materialize,
    compareAndSet: async (scope, expectedRevision, next, signal) =>
      withLock(
        scope,
        async () => {
          const current =
            (await readExisting(scope)) ??
            Object.freeze({ state: 'empty' as const, revision: randomUUID() });
          if (current.revision !== expectedRevision)
            return { status: 'conflict', current } as const;
          const record = makeUpdatedRecord(next);
          await replaceUnderLock(scope, record);
          return { status: 'applied', record } as const;
        },
        signal,
      ),
    acquireRefreshLease: async (scope, expectedRevision, request, signal) =>
      withLock(
        scope,
        async () => {
          const current = await readRequired(scope);
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
          if (
            !Number.isFinite(request.maxDurationMs) ||
            request.maxDurationMs <= 0
          )
            throw new TypeError('refresh maxDurationMs must be positive');
          const deadline = now + request.maxDurationMs;
          const record = Object.freeze({
            ...current,
            revision: randomUUID(),
            refreshLease: Object.freeze({
              leaseId: randomUUID(),
              ownerId: request.ownerId,
              acquiredAt: now,
              expiresAt: deadline,
              hardDeadlineAt: deadline,
              takeoverNotBefore: deadline,
            }),
          }) as ActiveCredentialRecord;
          await replaceUnderLock(scope, record);
          return {
            status: 'acquired',
            record,
            lease: makeLeaseHandle(record),
          } as const;
        },
        signal,
      ),
    renewRefreshLease: async (scope, lease, signal) =>
      withLock(
        scope,
        async () => {
          const current = await readRequired(scope);
          if (
            !matchesLease(current, lease) ||
            clock.now() >= lease.hardDeadlineAt
          )
            return { status: 'lost', current } as const;
          const record = Object.freeze({
            ...current,
            revision: randomUUID(),
          }) as ActiveCredentialRecord;
          await replaceUnderLock(scope, record);
          return {
            status: 'renewed',
            record,
            lease: makeLeaseHandle(record),
          } as const;
        },
        signal,
      ),
    finishRefresh: async (scope, lease, next, signal) =>
      withLock(
        scope,
        async () => {
          const current = await readRequired(scope);
          if (!matchesLease(current, lease))
            return { status: 'lost', current } as const;
          const withoutLease: Omit<ActiveCredentialRecord, 'refreshLease'> = {
            state: current.state,
            revision: current.revision,
            credential: current.credential,
            credentialInstanceId: current.credentialInstanceId,
            catalogAuth: current.catalogAuth,
            authBinding: current.authBinding,
            authState: current.authState,
          };
          const record = Object.freeze({
            ...withoutLease,
            revision: randomUUID(),
            ...(next.credential ? { credential: next.credential } : {}),
            ...(next.catalogAuth ? { catalogAuth: next.catalogAuth } : {}),
            ...(next.authBinding ? { authBinding: next.authBinding } : {}),
            authState: next.authState,
          }) as ActiveCredentialRecord;
          await replaceUnderLock(scope, record);
          return { status: 'applied', record } as const;
        },
        signal,
      ),
    waitForChange: async (scope, afterRevision, wait, signal) => {
      for (;;) {
        throwIfAborted(signal);
        const current = await materialize(scope, signal);
        if (current.revision !== afterRevision || clock.now() >= wait.notAfter)
          return current;
        await sleep(5, signal);
      }
    },
    now: async (signal) => {
      throwIfAborted(signal);
      return clock.now();
    },
  };

  return Object.freeze(store);

  async function readRequired(scope: CredentialScopeKey) {
    return (
      (await readExisting(scope)) ??
      Object.freeze({ state: 'empty' as const, revision: randomUUID() })
    );
  }
}

function makeUpdatedRecord(next: CredentialRecordUpdate): CredentialRecord {
  return next.state === 'empty'
    ? Object.freeze({ state: 'empty', revision: randomUUID() })
    : Object.freeze({ ...next, revision: randomUUID() });
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

function isNotFound(error: unknown): boolean {
  return isNodeError(error, 'ENOENT');
}

function isAlreadyExists(error: unknown): boolean {
  return isNodeError(error, 'EEXIST');
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
