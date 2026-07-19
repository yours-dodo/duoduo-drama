import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { AiRuntimeError, type AiError } from '../core/errors.js';
import type { RequestCredentialOverride } from '../auth/api-key.js';
import { credentialScheme } from '../auth/api-key.js';
import type { CredentialOverridePolicy } from '../auth/override-policy.js';
import type { CredentialStore } from '../auth/credential-store.js';
import type { AuthApi } from '../auth/login.js';
import type { CredentialScopeAuthority } from '../auth/scope-authority.js';
import { revealSecret } from '../auth/secret-value.js';
import { validateContext } from '../core/context.js';
import { parseToolArguments } from '../core/tools.js';
import { AttemptLocalSink } from '../stream/attempt-sink.js';
import type {
  AiResponseStream,
  AiStreamEvent,
  AssistantResponse,
  ChatRequest,
  ProtocolTerminal,
  ResolvedStreamOptions,
} from '../core/events.js';
import type { AiContext } from '../core/messages.js';
import type {
  ModelDefinition,
  ModelHandle,
  ModelRef,
  ProviderSnapshot,
} from '../core/models.js';
import { createSessionManager } from '../session/manager.js';
import type { SessionHandle } from '../session/lease.js';
import { ResponseStream } from '../stream/response-stream.js';
import type { RetryPolicy } from '../transport/retry.js';
import type { NetworkPolicy, TransportDriver } from '../transport/types.js';
import {
  bindRequestTransport,
  createFinalRequestTarget,
  createSecretHeaderValue,
} from '../transport/request-transport.js';
import {
  ProviderRegistry,
  type Provider,
  type ProvidersApi,
} from './registry.js';
import {
  createAuthCoordinator,
  makeAuthBinding,
  type AuthCoordinator,
  type StoredRequestAuth,
} from './auth-coordinator.js';

const handleProvider = new WeakMap<object, string>();
const handleRuntime = new WeakMap<object, symbol>();
const handleCredentialFingerprint = new WeakMap<object, string>();
const handleSessionScopeFingerprint = new WeakMap<object, string>();
const handleStoredAuth = new WeakMap<object, StoredRequestAuth>();

export interface StreamOptionsInput {
  readonly signal?: AbortSignal;
  readonly maxOutputTokens?: number;
  readonly stop?: readonly string[];
  readonly timeoutMs?: number;
  readonly protocolOptions?: Readonly<Record<string, unknown>>;
  readonly credentialOverride?: RequestCredentialOverride;
  readonly retry?: false | RetryPolicy;
  readonly sessionId?: string;
}

export interface ModelListFilter {
  readonly providerInstanceId?: string;
  readonly protocol?: string;
  readonly input?: 'text' | 'image';
}

export interface ModelReadOptions {
  readonly allowNetwork?: boolean;
  readonly force?: boolean;
  readonly signal?: AbortSignal;
  readonly credentialOverride?: RequestCredentialOverride;
}

export interface ModelsApi<TScopeHandle> {
  find<TProtocol extends string>(
    ref: ModelRef<TProtocol>,
    scope: TScopeHandle,
    options?: ModelReadOptions,
  ): Promise<ModelHandle<TProtocol> | undefined>;
  require<TProtocol extends string>(
    ref: ModelRef<TProtocol>,
    scope: TScopeHandle,
    options?: ModelReadOptions,
  ): Promise<ModelHandle<TProtocol>>;
  list(
    scope: TScopeHandle,
    filter?: ModelListFilter,
    options?: ModelReadOptions,
  ): Promise<{ models: readonly ModelHandle[] }>;
}

export interface InventoryApi {
  readonly models: {
    find<TProtocol extends string>(
      ref: ModelRef<TProtocol>,
    ): Promise<
      | {
          definition: Readonly<ModelDefinition<TProtocol>>;
          source: 'static';
          availability: 'unknown';
        }
      | undefined
    >;
    list(filter?: ModelListFilter): Promise<
      readonly {
        definition: Readonly<ModelDefinition>;
        source: 'static';
        availability: 'unknown';
      }[]
    >;
  };
}

