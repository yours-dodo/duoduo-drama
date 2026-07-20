import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalizeCatalogCacheKey } from '../catalog/cache-key.js';
import type {
  CachedCatalog,
  CatalogStore,
  CatalogWriteValue,
} from '../catalog/catalog-store.js';
import type { CatalogCacheKey } from '../catalog/cache-key.js';
import type { Clock } from '../auth/credential-store.js';

interface PersistedCatalogRecord {
  readonly format: '@duoduo/ai/catalog-cache';
  readonly schemaVersion: 1;
  readonly refreshGeneration: number;
  readonly record?: CachedCatalog;
}

export interface CreateFileCatalogStoreOptions {
  readonly directory: string;
  readonly clock?: Clock;
  readonly lockTimeoutMs?: number;
}

export function createFileCatalogStore(
  options: CreateFileCatalogStoreOptions,
): CatalogStore {
  const clock = options.clock ?? { now: () => Date.now() };
  const lockTimeoutMs = options.lockTimeoutMs ?? 5_000;

  const pathsFor = (key: CatalogCacheKey) => {
    const name = createHash('sha256')
      .update(canonicalizeCatalogCacheKey(key))
      .digest('base64url');
    return Object.freeze({
      record: join(options.directory, `${name}.json`),
      lock: join(options.directory, `${name}.lock`),
    });
  };

  const ensureDirectory = async (): Promise<void> => {
    await rejectSymlinkIfPresent(options.directory);
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const metadata = await stat(options.directory);
    if (!metadata.isDirectory())
      throw new Error('catalog store path is not a directory');
    rejectWrongOwner(metadata.uid);
    await chmod(options.directory, 0o700);
  };

  const readPersisted = async (
    key: CatalogCacheKey,
  ): Promise<PersistedCatalogRecord> => {
    const { record } = pathsFor(key);
    try {
      await rejectSymlinkIfPresent(record);
      const parsed = JSON.parse(await readFile(record, 'utf8')) as unknown;
      return parsePersistedRecord(parsed);
    } catch (error) {
      if (isNotFound(error))
        return Object.freeze({
          format: '@duoduo/ai/catalog-cache',
          schemaVersion: 1,
          refreshGeneration: 0,
        });
      throw error;
    }
  };

  const writePersisted = async (
    key: CatalogCacheKey,
    value: PersistedCatalogRecord,
  ): Promise<void> => {
    const { record } = pathsFor(key);
    const temp = `${record}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(value)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    try {
      await rename(temp, record);
      await chmod(record, 0o600);
    } finally {
      await rm(temp, { force: true });
    }
  };

  const withLock = async <T>(
    key: CatalogCacheKey,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    throwIfAborted(signal);
    await ensureDirectory();
    const { lock } = pathsFor(key);
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
          throw new Error('timed out acquiring catalog store lock');
        await sleep(5, signal);
      }
    }
  };

  const store: CatalogStore = {
    read: async (key, signal) => {
      throwIfAborted(signal);
      await ensureDirectory();
      return (await readPersisted(key)).record;
    },
    beginRefresh: async (key, signal) =>
      withLock(
        key,
        async () => {
          const current = await readPersisted(key);
          const refreshGeneration = current.refreshGeneration + 1;
          await writePersisted(
            key,
            Object.freeze({ ...current, refreshGeneration }),
          );
          return Object.freeze({
            refreshGeneration: String(refreshGeneration),
            startedAt: clock.now(),
          });
        },
        signal,
      ),
    commitRefresh: async (key, ticket, value, signal) =>
      withLock(
        key,
        async () => {
          validateWriteValue(value);
          const current = await readPersisted(key);
          if (String(current.refreshGeneration) !== ticket.refreshGeneration)
            return Object.freeze({
              status: 'superseded' as const,
              ...(current.record ? { record: current.record } : {}),
            });
          const now = clock.now();
          const record: CachedCatalog = Object.freeze({
            payload: value.payload,
            storeRevision: randomUUID(),
            discoveredAt: now,
            expiresAt: now + value.ttlMs,
            ...(value.sourceRevision === undefined
              ? {}
              : { sourceRevision: value.sourceRevision }),
            digest: value.digest,
          });
          await writePersisted(key, Object.freeze({ ...current, record }));
          return Object.freeze({ status: 'written' as const, record });
        },
        signal,
      ),
    delete: async (key, signal) =>
      withLock(
        key,
        async () => {
          await rm(pathsFor(key).record, { force: true });
        },
        signal,
      ),
    now: async (signal) => {
      throwIfAborted(signal);
      return clock.now();
    },
  };
  return Object.freeze(store);
}

function validateWriteValue(value: CatalogWriteValue): void {
  if (!Number.isFinite(value.ttlMs) || value.ttlMs <= 0)
    throw new TypeError('catalog ttlMs must be positive');
  if (!isJsonValue(value.payload))
    throw new TypeError('catalog payload must be public JSON metadata');
  if (!/^[a-f0-9]{32,128}$/iu.test(value.digest))
    throw new TypeError('catalog digest is invalid');
}

function parsePersistedRecord(value: unknown): PersistedCatalogRecord {
  if (!isRecord(value)) throw corruptError();
  if (
    value.format !== '@duoduo/ai/catalog-cache' ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.refreshGeneration) ||
    (value.refreshGeneration as number) < 0
  )
    throw corruptError();
  if (value.record !== undefined && !isCachedCatalog(value.record))
    throw corruptError();
  return Object.freeze({
    format: '@duoduo/ai/catalog-cache',
    schemaVersion: 1,
    refreshGeneration: value.refreshGeneration as number,
    ...(value.record === undefined
      ? {}
      : { record: Object.freeze({ ...value.record }) as CachedCatalog }),
  });
}

function isCachedCatalog(value: unknown): value is CachedCatalog {
  if (!isRecord(value) || !isJsonValue(value.payload)) return false;
  return (
    typeof value.storeRevision === 'string' &&
    Number.isFinite(value.discoveredAt) &&
    Number.isFinite(value.expiresAt) &&
    typeof value.digest === 'string' &&
    (value.sourceRevision === undefined ||
      typeof value.sourceRevision === 'string')
  );
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function rejectSymlinkIfPresent(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink())
      throw new Error('catalog store refuses symbolic links');
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function rejectWrongOwner(uid: number): void {
  if (typeof process.getuid === 'function' && uid !== process.getuid())
    throw new Error('catalog store path has an unexpected owner');
}

function corruptError(): Error {
  return new Error('catalog store record is corrupt');
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
    error.code === code
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

async function sleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
