import type { JsonValue } from '../core/content.js';
import type { CatalogCacheKey } from './cache-key.js';

export interface CachedCatalog {
  readonly payload: JsonValue;
  readonly storeRevision: string;
  readonly discoveredAt: number;
  readonly expiresAt: number;
  readonly sourceRevision?: string;
  readonly digest: string;
}

export interface CatalogRefreshTicket {
  readonly refreshGeneration: string;
  readonly startedAt: number;
}

export interface CatalogWriteValue {
  readonly payload: JsonValue;
  readonly ttlMs: number;
  readonly sourceRevision?: string;
  readonly digest: string;
}

export type CatalogCommitResult =
  | Readonly<{ status: 'written'; record: CachedCatalog }>
  | Readonly<{ status: 'superseded'; record?: CachedCatalog }>;

export interface CatalogStore {
  read(
    key: CatalogCacheKey,
    signal?: AbortSignal,
  ): Promise<CachedCatalog | undefined>;
  beginRefresh(
    key: CatalogCacheKey,
    signal?: AbortSignal,
  ): Promise<CatalogRefreshTicket>;
  commitRefresh(
    key: CatalogCacheKey,
    ticket: CatalogRefreshTicket,
    value: CatalogWriteValue,
    signal?: AbortSignal,
  ): Promise<CatalogCommitResult>;
  delete(key: CatalogCacheKey, signal?: AbortSignal): Promise<void>;
  now(signal?: AbortSignal): Promise<number>;
}