export interface SessionsApi<TScopeHandle> {
  cleanup(
    providerInstanceId: string,
    scope: TScopeHandle,
    sessionId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<void>;
}

export interface AiRuntime<TScopeHandle = unknown> {
  readonly providers: ProvidersApi;
  readonly inventory: InventoryApi;
  readonly auth: AuthApi<TScopeHandle>;
  readonly models: ModelsApi<TScopeHandle>;
  readonly sessions: SessionsApi<TScopeHandle>;
  stream<TProtocol extends string>(
    model: ModelHandle<TProtocol>,
    context: AiContext,
    options?: StreamOptionsInput,
  ): AiResponseStream;
  complete<TProtocol extends string>(
    model: ModelHandle<TProtocol>,
    context: AiContext,
    options?: StreamOptionsInput,
  ): Promise<AssistantResponse>;
  dispose(): Promise<void>;
}

export interface RuntimeResourcePolicyInput {
  readonly streamQueue?: Readonly<{
    readonly maxEvents?: number;
    readonly maxBytes?: number;
  }>;
}

export interface CreateAiOptions<TScopeHandle = unknown> {
  readonly commonDefaults?: Readonly<{
    maxOutputTokens?: number;
    timeoutMs?: number;
    retry?: false | RetryPolicy;
  }>;
  readonly scope?: TScopeHandle;
  readonly resourcePolicy?: RuntimeResourcePolicyInput;
  readonly transport?: TransportDriver;
  readonly networkPolicy?: NetworkPolicy;
  readonly credentialOverridePolicy?: CredentialOverridePolicy<TScopeHandle>;
  readonly credentialStore?: CredentialStore;
  readonly scopeAuthority?: CredentialScopeAuthority<TScopeHandle>;
}

interface BlockState {
  readonly kind: 'text' | 'reasoning' | 'tool_call';
  readonly itemId: string;
  readonly contentIndex: number;
  text: string;
  name: string;
  toolCallId: string;
  rawArguments: string;
  closed: boolean;
  replay?: import('../core/content.js').ReplayMetadata;
  toolCall?: import('../core/content.js').ToolCallContent;
}

export function createAi<TScopeHandle = unknown>(
  options: CreateAiOptions<TScopeHandle> = {},
): AiRuntime<TScopeHandle> {
  const registry = new ProviderRegistry();
  const sessionManager = createSessionManager();
  const runtimeId = Symbol('duoduo-ai-runtime');
  const credentialFingerprintKey = randomBytes(32);
  const runtimeScopeFingerprint = createRuntimeScopeFingerprinter();
  if (
    (options.credentialStore === undefined) !==
    (options.scopeAuthority === undefined)
  )
    throw new TypeError(
      'credentialStore and scopeAuthority must be configured together',
    );
  const authCoordinator =
    options.credentialStore && options.scopeAuthority
      ? createAuthCoordinator({
          store: options.credentialStore,
          scopeAuthority: options.scopeAuthority,
          onCredentialReplaced: (credentialInstanceId) =>
            sessionManager.cleanupCredential(credentialInstanceId),
          getProvider: (providerInstanceId) => {
            const entry = registry.get(providerInstanceId);
            return entry
              ? {
                  snapshot: entry.snapshot,
                  transport: entry.provider.chat?.transport,
                }
              : undefined;
          },
        })
      : undefined;
  let disposed = false;

  const inventory: InventoryApi = {
    models: {
      find: async <TProtocol extends string>(ref: ModelRef<TProtocol>) => {
        const definition = registry
          .models()
          .find((candidate) => sameRef(candidate, ref));
        return definition
          ? {
              definition: definition as ModelDefinition<TProtocol>,
              source: 'static' as const,
              availability: 'unknown' as const,
            }
          : undefined;
      },
      list: async (filter) =>
        registry
          .models()
          .filter((model) => matchesFilter(model, filter))
          .map((definition) => ({
            definition,
            source: 'static' as const,
            availability: 'unknown' as const,
          })),
    },
  };

  const models: ModelsApi<TScopeHandle> = {
    find: async <TProtocol extends string>(
      ref: ModelRef<TProtocol>,
      scope: TScopeHandle,
      readOptions?: ModelReadOptions,
    ) => {
      const entry = registry.get(ref.providerInstanceId);
      const definition = entry?.provider.chat?.models.find((model) =>
        sameRef(model, ref),
      );
      if (!definition || !entry) return undefined;
      const resolvedAuth = await resolveModelAuth({
        chat: entry.provider.chat,
        provider: entry.snapshot,
        scope,
        override: readOptions?.credentialOverride,
        policy: options.credentialOverridePolicy,
        key: credentialFingerprintKey,
        coordinator: authCoordinator,
        signal: readOptions?.signal,
      });
      const sessionScopeFingerprint = await resolveSessionScopeFingerprint({
        providerInstanceId: entry.snapshot.id,
        scope,
        storedAuth: resolvedAuth.storedAuth,
        scopeAuthority: options.scopeAuthority,
        runtimeScopeFingerprint,
        signal: readOptions?.signal,
      });
      return makeHandle<TProtocol>(
        definition as ModelDefinition<TProtocol>,
        entry.snapshot,
        runtimeId,
        sessionScopeFingerprint,
        resolvedAuth.credentialFingerprint,
        resolvedAuth.storedAuth,
      );
    },
    require: async <TProtocol extends string>(
      ref: ModelRef<TProtocol>,
      scope: TScopeHandle,
      readOptions?: ModelReadOptions,
    ) => {
      const model = await models.find(ref, scope, readOptions);
      if (!model)
        throw new AiRuntimeError(
          'MODEL_NOT_FOUND',
          'invalid_request',
          `model not found: ${ref.providerInstanceId}/${ref.modelId}`,
        );
      return model;
    },
    list: async (scope, filter, readOptions) => {
      if (readOptions?.credentialOverride && !filter?.providerInstanceId)
        throw new AiRuntimeError(
          'CREDENTIAL_OVERRIDE_PROVIDER_REQUIRED',
          'invalid_request',
          'providerInstanceId is required when listing with a credential override',
        );
      const handles: ModelHandle[] = [];
      for (const snapshot of registry.list()) {
        if (
          filter?.providerInstanceId &&
          filter.providerInstanceId !== snapshot.id
        )
          continue;
        const entry = registry.get(snapshot.id);
        if (!entry) continue;
        const resolvedAuth = await resolveModelAuth({
          chat: entry.provider.chat,
          provider: snapshot,
          scope,
          override: readOptions?.credentialOverride,
          policy: options.credentialOverridePolicy,
          key: credentialFingerprintKey,
          coordinator: authCoordinator,
          signal: readOptions?.signal,
        });
        const sessionScopeFingerprint = await resolveSessionScopeFingerprint({
          providerInstanceId: snapshot.id,
          scope,
          storedAuth: resolvedAuth.storedAuth,
          scopeAuthority: options.scopeAuthority,
          runtimeScopeFingerprint,
          signal: readOptions?.signal,
        });
        for (const model of entry.provider.chat?.models ?? []) {
          if (matchesFilter(model, filter))
            handles.push(
              makeHandle(
                model,
                snapshot,
                runtimeId,
                sessionScopeFingerprint,
                resolvedAuth.credentialFingerprint,
                resolvedAuth.storedAuth,
              ),
            );
        }
      }
      return { models: handles };
    },
  };

  const runtime: AiRuntime<TScopeHandle> = {
    providers: registry,
    inventory,
    auth: authCoordinator?.api ?? createUnavailableAuthApi(),
    models,
    sessions: Object.freeze({
      cleanup: async (
        providerInstanceId: string,
        scope: TScopeHandle,
        sessionId: string,
        callOptions?: { readonly signal?: AbortSignal },
      ) => {
        if (!options.scopeAuthority)
          throw new AiRuntimeError(
            'SESSION_CLEANUP_UNAVAILABLE',
            'auth',
            'scopeAuthority is required to clean up a persistent session',
          );
        const resolvedScope = await options.scopeAuthority.resolve(
          scope,
          { expectedProviderInstanceId: providerInstanceId, action: 'use' },
          callOptions?.signal,
        );
        const scopeFingerprint = await options.scopeAuthority.fingerprint(
          resolvedScope,
          callOptions?.signal,
        );
        await sessionManager.cleanup({
          providerInstanceId,
          credentialScopeFingerprint: scopeFingerprint,
          sessionId,
        });
      },
    }),
    stream: (model, context, streamOptions) => {
      if (disposed)
        throw new AiRuntimeError(
          'RUNTIME_DISPOSED',
          'invalid_request',
          'runtime is disposed',
        );
      const providerId = handleProvider.get(model as object);
      if (
        providerId === undefined ||
        handleRuntime.get(model as object) !== runtimeId
      ) {
        throw new AiRuntimeError(
          'MODEL_HANDLE_INVALID',
          'invalid_request',
          'model handle was not created by this runtime',
        );
      }
      const entry = registry.get(providerId);
      if (
        !entry ||
        entry.snapshot.registrationGeneration !==
          model.identity.providerRegistrationGeneration
      ) {
        throw new AiRuntimeError(
          'MODEL_HANDLE_STALE',
          'invalid_request',
          'model handle belongs to an unregistered provider',
        );
      }
      const chat = entry.provider.chat;
      if (!chat)
        throw new AiRuntimeError(
          'PROVIDER_CAPABILITY_UNAVAILABLE',
          'invalid_request',
          'provider does not support chat',
        );
      const resolved = resolveOptions(
        model.definition,
        streamOptions,
        options.commonDefaults,
      );
      const stream = new ResponseStream(
        async (ownedStream) => {
          await runChat({
            chat,
            providerSnapshot: entry.snapshot,
            model,
            context,
            resolved,
            credentialOverride: streamOptions?.credentialOverride,
            credentialFingerprintKey,
            storedAuth: handleStoredAuth.get(model as object),
            authCoordinator,
            driver: options.transport,
            networkPolicy: options.networkPolicy,
            sessionManager,
            stream: ownedStream,
          });
        },
        {
          observerMaxItems: options.resourcePolicy?.streamQueue?.maxEvents,
          observerMaxBytes: options.resourcePolicy?.streamQueue?.maxBytes,
        },
      );
      if (streamOptions?.signal) {
        if (streamOptions.signal.aborted) stream.abort('caller aborted');
        else
          streamOptions.signal.addEventListener(
            'abort',
            () => stream.abort('caller aborted'),
            { once: true },
          );
      }
      return stream;
    },
    complete: (model, context, streamOptions) => {
      const stream = runtime.stream(model, context, streamOptions);
      return stream.result();
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      credentialFingerprintKey.fill(0);
      await sessionManager.dispose();
      await options.transport?.dispose?.();
    },
  };

  return runtime;
}

function makeHandle<TProtocol extends string>(
  definition: ModelDefinition<TProtocol>,
  snapshot: ProviderSnapshot,
  runtimeId: symbol,
  sessionScopeFingerprint: string,
  credentialFingerprint?: string,
  storedAuth?: StoredRequestAuth,
): ModelHandle<TProtocol> {
  const handle = Object.freeze({
    ref: Object.freeze({
      providerInstanceId: definition.providerInstanceId,
      modelId: definition.id,
      protocol: definition.protocol,
    }),
    definition: Object.freeze(definition),
    identity: Object.freeze({
      providerRegistrationGeneration: snapshot.registrationGeneration,
      providerConfigFingerprint: snapshot.configFingerprint,
    }),
  });
  handleProvider.set(handle, definition.providerInstanceId);
  handleRuntime.set(handle, runtimeId);
  handleSessionScopeFingerprint.set(handle, sessionScopeFingerprint);
  if (credentialFingerprint !== undefined)
    handleCredentialFingerprint.set(handle, credentialFingerprint);
  if (storedAuth !== undefined) handleStoredAuth.set(handle, storedAuth);
  return handle;
}

function sameRef<TProtocol extends string>(
  model: ModelDefinition<TProtocol>,
  ref: ModelRef<TProtocol>,
): boolean {
  return (
    model.providerInstanceId === ref.providerInstanceId &&
    model.id === ref.modelId &&
    (ref.protocol === undefined || model.protocol === ref.protocol)
  );
}

function matchesFilter(
  model: ModelDefinition,
  filter: ModelListFilter | undefined,
): boolean {
  return (
    (filter?.providerInstanceId === undefined ||
      filter.providerInstanceId === model.providerInstanceId) &&
    (filter?.protocol === undefined || filter.protocol === model.protocol) &&
    (filter?.input === undefined ||
      model.capabilities.input.includes(filter.input))
  );
}

function resolveOptions<TProtocol extends string>(
  model: ModelDefinition<TProtocol>,
  input: StreamOptionsInput | undefined,
  defaults: CreateAiOptions['commonDefaults'],
): ResolvedStreamOptions<TProtocol> {
  const controller = new AbortController();
  const timeoutMs = input?.timeoutMs ?? defaults?.timeoutMs ?? 30_000;
  const maxOutputTokens =
    input?.maxOutputTokens ??
    model.limits.maxOutputTokens ??
    defaults?.maxOutputTokens ??
    4096;
  return {
    signal: controller.signal,
    maxOutputTokens,
    stop: input?.stop ?? model.requestDefaults?.stop ?? [],
    timeoutMs,
    retry: input?.retry ?? defaults?.retry ?? false,
    ...(input?.sessionId ? { sessionId: input.sessionId } : {}),
    protocolOptions: (input?.protocolOptions ??
      {}) as ResolvedStreamOptions<TProtocol>['protocolOptions'],
  };
}

async function resolveModelAuth<TScopeHandle>(input: {
  chat: Provider['chat'];
  provider: ProviderSnapshot;
  scope: TScopeHandle;
  override?: RequestCredentialOverride;
  policy?: CredentialOverridePolicy<TScopeHandle>;
  key: Uint8Array;
  coordinator?: ReturnType<typeof createAuthCoordinator<TScopeHandle>>;
  signal?: AbortSignal;
}): Promise<{
  credentialFingerprint?: string;
  storedAuth?: StoredRequestAuth;
}> {
  if (!input.chat?.transport?.credential) return {};
  if (input.override)
    return {
      credentialFingerprint: await authorizeCredentialOverride(input),
    };
  if (!input.coordinator)
    return {
      credentialFingerprint: await authorizeCredentialOverride(input),
    };
  const storedAuth = await input.coordinator.resolveStoredAuth(
    { snapshot: input.provider, transport: input.chat.transport },
    input.scope,
    input.signal,
  );
  return {
    credentialFingerprint: fingerprintCredential(
      storedAuth.override,
      input.key,
    ),
    storedAuth,
  };
}

async function resolveSessionScopeFingerprint<TScopeHandle>(input: {
  providerInstanceId: string;
  scope: TScopeHandle;
  storedAuth?: StoredRequestAuth;
  scopeAuthority?: CredentialScopeAuthority<TScopeHandle>;
  runtimeScopeFingerprint(scope: TScopeHandle): string;
  signal?: AbortSignal;
}): Promise<string> {
  if (input.storedAuth) return input.storedAuth.scopeFingerprint;
  if (!input.scopeAuthority) return input.runtimeScopeFingerprint(input.scope);
  const resolvedScope = await input.scopeAuthority.resolve(
    input.scope,
    {
      expectedProviderInstanceId: input.providerInstanceId,
      action: 'use',
    },
    input.signal,
  );
  return input.scopeAuthority.fingerprint(resolvedScope, input.signal);
}

function createRuntimeScopeFingerprinter<TScopeHandle>(): (
  scope: TScopeHandle,
) => string {
  const objectFingerprints = new WeakMap<object, string>();
  const primitiveFingerprints = new Map<unknown, string>();
  let nextId = 0;
  return (scope) => {
    const isObject =
      (typeof scope === 'object' && scope !== null) ||
      typeof scope === 'function';
    const fingerprints = isObject ? objectFingerprints : primitiveFingerprints;
    const key = scope as object & TScopeHandle;
    const existing = fingerprints.get(key);
    if (existing) return existing;
    const fingerprint = `runtime-scope-${++nextId}`;
    fingerprints.set(key, fingerprint);
    return fingerprint;
  };
}

function createUnavailableAuthApi<TScopeHandle>(): AuthApi<TScopeHandle> {
  const unavailable = () =>
    Promise.reject(
      new AiRuntimeError(
        'AUTH_PERSISTENCE_UNAVAILABLE',
        'auth',
        'credentialStore and scopeAuthority are not configured',
      ),
    );
  return Object.freeze({
    status: unavailable,
    login: unavailable,
    logout: unavailable,
  }) as AuthApi<TScopeHandle>;
}

async function authorizeCredentialOverride<TScopeHandle>(input: {
  chat: Provider['chat'];
  provider: ProviderSnapshot;
  scope: TScopeHandle;
  override?: RequestCredentialOverride;
  policy?: CredentialOverridePolicy<TScopeHandle>;
  key: Uint8Array;
}): Promise<string | undefined> {
  if (!input.chat?.transport?.credential) return undefined;
  if (!input.override)
    throw new AiRuntimeError(
      'CREDENTIAL_OVERRIDE_REQUIRED',
      'auth',
      'a request credential override is required for this provider',
    );
  const allowed = await input.policy?.allow(input.scope, input.provider, {
    type: input.override.type,
    scheme: input.override.scheme,
  });
  if (allowed !== true)
    throw new AiRuntimeError(
      'CREDENTIAL_OVERRIDE_DENIED',
      'auth',
      'request credential override is not allowed',
    );
  return fingerprintCredential(input.override, input.key);
}

function fingerprintCredential(
  override: RequestCredentialOverride,
  key: Uint8Array,
): string {
  return createHmac('sha256', key)
    .update(override.type)
    .update('\0')
    .update(credentialScheme(override))
    .update('\0')
    .update(revealSecret(override.secret))
    .digest('base64url');
}

function credentialFingerprintsEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'base64url');
  const rightBytes = Buffer.from(right, 'base64url');
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function resolveRequestTransport(input: {
  chat: NonNullable<Provider['chat']>;
  providerSnapshot: ProviderSnapshot;
  model: ModelHandle;
  credentialOverride?: RequestCredentialOverride;
  credentialFingerprintKey: Uint8Array;
  driver?: TransportDriver;
  networkPolicy?: NetworkPolicy;
  retry: false | RetryPolicy;
}):
  | import('../transport/types.js').RequestTransport
  | undefined
  | AiRuntimeError {
  const binding = input.chat.transport;
  if (!binding) return undefined;
  const expectedFingerprint = handleCredentialFingerprint.get(
    input.model as object,
  );
  const override = input.credentialOverride;
  if (binding.credential) {
    if (!override || expectedFingerprint === undefined)
      return new AiRuntimeError(
        'CREDENTIAL_OVERRIDE_MISMATCH',
        'auth',
        'request credential override does not match the model handle',
      );
    const actualFingerprint = fingerprintCredential(
      override,
      input.credentialFingerprintKey,
    );
    if (!credentialFingerprintsEqual(actualFingerprint, expectedFingerprint))
      return new AiRuntimeError(
        'CREDENTIAL_OVERRIDE_MISMATCH',
        'auth',
        'request credential override does not match the model handle',
      );
  } else if (override) {
    return new AiRuntimeError(
      'CREDENTIAL_OVERRIDE_MISMATCH',
      'auth',
      'model handle is not bound to a request credential override',
    );
  }
  if (!input.driver || !input.networkPolicy)
    return new AiRuntimeError(
      'TRANSPORT_UNAVAILABLE',
      'invalid_request',
      'transport and network policy are required for this provider',
    );
  const headers: Record<
    string,
    string | import('../transport/request-transport.js').SecretHeaderValue
  > = { ...(binding.headers ?? {}) };
  if (binding.credential && override) {
    const headerName = binding.credential.headerName.toLowerCase();
    if (Object.keys(headers).some((name) => name.toLowerCase() === headerName))
      return new AiRuntimeError(
        'PROTECTED_HEADER_CONFLICT',
        'invalid_request',
        'credential header conflicts with a configured request header',
      );
    headers[headerName] = createSecretHeaderValue(
      override.secret,
      override.scheme ??
        binding.credential.defaultScheme ??
        credentialScheme(override),
    );
  }
  return bindRequestTransport({
    target: createFinalRequestTarget({
      endpoint: new URL(binding.endpoint),
      headers,
      limits: binding.limits,
    }),
    driver: input.driver,
    networkPolicy: input.networkPolicy,
    retry: input.retry,
    retrySafety: binding.retrySafety,
    redirect: binding.redirect,
  });
}

