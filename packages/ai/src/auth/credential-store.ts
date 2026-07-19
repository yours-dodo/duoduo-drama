import type { JsonValue } from '../core/content.js';
import type {
  CredentialIdentityLifetime,
  ProviderInstanceId,
} from '../core/models.js';
import type { SecretValue } from './secret-value.js';

export interface CatalogAuthView {
  readonly catalogVisibilityFingerprint: string;
  readonly visibleModelIds?: readonly string[];
  readonly publicMetadata?: Readonly<Record<string, JsonValue>>;
}

export type Credential =
  | Readonly<{
      type: 'api_key';
      secret: SecretValue;
      scheme: string;
      metadata?: Readonly<Record<string, JsonValue>>;
    }>
  | Readonly<{
      type: 'oauth';
      accessToken: SecretValue;
      refreshToken: SecretValue;
      expiresAt: number;
      providerAccountId?: string;
      metadata?: Readonly<Record<string, JsonValue>>;
    }>
  | Readonly<{
      type: 'ambient_config';
      config: Readonly<Record<string, string | SecretValue>>;
    }>;

export interface CredentialScopeKey {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly credentialSlotId?: string;
}

export interface AuthBinding {
  readonly version: 1;
  readonly fingerprint: string;
  readonly providerKind: string;
  readonly allowedOrigins: readonly string[];
  readonly issuer?: string;
  readonly audience?: string;
}

export type CredentialRevision = string;

export interface RefreshLease {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  readonly hardDeadlineAt: number;
  readonly takeoverNotBefore: number;
}

export type CredentialAuthState =
  | Readonly<{ status: 'ready' }>
  | Readonly<{ status: 'backoff'; retryAt: number; errorCode: string }>
  | Readonly<{ status: 'reauth_required'; errorCode: string }>;

export interface EmptyCredentialRecord {
  readonly state: 'empty';
  readonly revision: CredentialRevision;
}

export interface ActiveCredentialRecord {
  readonly state: 'active';
  readonly revision: CredentialRevision;
  readonly credential: Credential;
  readonly credentialInstanceId: string;
  readonly catalogAuth: CatalogAuthView;
  readonly authBinding: AuthBinding;
  readonly authState: CredentialAuthState;
  readonly refreshLease?: RefreshLease;
}

export type CredentialRecord = EmptyCredentialRecord | ActiveCredentialRecord;

export type CredentialRecordUpdate =
  | Readonly<{ state: 'empty' }>
  | Readonly<{
      state: 'active';
      credential: Credential;
      credentialInstanceId: string;
      catalogAuth: CatalogAuthView;
      authBinding: AuthBinding;
      authState: CredentialAuthState;
    }>;

export type CredentialCasResult =
  | Readonly<{ status: 'applied'; record: CredentialRecord }>
  | Readonly<{ status: 'conflict'; current: CredentialRecord }>;

export interface RefreshLeaseHandle {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly revision: CredentialRevision;
  readonly credentialInstanceId: string;
  readonly authBindingFingerprint: string;
  readonly expiresAt: number;
  readonly hardDeadlineAt: number;
  readonly takeoverNotBefore: number;
}

export type RefreshLeaseAcquireResult =
  | Readonly<{
      status: 'acquired';
      record: ActiveCredentialRecord;
      lease: RefreshLeaseHandle;
    }>
  | Readonly<{
      status: 'not_acquired';
      reason: 'lease_held' | 'backoff';
      current: CredentialRecord;
      retryAt: number;
    }>
  | Readonly<{
      status: 'not_acquired';
      reason: 'revision_changed' | 'reauth_required' | 'not_oauth';
      current: CredentialRecord;
    }>;

export type RefreshLeaseRenewResult =
  | Readonly<{
      status: 'renewed';
      record: ActiveCredentialRecord;
      lease: RefreshLeaseHandle;
    }>
  | Readonly<{ status: 'lost'; current: CredentialRecord }>;

export interface RefreshRecordUpdate {
  readonly credential?: Extract<Credential, { type: 'oauth' }>;
  readonly catalogAuth?: CatalogAuthView;
  readonly authState: CredentialAuthState;
}

export type RefreshLeaseFinishResult =
  | Readonly<{ status: 'applied'; record: ActiveCredentialRecord }>
  | Readonly<{ status: 'lost'; current: CredentialRecord }>;

export interface CredentialStore {
  readonly identityLifetime: CredentialIdentityLifetime;
  read(
    scope: CredentialScopeKey,
    signal?: AbortSignal,
  ): Promise<CredentialRecord>;
  compareAndSet(
    scope: CredentialScopeKey,
    expectedRevision: CredentialRevision,
    next: CredentialRecordUpdate,
    signal?: AbortSignal,
  ): Promise<CredentialCasResult>;
  acquireRefreshLease(
    scope: CredentialScopeKey,
    expectedRevision: CredentialRevision,
    request: Readonly<{ ownerId: string; maxDurationMs: number }>,
    signal?: AbortSignal,
  ): Promise<RefreshLeaseAcquireResult>;
  renewRefreshLease(
    scope: CredentialScopeKey,
    lease: RefreshLeaseHandle,
    signal?: AbortSignal,
  ): Promise<RefreshLeaseRenewResult>;
  finishRefresh(
    scope: CredentialScopeKey,
    lease: RefreshLeaseHandle,
    next: RefreshRecordUpdate,
    signal?: AbortSignal,
  ): Promise<RefreshLeaseFinishResult>;
  waitForChange?(
    scope: CredentialScopeKey,
    afterRevision: CredentialRevision,
    options: Readonly<{ notAfter: number }>,
    signal?: AbortSignal,
  ): Promise<CredentialRecord>;
  now(signal?: AbortSignal): Promise<number>;
}

export interface Clock {
  now(): number;
}
