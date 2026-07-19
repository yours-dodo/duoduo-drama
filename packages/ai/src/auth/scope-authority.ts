import { AiRuntimeError } from '../core/errors.js';
import type { CredentialIdentityLifetime } from '../core/models.js';
import type { CredentialScopeKey } from './credential-store.js';

export type CredentialScopeAction =
  | 'use'
  | 'inspect_auth'
  | 'manage_auth'
  | 'refresh_catalog'
  | 'cleanup_session'
  | 'resume_operation';

export type CredentialScopeFingerprintVerification =
  | Readonly<{ status: 'verified'; keyId: string }>
  | Readonly<{ status: 'mismatch'; keyId: string }>
  | Readonly<{ status: 'key_unavailable'; keyId: string }>;

export interface CredentialScopeAuthority<TScopeHandle> {
  readonly fingerprintLifetime: CredentialIdentityLifetime;
  resolve(
    handle: TScopeHandle,
    request: Readonly<{
      expectedProviderInstanceId: string;
      action: CredentialScopeAction;
    }>,
    signal?: AbortSignal,
  ): Promise<CredentialScopeKey>;
  fingerprint(scope: CredentialScopeKey, signal?: AbortSignal): Promise<string>;
  verifyFingerprint(
    scope: CredentialScopeKey,
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<CredentialScopeFingerprintVerification>;
}

export function canonicalizeCredentialScope(scope: CredentialScopeKey): string {
  return JSON.stringify([
    '@duoduo/ai/credential-scope',
    1,
    normalizePart(scope.tenantId, 'tenantId'),
    normalizePart(scope.subjectId, 'subjectId'),
    normalizePart(scope.providerInstanceId, 'providerInstanceId'),
    scope.credentialSlotId === undefined
      ? null
      : normalizePart(scope.credentialSlotId, 'credentialSlotId'),
  ]);
}

export function validateResolvedScope(
  scope: CredentialScopeKey,
  expectedProviderInstanceId: string,
): CredentialScopeKey {
  canonicalizeCredentialScope(scope);
  if (scope.providerInstanceId !== expectedProviderInstanceId)
    throw new AiRuntimeError(
      'CREDENTIAL_SCOPE_MISMATCH',
      'auth',
      'credential scope provider does not match request',
    );
  return Object.freeze({ ...scope });
}

function normalizePart(value: string, name: string): string {
  const normalized = value.normalize('NFC');
  if (normalized.length === 0 || normalized.length > 256)
    throw new TypeError(`invalid credential scope ${name}`);
  return normalized;
}