async function runChat<TProtocol extends string>(input: {
  chat: NonNullable<Provider['chat']>;
  providerSnapshot: ProviderSnapshot;
  model: ModelHandle<TProtocol>;
  context: AiContext;
  resolved: ResolvedStreamOptions<TProtocol>;
  credentialOverride?: RequestCredentialOverride;
  credentialFingerprintKey: Uint8Array;
  storedAuth?: StoredRequestAuth;
  authCoordinator?: Pick<AuthCoordinator<unknown>, 'assertCurrent'>;
  driver?: TransportDriver;
  networkPolicy?: NetworkPolicy;
  sessionManager: ReturnType<typeof createSessionManager>;
  stream: ResponseStream;
}): Promise<void> {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  let sequence = 0;
  const blocks = new Map<string, BlockState>();
  const content: AggregatedContent[] = [];
  const responseStart: AiStreamEvent = {
    type: 'response_start',
    sequence: ++sequence,
    requestId,
    startedAt,
    model: input.model.definition,
  };
  await input.stream.publish(responseStart);

  let lateEventCount = 0;
  const sink = new AttemptLocalSink({
    onLateEvent: () => {
      lateEventCount += 1;
    },
    onPublish: async (event) => {
      const full = { ...event, sequence: ++sequence } as AiStreamEvent;
      updateAggregate(blocks, content, full);
      await input.stream.publish(full);
    },
  });

  let terminal: ProtocolTerminal;
  try {
    const contextResult = validateContext(input.context);
    if (!contextResult.valid) {
      terminal = {
        status: 'failed',
        error: new AiRuntimeError(
          'CONTEXT_INVALID',
          'invalid_request',
          contextResult.issues.map((issue) => issue.message).join('; '),
          false,
          { issues: contextResult.issues },
        ),
      };
    } else {
      const abortTimer = setTimeout(
        () => input.stream.abort('stream timeout'),
        input.resolved.timeoutMs,
      );
      try {
        if (input.storedAuth && input.authCoordinator)
          await input.authCoordinator.assertCurrent(
            input.storedAuth,
            input.stream.signal,
          );
        const transportResult = resolveRequestTransport({
          ...input,
          credentialOverride:
            input.credentialOverride ?? input.storedAuth?.override,
          retry: input.resolved.retry,
        });
        if (transportResult instanceof AiRuntimeError) {
          terminal = { status: 'failed', error: transportResult };
        } else {
          const storedAuth = input.storedAuth;
          const credentialIdentity =
            storedAuth?.credentialInstanceId ??
            handleCredentialFingerprint.get(input.model as object) ??
            'no-credential';
          const sessionScopeFingerprint = handleSessionScopeFingerprint.get(
            input.model as object,
          );
          if (!sessionScopeFingerprint)
            throw new AiRuntimeError(
              'MODEL_HANDLE_SCOPE_UNAVAILABLE',
              'invalid_request',
              'model handle scope identity is unavailable',
            );
          const session: SessionHandle = input.sessionManager.open({
            providerInstanceId: input.model.definition.providerInstanceId,
            protocol: input.model.definition.protocol,
            credentialScopeFingerprint: sessionScopeFingerprint,
            credentialInstanceId: credentialIdentity,
            authBindingFingerprint:
              storedAuth?.authBindingFingerprint ??
              makeAuthBinding({
                snapshot: input.providerSnapshot,
                transport: input.chat.transport,
              }).fingerprint,
            providerRegistrationGeneration:
              input.providerSnapshot.registrationGeneration,
            ...(input.resolved.sessionId
              ? { sessionId: input.resolved.sessionId }
              : {}),
          });
          const request: ChatRequest<TProtocol> = {
            model: input.model.definition,
            context: input.context,
            options: { ...input.resolved, signal: input.stream.signal },
            signal: input.stream.signal,
            session,
            ...(transportResult ? { transport: transportResult } : {}),
          };
          terminal = await input.chat.runChat(request, sink);
        }
      } finally {
        clearTimeout(abortTimer);
      }
    }
  } catch (error: unknown) {
    terminal = input.stream.signal.aborted
      ? { status: 'cancelled', error: cancelledError(error) }
      : { status: 'failed', error: failedError(error) };
  } finally {
    const sinkError = await sink.close();
    if (sinkError && terminal!.status === 'completed')
      terminal = { status: 'failed', error: failedError(sinkError) };
  }

  if (lateEventCount > 0) {
    terminal = addDiagnostic(terminal, {
      code: 'LATE_PROVIDER_EVENT_DROPPED',
      message: `${lateEventCount} provider event(s) arrived after the attempt closed`,
    });
  }

  if (terminal.status === 'completed') {
    const terminalError = validateCompletedTerminal(terminal, blocks, content);
    if (terminalError) terminal = { status: 'failed', error: terminalError };
  }
  if (terminal.status !== 'completed') finalizeOpenBlocks(blocks, content);

  const completedAt = Date.now();
  const response = makeResponse({
    requestId,
    startedAt,
    completedAt,
    model: input.model.definition,
    content,
    terminal,
  });
  const event: AiStreamEvent =
    response.status === 'completed'
      ? { type: 'response_end', sequence: ++sequence, response }
      : { type: 'response_error', sequence: ++sequence, response };
  await input.stream.complete(response, event);
}

