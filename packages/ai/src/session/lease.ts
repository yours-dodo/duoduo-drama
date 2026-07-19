import type { JsonValue } from '../core/content.js';

export interface SessionResource<T> {
  readonly value: T;
  dispose(): Promise<void> | void;
}

export interface SessionLease<T> {
  readonly value: T;
  release(): Promise<void>;
}

export interface SessionHandle {
  acquire<T>(
    resourceKey: string,
    create: () => Promise<SessionResource<T>>,
    signal?: AbortSignal,
  ): Promise<SessionLease<T>>;
  getAffinity(key: string): JsonValue | undefined;
  setAffinity(key: string, value: JsonValue): void;
}

export interface SessionIdentity {
  readonly providerInstanceId: string;
  readonly protocol: string;
  readonly credentialScopeFingerprint: string;
  readonly credentialInstanceId: string;
  readonly authBindingFingerprint: string;
  readonly providerRegistrationGeneration: string;
  readonly sessionId?: string;
}

export interface SessionCleanupSelector {
  readonly providerInstanceId: string;
  readonly credentialScopeFingerprint: string;
  readonly sessionId: string;
}
