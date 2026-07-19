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
  } = {},
): SessionManager {
  const sessions = new Map<string, SessionRecord>();
  let disposed = false;

  const open = (identity: SessionIdentity): SessionHandle => {
    if (disposed) throw new Error('session manager is disposed');
    const record = identity.sessionId
      ? getOrCreateSession(sessions, identity)
      : createRecord(identity, true);
    return Object.freeze({
      acquire: <T>(
        resourceKey: string,
        create: () => Promise<SessionResource<T>>,
        signal?: AbortSignal,
      ) => acquire(record, resourceKey, create, signal),
      getAffinity: (key: string) => record.affinity.get(key),
      setAffinity: (key: string, value: JsonValue) => {
        if (disposed || record.closing) throw sessionClosingError();
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

  const manager: SessionManager = {
    open,
    cleanup: async (selector) => {
      await Promise.all(
        [...sessions.values()]
          .filter(
            (record) =>
              record.identity.providerInstanceId ===
                selector.providerInstanceId &&
              record.identity.credentialScopeFingerprint ===
                selector.credentialScopeFingerprint &&
              record.identity.sessionId === selector.sessionId,
          )
          .map(closeRecord),
      );
    },
    cleanupCredential: async (credentialInstanceId) => {
      await Promise.all(
        [...sessions.values()]
          .filter(
            (record) =>
              record.identity.credentialInstanceId === credentialInstanceId,
          )
          .map(closeRecord),
      );
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await Promise.all([...sessions.values()].map(closeRecord));
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
    let resource: SessionResource<unknown>;
    try {
      resource = await entry.creating;
      throwIfAborted(signal);
    } catch (error) {
      entry.refs -= 1;
      if (entry.refs === 0 && record.resources.get(key) === entry)
        record.resources.delete(key);
      throw error;
    }
    let released = false;
    return Object.freeze({
      value: resource.value as T,
      release: async () => {
        if (released) return;
        released = true;
        entry!.refs -= 1;
        if ((record.transient || record.closing) && entry!.refs === 0)
          await disposeEntry(entry!, options.onDisposeError);
      },
    });
  }
}

function getOrCreateSession(
  sessions: Map<string, SessionRecord>,
  identity: SessionIdentity,
): SessionRecord {
  const key = sessionKey(identity);
  const existing = sessions.get(key);
  if (existing) return existing;
  const record = createRecord(identity, false);
  sessions.set(key, record);
  return record;
}

function createRecord(
  identity: SessionIdentity,
  transient: boolean,
): SessionRecord {
  return {
    identity: Object.freeze({ ...identity }),
    resources: new Map(),
    affinity: new Map(),
    transient,
    closing: false,
  };
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