type AggregatedContent = {
  readonly contentIndex: number;
  readonly value:
    | import('../core/content.js').ToolCallContent
    | import('../core/content.js').TextContent
    | import('../core/content.js').ReasoningContent;
};

function updateAggregate(
  blocks: Map<string, BlockState>,
  content: AggregatedContent[],
  event: AiStreamEvent,
): void {
  switch (event.type) {
    case 'text_start':
    case 'reasoning_start':
      assertNewBlock(blocks, event.itemId, event.contentIndex);
      blocks.set(event.itemId, {
        kind: event.type === 'text_start' ? 'text' : 'reasoning',
        itemId: event.itemId,
        contentIndex: event.contentIndex,
        text: '',
        name: '',
        toolCallId: '',
        rawArguments: '',
        closed: false,
      });
      return;
    case 'tool_call_start':
      assertNewBlock(blocks, event.itemId, event.contentIndex);
      blocks.set(event.itemId, {
        kind: 'tool_call',
        itemId: event.itemId,
        contentIndex: event.contentIndex,
        text: '',
        name: event.name ?? '',
        toolCallId: event.toolCallId,
        rawArguments: '',
        closed: false,
      });
      return;
    case 'text_delta':
    case 'reasoning_delta': {
      const block = requireBlock(blocks, event.itemId, event.contentIndex);
      if (
        block.closed ||
        block.kind !== (event.type === 'text_delta' ? 'text' : 'reasoning')
      )
        throw protocolError(
          `invalid ${event.type} for content item ${event.itemId}`,
        );
      block.text += event.delta;
      return;
    }
    case 'tool_call_delta': {
      const block = requireBlock(blocks, event.itemId, event.contentIndex);
      if (block.closed || block.kind !== 'tool_call')
        throw protocolError(
          `invalid tool_call_delta for content item ${event.itemId}`,
        );
      block.rawArguments += event.argumentsDelta;
      if (event.nameDelta) block.name += event.nameDelta;
      return;
    }
    case 'text_end':
    case 'reasoning_end': {
      const block = requireBlock(blocks, event.itemId, event.contentIndex);
      if (
        block.closed ||
        block.kind !== (event.type === 'text_end' ? 'text' : 'reasoning')
      )
        throw protocolError(
          `invalid ${event.type} for content item ${event.itemId}`,
        );
      block.closed = true;
      block.replay = event.replay;
      content.push({
        contentIndex: block.contentIndex,
        value:
          event.type === 'text_end'
            ? {
                type: 'text',
                text: block.text,
                ...(event.replay ? { replay: event.replay } : {}),
              }
            : {
                type: 'reasoning',
                text: block.text,
                ...(event.replay ? { replay: event.replay } : {}),
              },
      });
      return;
    }
    case 'tool_call_end': {
      const block = requireBlock(blocks, event.itemId, event.contentIndex);
      if (block.closed || block.kind !== 'tool_call')
        throw protocolError(
          `invalid tool_call_end for content item ${event.itemId}`,
        );
      if (
        event.toolCall.id !== block.toolCallId ||
        event.toolCall.rawArguments !== block.rawArguments
      )
        throw protocolError(
          `tool call ${event.itemId} does not contain the collected arguments`,
        );
      if (event.toolCall.name !== block.name)
        throw protocolError(
          `tool call ${event.itemId} name does not match its start event`,
        );
      block.closed = true;
      block.toolCall = canonicalToolCall(block, event.toolCall);
      content.push({ contentIndex: block.contentIndex, value: block.toolCall });
      return;
    }
    default:
      return;
  }
}

