import { AiRuntimeError } from '../core/errors.js';
import type { JsonValue } from '../core/content.js';
import type {
  SessionCleanupSelector,
  SessionHandle,
  SessionIdentity,
  SessionLease,
  SessionResource,
} from './lease.js';

interface ResourceEntry {
  readonly key: string;
  refs: number;
  disposed: boolean;
  creating: Promise<SessionResource<unknown>>;
  resource?: SessionResource<unknown>;
}

interface SessionRecord {
  readonly identity: SessionIdentity;
  readonly resources: Map<string, ResourceEntry>;
  readonly affinity: Map<string, JsonValue>;
  readonly transient: boolean;
  activeLeases: number;
  lastUsedAt: number;
  closing: boolean;
}

export interface SessionManager {
  open(identity: SessionIdentity): SessionHandle;
  cleanup(selector: SessionCleanupSelector): Promise<void>;
  cleanupCredential(credentialInstanceId: string): Promise<void>;
  dispose(): Promise<void>;
}

export function createSessionManager(
  options: {
    readonly onDisposeError?: (error: unknown) => void;
    readonly maxResourcesPerSession?: number;
    readonly maxSessions?: number;
    readonly idleTtlMs?: number;
    readonly clock?: Readonly<{ now(): number }>;
  } = {},
): SessionManager {
  const maxResourcesPerSession = options.maxResourcesPerSession ?? 64;
  if (!Number.isInteger(maxResourcesPerSession) || maxResourcesPerSession < 1)
    throw new TypeError('maxResourcesPerSession must be a positive integer');
  const maxSessions = options.maxSessions ?? 1_000;
  if (!Number.isInteger(maxSessions) || maxSessions < 1)
    throw new TypeError('maxSessions must be a positive integer');
  const idleTtlMs = options.idleTtlMs ?? 15 * 60 * 1_000;
  if (!Number.isInteger(idleTtlMs) || idleTtlMs < 1)
    throw new TypeError('idleTtlMs must be a positive integer');
  const clock = options.clock ?? { now: () => Date.now() };
  const sessions = new Map<string, SessionRecord>();
  const backgroundClosures = new Set<Promise<void>>();
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const open = (identity: SessionIdentity): SessionHandle => {
    if (disposed) throw new Error('session manager is disposed');
    const now = clock.now();
    const record = identity.sessionId
      ? getOrCreateSession(sessions, identity, now, maxSessions, scheduleClose)
      : createRecord(identity, true, now);
    touch(record, now);
    rescheduleExpiry();
    return Object.freeze({
      acquire: <T>(
        resourceKey: string,
        create: () => Promise<SessionResource<T>>,
        signal?: AbortSignal,
      ) => acquire(record, resourceKey, create, signal),
      getAffinity: (key: string) => {
        touch(record, clock.now());
        rescheduleExpiry();
        return record.affinity.get(key);
      },
      setAffinity: (key: string, value: JsonValue) => {
        if (disposed || record.closing) throw sessionClosingError();
        touch(record, clock.now());
        rescheduleExpiry();
        record.affinity.set(key, value);
      },
    });
  };

  const closeRecord = async (record: SessionRecord): Promise<void> => {
    record.closing = true;
    record.affinity.clear();
    await Promise.all(
      [...record.resources.values()]
        .filter((entry) => entry.refs === 0)
        .map((entry) => disposeEntry(entry, options.onDisposeError)),
    );
  };

  const scheduleClose = (record: SessionRecord): void => {
    const closing = closeRecord(record);
    backgroundClosures.add(closing);
    void closing.finally(() => backgroundClosures.delete(closing));
  };

  const rescheduleExpiry = (): void => {
    if (expiryTimer !== undefined) {
      clearTimeout(expiryTimer);
      expiryTimer = undefined;
    }
    if (disposed) return;
    let expiresAt = Number.POSITIVE_INFINITY;
    for (const record of sessions.values()) {
      if (record.closing || record.activeLeases > 0) continue;
      expiresAt = Math.min(expiresAt, record.lastUsedAt + idleTtlMs);
    }
    if (!Number.isFinite(expiresAt)) return;
    expiryTimer = setTimeout(
      () => {
        expiryTimer = undefined;
        const now = clock.now();
        const expired = removeSessions(
          sessions,
          (record) =>
            !record.closing &&
            record.activeLeases === 0 &&
            now - record.lastUsedAt >= idleTtlMs,
        );
        for (const record of expired) scheduleClose(record);
        rescheduleExpiry();
      },
      Math.max(0, expiresAt - clock.now()),
    );
    if (typeof expiryTimer === 'object' && 'unref' in expiryTimer)
      expiryTimer.unref();
  };

  const manager: SessionManager = {
    open,
    cleanup: async (selector) => {
      const matching = removeSessions(
        sessions,
        (record) =>
          record.identity.providerInstanceId === selector.providerInstanceId &&
          record.identity.credentialScopeFingerprint ===
            selector.credentialScopeFingerprint &&
          record.identity.sessionId === selector.sessionId,
      );
      rescheduleExpiry();
      await Promise.all(matching.map(closeRecord));
    },
    cleanupCredential: async (credentialInstanceId) => {
      const matching = removeSessions(
        sessions,
        (record) =>
          record.identity.credentialInstanceId === credentialInstanceId,
      );
      rescheduleExpiry();
      await Promise.all(matching.map(closeRecord));
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      if (expiryTimer !== undefined) {
        clearTimeout(expiryTimer);
        expiryTimer = undefined;
      }
      const records = [...sessions.values()];
      sessions.clear();
      await Promise.all(records.map(closeRecord));
      await Promise.all([...backgroundClosures]);
    },
  };
  return Object.freeze(manager);

  async function acquire<T>(
    record: SessionRecord,
    resourceKey: string,
    create: () => Promise<SessionResource<T>>,
    signal?: AbortSignal,
  ): Promise<SessionLease<T>> {
    throwIfAborted(signal);
    if (disposed || record.closing) throw sessionClosingError();
    const key = normalizeResourceKey(resourceKey);
    let entry = record.resources.get(key);
    if (!entry) {
      if (record.resources.size >= maxResourcesPerSession)
        throw sessionResourceLimitError(maxResourcesPerSession);
      const creating = Promise.resolve()
        .then(create)
        .then((resource) => {
          validateResource(resource);
          return resource as SessionResource<unknown>;
        });
      entry = { key, refs: 0, disposed: false, creating };
      record.resources.set(key, entry);
      creating
        .then((resource) => {
          entry!.resource = resource;
          if ((record.transient || record.closing) && entry!.refs === 0)
            return disposeEntry(entry!, options.onDisposeError);
        })
        .catch(() => {
          if (record.resources.get(key) === entry) record.resources.delete(key);
        });
    }
    entry.refs += 1;
    record.activeLeases += 1;
    touch(record, clock.now());
    rescheduleExpiry();
    let resource: SessionResource<unknown>;
    try {
      resource = await entry.creating;
      throwIfAborted(signal);
    } catch (error) {
      entry.refs -= 1;
      record.activeLeases -= 1;
      touch(record, clock.now());
      rescheduleExpiry();
      if (entry.refs === 0 && record.resources.get(key) === entry) {
        record.resources.delete(key);
        await disposeEntry(entry, options.onDisposeError);
      }
      throw error;
    }
    let released = false;
    return Object.freeze({
      value: resource.value as T,
      release: async () => {
        if (released) return;
        released = true;
        entry!.refs -= 1;
        record.activeLeases -= 1;
        touch(record, clock.now());
        rescheduleExpiry();
        if ((record.transient || record.closing) && entry!.refs === 0)
          await disposeEntry(entry!, options.onDisposeError);
      },
    });
  }
}

