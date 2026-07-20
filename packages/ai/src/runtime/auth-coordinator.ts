import { createHash, randomBytes, randomUUID } from 'node:crypto';

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
import type {
  AuthFlowContext,
  AuthRuntimeOptions,
  OAuthCredential,
  OAuthFlow,
} from '../auth/oauth.js';
import type { CredentialScopeAuthority } from '../auth/scope-authority.js';
import { AiRuntimeError } from '../core/errors.js';
import type { ProviderSnapshot } from '../core/models.js';
import type { ChatTransportBinding, ProviderAuth } from './registry.js';

const REFRESH_LEASE_DURATION_MS = 30_000;
const REFRESH_FAILURE_BACKOFF_MS = 1_000;

export interface ProviderAuthDescription {
  readonly snapshot: ProviderSnapshot;
  readonly transport?: ChatTransportBinding;
  readonly auth?: ProviderAuth;
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
  readonly auth?: AuthRuntimeOptions;
  readonly onCredentialReplaced?: (
    credentialInstanceId: string,
  ) => Promise<void> | void;
  readonly getProvider: (
    providerInstanceId: string,
  ) => ProviderAuthDescription | undefined;
}): AuthCoordinator<TScopeHandle> {
  const refreshLeaseOwnerId = randomUUID();
  const defaultRandom = Object.freeze({
    bytes: (length: number) => randomBytes(length),
  });

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

  const makeFlowContext = (
    provider: ProviderAuthDescription,
    signal?: AbortSignal,
  ): AuthFlowContext => {
    if (!options.auth)
      throw new AiRuntimeError(
        'AUTH_TRANSPORT_UNAVAILABLE',
        'auth',
        'OAuth auth transport and network policy are not configured',
      );
    return Object.freeze({
      provider: provider.snapshot,
      signal: signal ?? new AbortController().signal,
      transport: options.auth.transport,
      networkPolicy: options.auth.networkPolicy,
      clock: Object.freeze({
        now: (clockSignal?: AbortSignal) => options.store.now(clockSignal),
      }),
      random: options.auth.random ?? defaultRandom,
    });
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
      const scope = await resolveScope(
        providerInstanceId,
        handle,
        'manage_auth',
        callOptions?.signal,
      );
      const signal = callOptions?.signal ?? interaction.signal;
      const nextCredential =
        method === 'api_key'
          ? {
              credential: {
                type: 'api_key' as const,
                secret: await promptApiKey(interaction, providerInstanceId),
                scheme:
                  callOptions?.secretScheme ??
                  provider.transport?.credential?.defaultScheme ??
                  'Bearer',
              },
              catalogAuth: { catalogVisibilityFingerprint: 'default' },
            }
          : method === 'oauth'
            ? await requireOAuthFlow(provider).login(
                interaction,
                makeFlowContext(provider, signal),
              )
            : undefined;
      if (!nextCredential)
        throw new AiRuntimeError(
          'AUTH_METHOD_UNSUPPORTED',
          'auth',
          `auth method is not supported: ${method}`,
        );
      const binding = makeAuthBinding(
        provider,
        credentialMetadata(nextCredential.credential),
      );
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const current = await options.store.read(scope, signal);
        const result = await options.store.compareAndSet(
          scope,
          current.revision,
          {
            state: 'active',
            credential: nextCredential.credential,
            credentialInstanceId: randomUUID(),
            catalogAuth: nextCredential.catalogAuth,
            authBinding: binding,
            authState: { status: 'ready' },
          },
          signal,
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
      const provider = requireProvider(options.getProvider(providerInstanceId));
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
        if (result.status !== 'applied') continue;
        await options.onCredentialReplaced?.(current.credentialInstanceId);
        if (!callOptions?.revokeRemote) return logoutResult('removed', false);
        if (
          current.credential.type !== 'oauth' ||
          !provider.auth?.oauth?.revoke
        )
          return logoutResult('removed', true);
        try {
          await provider.auth.oauth.revoke(
            current.credential,
            makeFlowContext(provider, callOptions.signal),
          );
          return Object.freeze({ local: 'removed', remote: 'revoked' });
        } catch {
          return Object.freeze({
            local: 'removed',
            remote: 'failed',
            diagnostics: Object.freeze([
              Object.freeze({
                code: 'REMOTE_REVOKE_FAILED',
                message: 'remote credential revocation failed',
              }),
            ]),
          });
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
      const scope = await resolveScope(
        provider.snapshot.id,
        handle,
        'use',
        signal,
      );
      let active = requireReadyRecord(await options.store.read(scope, signal));
      assertAuthBinding(
        active,
        makeAuthBinding(provider, credentialMetadata(active.credential)),
      );
      if (active.credential.type === 'oauth')
        active = await resolveOAuthCredential(provider, scope, active, signal);
      const override = requestOverride(provider, active);
      return Object.freeze({
        override,
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

  async function resolveOAuthCredential(
    provider: ProviderAuthDescription,
    scope: CredentialScopeKey,
    initial: ActiveCredentialRecord,
    signal?: AbortSignal,
  ): Promise<ActiveCredentialRecord> {
    const flow = requireOAuthFlow(provider);
    let current: CredentialRecord = initial;
    for (;;) {
      const active = requireReadyRecord(current);
      assertAuthBinding(
        active,
        makeAuthBinding(provider, credentialMetadata(active.credential)),
      );
      if (active.credential.type !== 'oauth') return active;
      const now = await options.store.now(signal);
      if (active.credential.expiresAt > now + flow.refreshSkewMs) return active;
      const acquired = await options.store.acquireRefreshLease(
        scope,
        active.revision,
        {
          ownerId: refreshLeaseOwnerId,
          maxDurationMs: REFRESH_LEASE_DURATION_MS,
        },
        signal,
      );
      if (acquired.status === 'acquired') {
        if (acquired.record.credential.type !== 'oauth') {
          current = acquired.record;
          continue;
        }
        current = await refreshAsLeaseOwner(
          provider,
          scope,
          flow,
          acquired.record.credential,
          acquired.lease,
          signal,
        );
        continue;
      }
      if (
        acquired.reason === 'revision_changed' ||
        acquired.reason === 'not_oauth' ||
        acquired.reason === 'reauth_required'
      ) {
        current = acquired.current;
        continue;
      }
      if (acquired.reason !== 'lease_held') {
        current = acquired.current;
        continue;
      }
      current = options.store.waitForChange
        ? await options.store.waitForChange(
            scope,
            acquired.current.revision,
            { notAfter: acquired.retryAt },
            signal,
          )
        : await waitAndRead(scope, acquired.retryAt, signal);
    }
  }

  async function refreshAsLeaseOwner(
    provider: ProviderAuthDescription,
    scope: CredentialScopeKey,
    flow: OAuthFlow,
    credential: OAuthCredential,
    lease: Parameters<CredentialStore['finishRefresh']>[1],
    signal?: AbortSignal,
  ): Promise<CredentialRecord> {
    try {
      const refreshed = await flow.refresh(
        credential,
        makeFlowContext(provider, signal),
      );
      const finished = await options.store.finishRefresh(
        scope,
        lease,
        {
          credential: refreshed.credential,
          catalogAuth: refreshed.catalogAuth,
          authBinding: makeAuthBinding(
            provider,
            credentialMetadata(refreshed.credential),
          ),
          authState: { status: 'ready' },
        },
        signal,
      );
      return finished.status === 'applied' ? finished.record : finished.current;
    } catch (error) {
      const aborted = signal?.aborted === true || isAbortError(error);
      const finished = await options.store.finishRefresh(
        scope,
        lease,
        {
          authState: aborted
            ? { status: 'ready' }
            : {
                status: 'backoff',
                retryAt:
                  (await options.store.now(signal)) +
                  REFRESH_FAILURE_BACKOFF_MS,
                errorCode: errorCode(error, 'OAUTH_REFRESH_FAILED'),
              },
        },
        signal,
      );
      if (finished.status === 'lost') return finished.current;
      throw error;
    }
  }

  async function waitAndRead(
    scope: CredentialScopeKey,
    notAfter: number,
    signal?: AbortSignal,
  ): Promise<CredentialRecord> {
    const now = await options.store.now(signal);
    await sleep(Math.max(0, Math.min(25, notAfter - now)), signal);
    return options.store.read(scope, signal);
  }
}

export function makeAuthBinding(
  provider: ProviderAuthDescription,
  bindingFacts?: Readonly<
    Record<string, import('../core/content.js').JsonValue>
  >,
): AuthBinding {
  const endpoint = provider.transport?.endpoint;
  const origins = endpoint ? [new URL(endpoint).origin] : [];
  const policy = provider.transport?.derivedOriginPolicy;
  if (policy) origins.push(...policy.resolve(bindingFacts));
  const allowedOrigins = Object.freeze(
    [...new Set(origins.map(normalizeAuthOrigin))].sort(),
  );
  const canonical = JSON.stringify([
    '@duoduo/ai/auth-binding',
    1,
    provider.snapshot.kind,
    provider.snapshot.id,
    provider.snapshot.configFingerprint,
    provider.snapshot.authPolicyFingerprint,
    provider.transport?.credential?.headerName.toLowerCase() ?? null,
    provider.transport?.credential?.defaultScheme ?? null,
    provider.transport?.credential?.variants ?? null,
    policy
      ? [policy.id, policy.version, canonicalRecord(policy.configuration)]
      : null,
    allowedOrigins,
  ]);
  return Object.freeze({
    version: 1,
    fingerprint: createHash('sha256').update(canonical).digest('base64url'),
    providerKind: provider.snapshot.kind,
    allowedOrigins,
  });
}

function credentialMetadata(
  credential: ActiveCredentialRecord['credential'],
):
  Readonly<Record<string, import('../core/content.js').JsonValue>> | undefined {
  return credential.type === 'api_key' || credential.type === 'oauth'
    ? credential.metadata
    : undefined;
}

function normalizeAuthOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new AiRuntimeError(
      'INVALID_AUTH_BINDING_ORIGIN',
      'invalid_request',
      'derived authentication origin must be a plain HTTPS origin',
    );
  return url.origin;
}

function canonicalRecord(value: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

async function promptApiKey(
  interaction: AuthInteraction,
  providerInstanceId: string,
) {
  return interaction.promptSecret({
    providerInstanceId,
    method: 'api_key',
    label: 'API key',
  });
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

function requireOAuthFlow(provider: ProviderAuthDescription): OAuthFlow {
  if (!provider.auth?.oauth)
    throw new AiRuntimeError(
      'AUTH_METHOD_UNSUPPORTED',
      'auth',
      'auth method is not supported: oauth',
    );
  return provider.auth.oauth;
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

function assertAuthBinding(
  active: ActiveCredentialRecord,
  binding: AuthBinding,
): void {
  if (active.authBinding.fingerprint !== binding.fingerprint)
    throw new AiRuntimeError(
      'CREDENTIAL_AUTH_BINDING_MISMATCH',
      'auth',
      'stored credential is not valid for the current provider configuration',
    );
}

function requestOverride(
  provider: ProviderAuthDescription,
  active: ActiveCredentialRecord,
): RequestCredentialOverride {
  if (active.credential.type === 'api_key')
    return Object.freeze({
      type: 'api_key',
      secret: active.credential.secret,
      scheme: active.credential.scheme,
    });
  if (active.credential.type === 'oauth')
    return Object.freeze(
      requireOAuthFlow(provider).toRequestAuth(active.credential),
    );
  throw new AiRuntimeError(
    'CREDENTIAL_TYPE_UNSUPPORTED',
    'auth',
    'stored credential type cannot authorize this request',
  );
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

function errorCode(error: unknown, fallback: string): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : fallback;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
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
