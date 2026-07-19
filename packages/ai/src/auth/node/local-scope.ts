import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { CredentialScopeKey } from '../credential-store.js';
import {
  canonicalizeCredentialScope,
  type CredentialScopeAuthority,
  validateResolvedScope,
} from '../scope-authority.js';

export interface LocalScopeHandle {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly credentialSlotId?: string;
}

export interface CreateLocalScopeAuthorityOptions extends LocalScopeHandle {
  readonly activeKeyId?: string;
  readonly keys?: Readonly<Record<string, Uint8Array>>;
  readonly fingerprintLifetime?: 'cross-runtime' | 'process-local';
}

export function createLocalScopeAuthority(
  options: CreateLocalScopeAuthorityOptions,
): {
  readonly scope: LocalScopeHandle;
  readonly authority: CredentialScopeAuthority<LocalScopeHandle>;
} {
  const activeKeyId = normalizeKeyId(options.activeKeyId ?? 'process');
  const supplied = options.keys ?? { [activeKeyId]: randomBytes(32) };
  const fingerprintLifetime =
    options.fingerprintLifetime ??
    (options.keys ? 'cross-runtime' : 'process-local');
  const keys = new Map<string, Uint8Array>();
  for (const [keyId, key] of Object.entries(supplied)) {
    normalizeKeyId(keyId);
    if (key.byteLength < 32)
      throw new TypeError('scope fingerprint keys must be at least 32 bytes');
    keys.set(keyId, Uint8Array.from(key));
  }
  if (!keys.has(activeKeyId))
    throw new TypeError('active scope fingerprint key is unavailable');

  const scope = Object.freeze({
    tenantId: options.tenantId,
    subjectId: options.subjectId,
    ...(options.credentialSlotId === undefined
      ? {}
      : { credentialSlotId: options.credentialSlotId }),
  });
  const authorityValue: CredentialScopeAuthority<LocalScopeHandle> = {
    fingerprintLifetime,
    resolve: async (handle, request, signal) => {
      throwIfAborted(signal);
      if (
        handle.tenantId !== scope.tenantId ||
        handle.subjectId !== scope.subjectId ||
        handle.credentialSlotId !== scope.credentialSlotId
      )
        throw new TypeError('unknown local credential scope handle');
      return validateResolvedScope(
        {
          tenantId: handle.tenantId,
          subjectId: handle.subjectId,
          providerInstanceId: request.expectedProviderInstanceId,
          ...(handle.credentialSlotId === undefined
            ? {}
            : { credentialSlotId: handle.credentialSlotId }),
        },
        request.expectedProviderInstanceId,
      );
    },
    fingerprint: async (resolved, signal) => {
      throwIfAborted(signal);
      return `${activeKeyId}.${digest(keys.get(activeKeyId)!, resolved)}`;
    },
    verifyFingerprint: async (resolved, fingerprint, signal) => {
      throwIfAborted(signal);
      const separator = fingerprint.indexOf('.');
      const keyId = separator > 0 ? fingerprint.slice(0, separator) : '';
      const key = keys.get(keyId);
      if (!key) return { status: 'key_unavailable', keyId };
      const expected = Buffer.from(digest(key, resolved), 'base64url');
      let actual: Buffer;
      try {
        actual = Buffer.from(fingerprint.slice(separator + 1), 'base64url');
      } catch {
        return { status: 'mismatch', keyId };
      }
      return actual.byteLength === expected.byteLength &&
        timingSafeEqual(actual, expected)
        ? ({ status: 'verified', keyId } as const)
        : ({ status: 'mismatch', keyId } as const);
    },
  };
  const authority = Object.freeze(authorityValue);
  return Object.freeze({ scope, authority });
}

function digest(key: Uint8Array, scope: CredentialScopeKey): string {
  return createHmac('sha256', key)
    .update(canonicalizeCredentialScope(scope))
    .digest('base64url');
}

function normalizeKeyId(keyId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId))
    throw new TypeError('invalid scope fingerprint key id');
  return keyId;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