function removeSessions(
  sessions: Map<string, SessionRecord>,
  predicate: (record: SessionRecord) => boolean,
): SessionRecord[] {
  const removed: SessionRecord[] = [];
  for (const [key, record] of sessions) {
    if (!predicate(record)) continue;
    sessions.delete(key);
    removed.push(record);
  }
  return removed;
}

function getOrCreateSession(
  sessions: Map<string, SessionRecord>,
  identity: SessionIdentity,
  now: number,
  maxSessions: number,
  closeEvicted: (record: SessionRecord) => void,
): SessionRecord {
  const key = sessionKey(identity);
  const existing = sessions.get(key);
  if (existing) {
    existing.lastUsedAt = now;
    return existing;
  }
  if (sessions.size >= maxSessions) {
    const victim = leastRecentlyUsedIdleSession(sessions);
    if (!victim) throw sessionCapacityError(maxSessions);
    sessions.delete(victim[0]);
    closeEvicted(victim[1]);
  }
  const record = createRecord(identity, false, now);
  sessions.set(key, record);
  return record;
}

function leastRecentlyUsedIdleSession(
  sessions: Map<string, SessionRecord>,
): [string, SessionRecord] | undefined {
  let victim: [string, SessionRecord] | undefined;
  for (const entry of sessions) {
    const record = entry[1];
    if (record.closing || record.activeLeases > 0) continue;
    if (!victim || record.lastUsedAt < victim[1].lastUsedAt) victim = entry;
  }
  return victim;
}

function createRecord(
  identity: SessionIdentity,
  transient: boolean,
  now: number,
): SessionRecord {
  return {
    identity: Object.freeze({ ...identity }),
    resources: new Map(),
    affinity: new Map(),
    transient,
    activeLeases: 0,
    lastUsedAt: now,
    closing: false,
  };
}

function touch(record: SessionRecord, now: number): void {
  if (!record.closing) record.lastUsedAt = now;
}

function sessionKey(identity: SessionIdentity): string {
  return JSON.stringify([
    identity.providerInstanceId,
    identity.protocol,
    identity.credentialScopeFingerprint,
    identity.credentialInstanceId,
    identity.authBindingFingerprint,
    identity.providerRegistrationGeneration,
    identity.sessionId,
  ]);
}

async function disposeEntry(
  entry: ResourceEntry,
  onError?: (error: unknown) => void,
): Promise<void> {
  if (entry.disposed) return;
  entry.disposed = true;
  try {
    const resource = entry.resource ?? (await entry.creating);
    await resource.dispose();
  } catch (error) {
    onError?.(error);
  }
}

function validateResource<T>(resource: SessionResource<T>): void {
  if (!resource || typeof resource.dispose !== 'function')
    throw new TypeError('session resource must define dispose()');
}

function normalizeResourceKey(value: string): string {
  const key = value.trim();
  if (!key) throw new TypeError('session resource key must not be empty');
  return key;
}

function sessionClosingError(): AiRuntimeError {
  return new AiRuntimeError(
    'SESSION_CLOSING',
    'invalid_request',
    'session is closing',
  );
}

function sessionResourceLimitError(limit: number): AiRuntimeError {
  return new AiRuntimeError(
    'SESSION_RESOURCE_LIMIT',
    'internal',
    `session resource limit exceeded (${limit})`,
  );
}

function sessionCapacityError(limit: number): AiRuntimeError {
  return new AiRuntimeError(
    'SESSION_CAPACITY_EXCEEDED',
    'internal',
    `session capacity exceeded (${limit})`,
    true,
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