function canonicalToolCall(
  block: BlockState,
  supplied: import('../core/content.js').ToolCallContent,
): import('../core/content.js').ToolCallContent {
  const parsed = parseToolArguments(block.rawArguments, {
    repairTruncatedJson: true,
  });
  return {
    type: 'tool_call',
    id: block.toolCallId,
    name: block.name,
    status: parsed.ok ? 'complete' : 'incomplete',
    rawArguments: block.rawArguments,
    ...(parsed.ok ? { arguments: parsed.value } : {}),
    ...(supplied.replay ? { replay: supplied.replay } : {}),
  };
}

function validateCompletedTerminal(
  terminal: Extract<ProtocolTerminal, { status: 'completed' }>,
  blocks: Map<string, BlockState>,
  content: readonly AggregatedContent[],
): AiError | undefined {
  for (const block of blocks.values()) {
    if (!block.closed)
      return protocolError(`content item ${block.itemId} was not closed`);
  }
  if (
    terminal.finishReason === 'stop' ||
    terminal.finishReason === 'tool_calls'
  ) {
    const incomplete = content.some(
      (item) =>
        item.value.type === 'tool_call' && item.value.status !== 'complete',
    );
    if (incomplete)
      return protocolError('completed tool call contains incomplete JSON');
  }
  return undefined;
}

