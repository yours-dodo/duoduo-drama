import { createHash, randomUUID } from 'node:crypto';

import { AiRuntimeError } from '../core/errors.js';
import type { ProviderSnapshot } from '../core/models.js';
import type { RequestCredentialOverride } from '../auth/api-key.js';
import type {
  ActiveCredentialRecord,
  AuthBinding,
  CredentialRecord,
  CredentialScopeKey,
  CredentialStore,
} from '../auth/credential-store.js';
import type {
  AuthApi,
  AuthInteraction,
  AuthLogoutResult,
  AuthStatus,
} from '../auth/login.js';
import type { CredentialScopeAuthority } from '../auth/scope-authority.js';
import type { ChatTransportBinding } from './registry.js';

export interface ProviderAuthDescription {
  readonly snapshot: ProviderSnapshot;
  readonly transport?: ChatTransportBinding;
}

export interface StoredRequestAuth {
  readonly override: RequestCredentialOverride;
  readonly scope: CredentialScopeKey;
  readonly credentialInstanceId: string;
  readonly authBindingFingerprint: string;
  readonly identityLifetime: 'cross-runtime' | 'process-local';
  readonly scopeFingerprint: string;
}

export interface AuthCoordinator<TScopeHandle> {
  readonly api: AuthApi<TScopeHandle>;
  resolveStoredAuth(
    provider: ProviderAuthDescription,
    scope: TScopeHandle,
    signal?: AbortSignal,
  ): Promise<StoredRequestAuth>;
  assertCurrent(auth: StoredRequestAuth, signal?: AbortSignal): Promise<void>;
}

export function createAuthCoordinator<TScopeHandle>(options: {
  readonly store: CredentialStore;
  readonly scopeAuthority: CredentialScopeAuthority<TScopeHandle>;
  readonly onCredentialReplaced?: (
    credentialInstanceId: string,
  ) => Promise<void> | void;
  readonly getProvider: (
    providerInstanceId: string,
  ) => ProviderAuthDescription | undefined;
}): AuthCoordinator<TScopeHandle> {
  const resolveScope = async (
    providerInstanceId: string,
    handle: TScopeHandle,
    action: 'use' | 'inspect_auth' | 'manage_auth',
    signal?: AbortSignal,
  ) => {
    const scope = await options.scopeAuthority.resolve(
      handle,
      { expectedProviderInstanceId: providerInstanceId, action },
      signal,
    );
    if (scope.providerInstanceId !== providerInstanceId)
      throw new AiRuntimeError(
        'CREDENTIAL_SCOPE_MISMATCH',
        'auth',
        'credential scope provider does not match request',
      );
    return scope;
  };

  const statusFor = (record: CredentialRecord): AuthStatus => {
    if (record.state === 'empty') return { status: 'unconfigured' };
    if (record.authState.status === 'backoff')
      return {
        status: 'backoff',
        retryAt: record.authState.retryAt,
        errorCode: record.authState.errorCode,
      };
    if (record.authState.status === 'reauth_required')
      return {
        status: 'reauth_required',
        errorCode: record.authState.errorCode,
      };
    return {
      status: 'ready',
      source: 'stored',
      method: record.credential.type,
      ...(record.credential.type === 'oauth' &&
      record.credential.providerAccountId
        ? { providerAccountLabel: record.credential.providerAccountId }
        : {}),
    };
  };

  const apiValue: AuthApi<TScopeHandle> = {
    status: async (providerInstanceId, handle, callOptions) => {
      requireProvider(options.getProvider(providerInstanceId));
      const scope = await resolveScope(
        providerInstanceId,
        handle,
        'inspect_auth',
        callOptions?.signal,
      );
      return statusFor(await options.store.read(scope, callOptions?.signal));
    },
    login: async (
      providerInstanceId,
      method,
      handle,
      interaction,
      callOptions,
    ) => {
      const provider = requireProvider(options.getProvider(providerInstanceId));
      if (method !== 'api_key')
        throw new AiRuntimeError(
          'AUTH_METHOD_UNSUPPORTED',
          'auth',
          `auth method is not supported: ${method}`,
        );
      const binding = makeAuthBinding(provider);
      const scope = await resolveScope(
        providerInstanceId,
        handle,
        'manage_auth',
        callOptions?.signal,
      );
      const key = await promptApiKey(interaction, providerInstanceId);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const current = await options.store.read(scope, callOptions?.signal);
        const next = {
          state: 'active' as const,
          credential: {
            type: 'api_key' as const,
            secret: key,
            scheme:
              callOptions?.secretScheme ??
              provider.transport?.credential?.defaultScheme ??
              'Bearer',
          },
          credentialInstanceId: randomUUID(),
          catalogAuth: { catalogVisibilityFingerprint: 'default' },
          authBinding: binding,
          authState: { status: 'ready' as const },
        };
        const result = await options.store.compareAndSet(
          scope,
          current.revision,
          next,
          callOptions?.signal,
        );
        if (result.status === 'applied') {
          if (current.state === 'active')
            await options.onCredentialReplaced?.(current.credentialInstanceId);
          return statusFor(result.record);
        }
      }
      throw new AiRuntimeError(
        'CREDENTIAL_STORE_CONFLICT',
        'auth',
        'credential changed concurrently',
        true,
      );
    },
    logout: async (providerInstanceId, handle, callOptions) => {
      requireProvider(options.getProvider(providerInstanceId));
      const scope = await resolveScope(
        providerInstanceId,
        handle,
        'manage_auth',
        callOptions?.signal,
      );
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const current = await options.store.read(scope, callOptions?.signal);
        if (current.state === 'empty')
          return logoutResult('already_empty', callOptions?.revokeRemote);
        const result = await options.store.compareAndSet(
          scope,
          current.revision,
          { state: 'empty' },
          callOptions?.signal,
        );
        if (result.status === 'applied') {
          await options.onCredentialReplaced?.(current.credentialInstanceId);
          return logoutResult('removed', callOptions?.revokeRemote);
        }
      }
      throw new AiRuntimeError(
        'CREDENTIAL_STORE_CONFLICT',
        'auth',
        'credential changed concurrently',
        true,
      );
    },
  };
  const api = Object.freeze(apiValue);

  const coordinator: AuthCoordinator<TScopeHandle> = {
    api,
    resolveStoredAuth: async (provider, handle, signal) => {
      const binding = makeAuthBinding(provider);
      const scope = await resolveScope(
        provider.snapshot.id,
        handle,
        'use',
        signal,
      );
      const record = await options.store.read(scope, signal);
      const active = requireReadyRecord(record);
      if (active.authBinding.fingerprint !== binding.fingerprint)
        throw new AiRuntimeError(
          'CREDENTIAL_AUTH_BINDING_MISMATCH',
          'auth',
          'stored credential is not valid for the current provider configuration',
        );
      if (active.credential.type !== 'api_key')
        throw new AiRuntimeError(
          'CREDENTIAL_TYPE_UNSUPPORTED',
          'auth',
          'stored credential type cannot authorize this request',
        );
      return Object.freeze({
        override: Object.freeze({
          type: 'api_key' as const,
          secret: active.credential.secret,
          scheme: active.credential.scheme,
        }),
        scope,
        credentialInstanceId: active.credentialInstanceId,
        authBindingFingerprint: active.authBinding.fingerprint,
        identityLifetime:
          options.store.identityLifetime === 'cross-runtime' &&
          options.scopeAuthority.fingerprintLifetime === 'cross-runtime'
            ? 'cross-runtime'
            : 'process-local',
        scopeFingerprint: await options.scopeAuthority.fingerprint(
          scope,
          signal,
        ),
      });
    },
    assertCurrent: async (auth, signal) => {
      const current = await options.store.read(auth.scope, signal);
      if (
        current.state !== 'active' ||
        current.credentialInstanceId !== auth.credentialInstanceId ||
        current.authBinding.fingerprint !== auth.authBindingFingerprint
      )
        throw new AiRuntimeError(
          'CREDENTIAL_HANDLE_STALE',
          'auth',
          'model handle credential is no longer current',
        );
    },
  };
  return Object.freeze(coordinator);
}