function finalizeOpenBlocks(
  blocks: Map<string, BlockState>,
  content: AggregatedContent[],
): void {
  const present = new Set(content.map((item) => item.contentIndex));
  for (const block of blocks.values()) {
    if (block.closed || present.has(block.contentIndex)) continue;
    block.closed = true;
    const value =
      block.kind === 'text'
        ? ({ type: 'text', text: block.text } as const)
        : block.kind === 'reasoning'
          ? ({ type: 'reasoning', text: block.text } as const)
          : canonicalToolCall(block, {
              type: 'tool_call',
              id: block.toolCallId,
              name: block.name,
              status: 'incomplete',
              rawArguments: block.rawArguments,
            });
    content.push({ contentIndex: block.contentIndex, value });
  }
}

function assertNewBlock(
  blocks: Map<string, BlockState>,
  itemId: string,
  contentIndex: number,
): void {
  if (blocks.has(itemId)) throw protocolError('duplicate content item');
  if (contentIndex !== blocks.size)
    throw protocolError(
      `content index ${contentIndex} is not the next logical block`,
    );
}

function requireBlock(
  blocks: Map<string, BlockState>,
  itemId: string,
  contentIndex: number,
): BlockState {
  const block = blocks.get(itemId);
  if (!block) throw protocolError(`content item ${itemId} has no start event`);
  if (block.contentIndex !== contentIndex)
    throw protocolError(`content item ${itemId} changed content index`);
  return block;
}

function protocolError(message: string): AiError {
  return new AiRuntimeError('PROTOCOL_VIOLATION', 'protocol', message, false);
}

function addDiagnostic(
  terminal: ProtocolTerminal,
  diagnostic: { code: string; message: string },
): ProtocolTerminal {
  return {
    ...terminal,
    diagnostics: [...(terminal.diagnostics ?? []), diagnostic],
  } as ProtocolTerminal;
}

function makeResponse(input: {
  requestId: string;
  startedAt: number;
  completedAt: number;
  model: Readonly<ModelDefinition>;
  content: readonly AggregatedContent[];
  terminal: ProtocolTerminal;
}): AssistantResponse {
  const orderedContent = Object.freeze(
    [...input.content]
      .sort((left, right) => left.contentIndex - right.contentIndex)
      .map((item) => item.value),
  );
  const base = {
    requestId: input.requestId,
    model: input.model,
    ...(input.terminal.responseModelId
      ? {
          responseModel: {
            providerInstanceId: input.model.providerInstanceId,
            modelId: input.terminal.responseModelId,
            protocol: input.model.protocol,
          },
        }
      : {}),
    ...(input.terminal.responseId
      ? { responseId: input.terminal.responseId }
      : {}),
    ...(input.terminal.replay ? { replay: input.terminal.replay } : {}),
    content: orderedContent,
    usage: input.terminal.usage,
    cost: input.terminal.cost,
    diagnostics: input.terminal.diagnostics,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
  if (input.terminal.status === 'completed')
    return {
      ...base,
      status: 'completed',
      finishReason: input.terminal.finishReason,
      partial: false,
    };
  if (input.terminal.status === 'cancelled')
    return {
      ...base,
      status: 'cancelled',
      finishReason: 'cancelled',
      partial: orderedContent.length > 0,
      error: input.terminal.error,
    };
  return {
    ...base,
    status: 'failed',
    finishReason: 'error',
    partial: orderedContent.length > 0,
    error: input.terminal.error,
  };
}

function failedError(error: unknown): AiError {
  if (isAiError(error)) return error;
  return new AiRuntimeError(
    'INTERNAL_ERROR',
    'internal',
    'AI provider failed internally',
    false,
  );
}

function cancelledError(error: unknown): AiError & { category: 'cancelled' } {
  if (isAiError(error) && error.category === 'cancelled')
    return error as AiError & { category: 'cancelled' };
  return new AiRuntimeError(
    'REQUEST_CANCELLED',
    'cancelled',
    error instanceof Error ? error.message : 'request cancelled',
    false,
  ) as AiError & { category: 'cancelled' };
}

function isAiError(error: unknown): error is AiError {
  return (
    error instanceof Error &&
    error.name === 'AiError' &&
    typeof (error as Partial<AiError>).code === 'string'
  );
}