export function makeAuthBinding(
  provider: ProviderAuthDescription,
): AuthBinding {
  const endpoint = provider.transport?.endpoint;
  const allowedOrigins = endpoint ? [new URL(endpoint).origin] : [];
  const canonical = JSON.stringify([
    '@duoduo/ai/auth-binding',
    1,
    provider.snapshot.kind,
    provider.snapshot.id,
    provider.snapshot.configFingerprint,
    provider.transport?.credential?.headerName.toLowerCase() ?? null,
    provider.transport?.credential?.defaultScheme ?? null,
    allowedOrigins,
  ]);
  return Object.freeze({
    version: 1,
    fingerprint: createHash('sha256').update(canonical).digest('base64url'),
    providerKind: provider.snapshot.kind,
    allowedOrigins: Object.freeze(allowedOrigins),
  });
}

async function promptApiKey(
  interaction: AuthInteraction,
  providerInstanceId: string,
) {
  const value = await interaction.promptSecret({
    providerInstanceId,
    method: 'api_key',
    label: 'API key',
  });
  return value;
}

function requireProvider(
  provider: ProviderAuthDescription | undefined,
): ProviderAuthDescription {
  if (!provider)
    throw new AiRuntimeError(
      'PROVIDER_NOT_FOUND',
      'invalid_request',
      'provider is not registered',
    );
  if (!provider.transport?.credential)
    throw new AiRuntimeError(
      'AUTH_UNAVAILABLE',
      'auth',
      'provider does not declare a credential binding',
    );
  return provider;
}

function requireReadyRecord(record: CredentialRecord): ActiveCredentialRecord {
  if (record.state === 'empty')
    throw new AiRuntimeError(
      'CREDENTIAL_UNCONFIGURED',
      'auth',
      'no stored credential is configured',
    );
  if (record.authState.status !== 'ready')
    throw new AiRuntimeError(
      record.authState.errorCode,
      'auth',
      'stored credential is not ready',
      record.authState.status === 'backoff',
    );
  return record;
}

function logoutResult(
  local: AuthLogoutResult['local'],
  revokeRemote?: boolean,
): AuthLogoutResult {
  return Object.freeze({
    local,
    remote: revokeRemote ? 'unsupported' : 'not_requested',
  });
}
