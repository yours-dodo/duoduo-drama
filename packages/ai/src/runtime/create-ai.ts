import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { AiRuntimeError, type AiError } from '../core/errors.js';
import { toPublicAiError, toPublicDiagnostics } from '../core/public-errors.js';
import type { RequestCredentialOverride } from '../auth/api-key.js';
import type {
  AmbientAuthPolicy,
  AmbientAuthResolution,
} from '../auth/ambient.js';
import { credentialScheme } from '../auth/api-key.js';
import type { CredentialOverridePolicy } from '../auth/override-policy.js';
import type { CredentialStore } from '../auth/credential-store.js';
import type { AuthApi, AuthInteraction } from '../auth/login.js';
import type { AuthRuntimeOptions } from '../auth/oauth.js';
import type {
  CredentialScopeAction,
  CredentialScopeAuthority,
} from '../auth/scope-authority.js';
import { revealSecret } from '../auth/secret-value.js';
import { validateContext } from '../core/context.js';
import { estimateContextTokens } from '../core/usage.js';
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
  CacheRetention,
  ContextNormalizationPolicy,
  ModelDefinition,
  ModelHandle,
  ModelRef,
  ProviderSnapshot,
  ReasoningLevel,
  ToolChoice,
} from '../core/models.js';
import { createSessionManager } from '../session/manager.js';
import { createImagesApi } from '../images/runtime.js';
import { createVideosApi } from '../videos/runtime.js';
import type {
  GenerationOperationCodec,
  GenerationOperationPolicy,
  OperationCredentialVerifier,
} from '../generation/index.js';
import type {
  ImageGenerationOptions,
  ImageModelReadOptions,
  ImageOperationResumeOptions,
  ImagesApi,
} from '../images/contracts.js';
import type { ImageGenerationInput } from '../images/input.js';
import type {
  ImageModelHandle,
  ImageModelListFilter,
  ImageModelRef,
} from '../images/models.js';
import type { ImageOperationRef } from '../images/operation-claims.js';
import type {
  VideoGenerationOptions,
  VideoModelReadOptions,
  VideoOperationResumeOptions,
  VideosApi,
} from '../videos/contracts.js';
import type { VideoGenerationInput } from '../videos/input.js';
import type {
  VideoModelHandle,
  VideoModelListFilter,
  VideoModelRef,
} from '../videos/models.js';
import type { VideoOperationRef } from '../videos/operation-claims.js';
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
  type ChatTransportBinding,
  type Provider,
  type ProvidersApi,
} from './registry.js';
import {
  createAuthCoordinator,
  makeAuthBinding,
  type AuthCoordinator,
  type StoredRequestAuth,
} from './auth-coordinator.js';
import {
  resolveRuntimeResourcePolicy,
  type RuntimeResourcePolicyInput,
} from './resource-policy.js';
import {
  createRuntimeLifecycle,
  type RuntimeDisposeOptions as RuntimeLifecycleDisposeOptions,
  type RuntimeLifecycle,
} from './lifecycle.js';

export type { RuntimeResourcePolicyInput } from './resource-policy.js';

const handleProvider = new WeakMap<object, string>();
const handleRuntime = new WeakMap<object, symbol>();
const handleCredentialFingerprint = new WeakMap<object, string>();
const handleSessionScopeFingerprint = new WeakMap<object, string>();
const handleStoredAuth = new WeakMap<object, StoredRequestAuth>();
const handleAmbientAuth = new WeakMap<object, AmbientAuthResolution>();

export interface StreamOptionsInput {
  readonly signal?: AbortSignal;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly stop?: readonly string[];
  readonly toolChoice?: ToolChoice;
  readonly reasoning?: ReasoningLevel;
  readonly cacheRetention?: CacheRetention;
  readonly timeoutMs?: number;
  readonly contextPolicy?: ContextNormalizationPolicy;
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

export type RuntimeDisposeOptions = RuntimeLifecycleDisposeOptions;

export interface AiRuntime<TScopeHandle = unknown> {
  readonly providers: ProvidersApi;
  readonly inventory: InventoryApi;
  readonly auth: AuthApi<TScopeHandle>;
  readonly models: ModelsApi<TScopeHandle>;
  readonly images: ImagesApi<TScopeHandle>;
  readonly videos: VideosApi<TScopeHandle>;
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
  dispose(options?: RuntimeDisposeOptions): Promise<void>;
}

export interface CreateAiOptions<TScopeHandle = unknown> {
  readonly commonDefaults?: Readonly<{
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    stop?: readonly string[];
    toolChoice?: ToolChoice;
    reasoning?: ReasoningLevel;
    cacheRetention?: CacheRetention;
    timeoutMs?: number;
    retry?: false | RetryPolicy;
    contextPolicy?: ContextNormalizationPolicy;
  }>;
  readonly scope?: TScopeHandle;
  readonly resourcePolicy?: RuntimeResourcePolicyInput;
  readonly transport?: TransportDriver;
  readonly networkPolicy?: NetworkPolicy;
  readonly credentialOverridePolicy?: CredentialOverridePolicy<TScopeHandle>;
  readonly ambientAuthPolicy?: AmbientAuthPolicy<TScopeHandle>;
  readonly credentialStore?: CredentialStore;
  readonly scopeAuthority?: CredentialScopeAuthority<TScopeHandle>;
  readonly auth?: AuthRuntimeOptions;
  readonly imageDefaults?: Readonly<{
    timeoutMs?: number;
    responseFormat?: 'url' | 'base64';
    pollIntervalMs?: number;
  }>;
  readonly videoDefaults?: Readonly<{
    timeoutMs?: number;
    responseFormat?: 'url' | 'base64';
    pollIntervalMs?: number;
  }>;
  readonly generationOperationCodec?: GenerationOperationCodec;
  readonly operationCredentialVerifier?: OperationCredentialVerifier;
  readonly generationOperationPolicy?: GenerationOperationPolicy;
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
  const resourcePolicy = resolveRuntimeResourcePolicy(options.resourcePolicy);
  const registry = new ProviderRegistry();
  const sessionManager = createSessionManager(resourcePolicy.session);
  const lifecycle = createRuntimeLifecycle();
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
          auth: options.auth,
          onCredentialReplaced: (credentialInstanceId) =>
            sessionManager.cleanupCredential(credentialInstanceId),
          getProvider: (providerInstanceId) => {
            const entry = registry.get(providerInstanceId);
            return entry
              ? {
                  snapshot: entry.snapshot,
                  transport: entry.provider.chat?.transport,
                  auth: entry.provider.auth,
                }
              : undefined;
          },
        })
      : undefined;
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
        transport: entry.provider.chat?.transport,
        auth: entry.provider.auth,
        provider: entry.snapshot,
        scope,
        override: readOptions?.credentialOverride,
        policy: options.credentialOverridePolicy,
        ambientPolicy: options.ambientAuthPolicy,
        key: credentialFingerprintKey,
        coordinator: authCoordinator,
        signal: readOptions?.signal,
      });
      const sessionScopeFingerprint = await resolveSessionScopeFingerprint({
        providerInstanceId: entry.snapshot.id,
        scope,
        storedAuth: resolvedAuth.storedAuth,
        ambientAuth: resolvedAuth.ambientAuth,
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
        resolvedAuth.ambientAuth,
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
          transport: entry.provider.chat?.transport,
          auth: entry.provider.auth,
          provider: snapshot,
          scope,
          override: readOptions?.credentialOverride,
          policy: options.credentialOverridePolicy,
          ambientPolicy: options.ambientAuthPolicy,
          key: credentialFingerprintKey,
          coordinator: authCoordinator,
          signal: readOptions?.signal,
        });
        const sessionScopeFingerprint = await resolveSessionScopeFingerprint({
          providerInstanceId: snapshot.id,
          scope,
          storedAuth: resolvedAuth.storedAuth,
          ambientAuth: resolvedAuth.ambientAuth,
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
                resolvedAuth.ambientAuth,
              ),
            );
        }
      }
      return { models: handles };
    },
  };

  const images = createImagesApi({
    registry,
    runtimeId,
    beginOperation: (abort) => lifecycle.acquire(abort),
    transport: options.transport,
    networkPolicy: options.networkPolicy,
    credentialOverridePolicy: options.credentialOverridePolicy,
    imageDefaults: options.imageDefaults,
    generationOperationCodec: options.generationOperationCodec,
    operationCredentialVerifier: options.operationCredentialVerifier,
    generationOperationPolicy: options.generationOperationPolicy,
    resolveAuth: async ({
      binding,
      provider,
      scope,
      action,
      override,
      signal,
    }) => {
      const entry = registry.get(provider.id);
      const resolved = await resolveModelAuth({
        transport: binding,
        auth: entry?.provider.auth,
        provider,
        scope,
        override,
        policy: options.credentialOverridePolicy,
        ambientPolicy: options.ambientAuthPolicy,
        key: credentialFingerprintKey,
        coordinator: authCoordinator,
        action,
        signal,
      });
      const credentialScopeFingerprint = await resolveSessionScopeFingerprint({
        providerInstanceId: provider.id,
        scope,
        storedAuth: resolved.storedAuth,
        ambientAuth: resolved.ambientAuth,
        scopeAuthority: options.scopeAuthority,
        runtimeScopeFingerprint,
        action,
        signal,
      });
      const requestCredential = override ?? resolved.storedAuth?.override;
      const authSource = override
        ? ('override' as const)
        : resolved.storedAuth
          ? ('stored' as const)
          : resolved.ambientAuth
            ? ('ambient' as const)
            : requestCredential
              ? ('override' as const)
              : undefined;
      return Object.freeze({
        ...(requestCredential ? { requestCredential } : {}),
        ...(authSource ? { authSource } : {}),
        ...(resolved.storedAuth
          ? {
              credentialInstanceId: resolved.storedAuth.credentialInstanceId,
              credentialIdentityLifetime: resolved.storedAuth.identityLifetime,
              authBindingFingerprint:
                resolved.storedAuth.authBindingFingerprint,
              assertCurrent: (currentSignal?: AbortSignal) =>
                authCoordinator!.assertCurrent(
                  resolved.storedAuth!,
                  currentSignal,
                ),
            }
          : resolved.ambientAuth
            ? {
                credentialInstanceId: resolved.ambientAuth.credentialInstanceId,
                credentialIdentityLifetime:
                  resolved.ambientAuth.credentialIdentityLifetime,
                authBindingFingerprint: provider.authPolicyFingerprint,
              }
            : authSource === 'override'
              ? {
                  credentialIdentityLifetime:
                    options.operationCredentialVerifier?.identityLifetime ??
                    ('process-local' as const),
                  authBindingFingerprint: provider.authPolicyFingerprint,
                }
              : {}),
        credentialScopeFingerprint,
        scopeIdentityLifetime:
          options.scopeAuthority?.fingerprintLifetime ??
          ('process-local' as const),
      });
    },
  });

  const videos = createVideosApi({
    registry,
    runtimeId,
    beginOperation: (abort) => lifecycle.acquire(abort),
    transport: options.transport,
    networkPolicy: options.networkPolicy,
    credentialOverridePolicy: options.credentialOverridePolicy,
    videoDefaults: options.videoDefaults,
    generationOperationCodec: options.generationOperationCodec,
    operationCredentialVerifier: options.operationCredentialVerifier,
    generationOperationPolicy: options.generationOperationPolicy,
    resolveAuth: async ({
      binding,
      provider,
      scope,
      action,
      override,
      signal,
    }) => {
      const entry = registry.get(provider.id);
      const resolved = await resolveModelAuth({
        transport: binding,
        auth: entry?.provider.auth,
        provider,
        scope,
        override,
        policy: options.credentialOverridePolicy,
        ambientPolicy: options.ambientAuthPolicy,
        key: credentialFingerprintKey,
        coordinator: authCoordinator,
        action,
        signal,
      });
      const credentialScopeFingerprint = await resolveSessionScopeFingerprint({
        providerInstanceId: provider.id,
        scope,
        storedAuth: resolved.storedAuth,
        ambientAuth: resolved.ambientAuth,
        scopeAuthority: options.scopeAuthority,
        runtimeScopeFingerprint,
        action,
        signal,
      });
      const requestCredential = override ?? resolved.storedAuth?.override;
      const authSource = override
        ? ('override' as const)
        : resolved.storedAuth
          ? ('stored' as const)
          : resolved.ambientAuth
            ? ('ambient' as const)
            : requestCredential
              ? ('override' as const)
              : undefined;
      return Object.freeze({
        ...(requestCredential ? { requestCredential } : {}),
        ...(authSource ? { authSource } : {}),
        ...(resolved.storedAuth
          ? {
              credentialInstanceId: resolved.storedAuth.credentialInstanceId,
              credentialIdentityLifetime: resolved.storedAuth.identityLifetime,
              authBindingFingerprint:
                resolved.storedAuth.authBindingFingerprint,
              assertCurrent: (currentSignal?: AbortSignal) =>
                authCoordinator!.assertCurrent(
                  resolved.storedAuth!,
                  currentSignal,
                ),
            }
          : resolved.ambientAuth
            ? {
                credentialInstanceId: resolved.ambientAuth.credentialInstanceId,
                credentialIdentityLifetime:
                  resolved.ambientAuth.credentialIdentityLifetime,
                authBindingFingerprint: provider.authPolicyFingerprint,
              }
            : authSource === 'override'
              ? {
                  credentialIdentityLifetime:
                    options.operationCredentialVerifier?.identityLifetime ??
                    ('process-local' as const),
                  authBindingFingerprint: provider.authPolicyFingerprint,
                }
              : {}),
        credentialScopeFingerprint,
        scopeIdentityLifetime:
          options.scopeAuthority?.fingerprintLifetime ??
          ('process-local' as const),
      });
    },
  });

  const providers: ProvidersApi = Object.freeze({
    register: (provider: Provider) => {
      lifecycle.assertRunning();
      registry.register(provider);
    },
    registerAll: (providersToRegister: Iterable<Provider>) => {
      lifecycle.assertRunning();
      registry.registerAll(providersToRegister);
    },
    unregister: (providerInstanceId: string) => {
      lifecycle.assertRunning();
      return registry.unregister(providerInstanceId);
    },
    list: () => {
      lifecycle.assertRunning();
      return registry.list();
    },
  });

  const runtimeInventory: InventoryApi = Object.freeze({
    models: Object.freeze({
      find: async <TProtocol extends string>(ref: ModelRef<TProtocol>) =>
        runLifecycleOperation(lifecycle, undefined, () =>
          inventory.models.find(ref),
        ),
      list: async (filter?: ModelListFilter) =>
        runLifecycleOperation(lifecycle, undefined, () =>
          inventory.models.list(filter),
        ),
    }),
  });

  const runtimeModels: ModelsApi<TScopeHandle> = Object.freeze({
    find: async <TProtocol extends string>(
      ref: ModelRef<TProtocol>,
      scope: TScopeHandle,
      readOptions?: ModelReadOptions,
    ) =>
      runLifecycleOperation(lifecycle, readOptions?.signal, (signal) =>
        models.find(ref, scope, { ...readOptions, signal }),
      ),
    require: async <TProtocol extends string>(
      ref: ModelRef<TProtocol>,
      scope: TScopeHandle,
      readOptions?: ModelReadOptions,
    ) =>
      runLifecycleOperation(lifecycle, readOptions?.signal, (signal) =>
        models.require(ref, scope, { ...readOptions, signal }),
      ),
    list: async (
      scope: TScopeHandle,
      filter?: ModelListFilter,
      readOptions?: ModelReadOptions,
    ) =>
      runLifecycleOperation(lifecycle, readOptions?.signal, (signal) =>
        models.list(scope, filter, { ...readOptions, signal }),
      ),
  });

  const runtimeImages: ImagesApi<TScopeHandle> = Object.freeze({
    models: Object.freeze({
      find: async <TProtocol extends string>(
        ref: ImageModelRef<TProtocol>,
        scope: TScopeHandle,
        readOptions?: ImageModelReadOptions,
      ) =>
        runLifecycleOperation(lifecycle, readOptions?.signal, (signal) =>
          images.models.find(ref, scope, { ...readOptions, signal }),
        ),
      require: async <TProtocol extends string>(
        ref: ImageModelRef<TProtocol>,
        scope: TScopeHandle,
        readOptions?: ImageModelReadOptions,
      ) =>
        runLifecycleOperation(lifecycle, readOptions?.signal, (signal) =>
          images.models.require(ref, scope, { ...readOptions, signal }),
        ),
      list: async (
        scope: TScopeHandle,
        filter?: ImageModelListFilter,
        readOptions?: ImageModelReadOptions,
      ) =>
        runLifecycleOperation(lifecycle, readOptions?.signal, (signal) =>
          images.models.list(scope, filter, { ...readOptions, signal }),
        ),
    }),
    stream: <TProtocol extends string>(
      model: ImageModelHandle<TProtocol>,
      input: ImageGenerationInput,
      callOptions?: ImageGenerationOptions<TProtocol>,
    ) => {
      lifecycle.assertRunning();
      return images.stream(model, input, callOptions);
    },
    generate: async <TProtocol extends string>(
      model: ImageModelHandle<TProtocol>,
      input: ImageGenerationInput,
      callOptions?: ImageGenerationOptions<TProtocol>,
    ) => {
      lifecycle.assertRunning();
      return images.generate(model, input, callOptions);
    },
    resume: async (
      operation: ImageOperationRef,
      resumeOptions: ImageOperationResumeOptions<TScopeHandle>,
    ) =>
      runLifecycleOperation(lifecycle, resumeOptions.signal, (signal) =>
        images.resume(operation, { ...resumeOptions, signal }),
      ),
    serializeOperation: async (operation: ImageOperationRef) =>
      runLifecycleOperation(lifecycle, undefined, () =>
        images.serializeOperation(operation),
      ),
    parseOperation: async (serialized: string) =>
      runLifecycleOperation(lifecycle, undefined, () =>
        images.parseOperation(serialized),
      ),
  });

  const runtimeVideos: VideosApi<TScopeHandle> = Object.freeze({
    models: Object.freeze({
      find: async <TProtocol extends string>(
        ref: VideoModelRef<TProtocol>,
        scope: TScopeHandle,
        readOptions?: VideoModelReadOptions,
      ) =>
        runLifecycleOperation(lifecycle, readOptions?.signal, (signal) =>
          videos.models.find(ref, scope, { ...readOptions, signal }),
        ),
      require: async <TProtocol extends string>(
        ref: VideoModelRef<TProtocol>,
        scope: TScopeHandle,
        readOptions?: VideoModelReadOptions,
      ) =>
        runLifecycleOperation(lifecycle, readOptions?.signal, (signal) =>
          videos.models.require(ref, scope, { ...readOptions, signal }),
        ),
      list: async (
        scope: TScopeHandle,
        filter?: VideoModelListFilter,
        readOptions?: VideoModelReadOptions,
      ) =>
        runLifecycleOperation(lifecycle, readOptions?.signal, (signal) =>
          videos.models.list(scope, filter, { ...readOptions, signal }),
        ),
    }),
    stream: <TProtocol extends string>(
      model: VideoModelHandle<TProtocol>,
      input: VideoGenerationInput,
      callOptions?: VideoGenerationOptions<TProtocol>,
    ) => {
      lifecycle.assertRunning();
      return videos.stream(model, input, callOptions);
    },
    generate: async <TProtocol extends string>(
      model: VideoModelHandle<TProtocol>,
      input: VideoGenerationInput,
      callOptions?: VideoGenerationOptions<TProtocol>,
    ) => {
      lifecycle.assertRunning();
      return videos.generate(model, input, callOptions);
    },
    resume: async (
      operation: VideoOperationRef,
      resumeOptions: VideoOperationResumeOptions<TScopeHandle>,
    ) =>
      runLifecycleOperation(lifecycle, resumeOptions.signal, (signal) =>
        videos.resume(operation, { ...resumeOptions, signal }),
      ),
    serializeOperation: async (operation: VideoOperationRef) =>
      runLifecycleOperation(lifecycle, undefined, () =>
        videos.serializeOperation(operation),
      ),
    parseOperation: async (serialized: string) =>
      runLifecycleOperation(lifecycle, undefined, () =>
        videos.parseOperation(serialized),
      ),
  });

  const auth = authCoordinator?.api ?? createUnavailableAuthApi<TScopeHandle>();
  const runtimeAuth: AuthApi<TScopeHandle> = Object.freeze({
    status: async (
      providerInstanceId: string,
      scope: TScopeHandle,
      callOptions?: { readonly signal?: AbortSignal },
    ) =>
      runLifecycleOperation(lifecycle, callOptions?.signal, (signal) =>
        auth.status(providerInstanceId, scope, { ...callOptions, signal }),
      ),
    login: async (
      providerInstanceId: string,
      method: 'api_key' | 'oauth' | 'ambient_config',
      scope: TScopeHandle,
      interaction: AuthInteraction,
      callOptions?: {
        readonly secretScheme?: string;
        readonly signal?: AbortSignal;
      },
    ) =>
      runLifecycleOperation(
        lifecycle,
        callOptions?.signal ?? interaction.signal,
        (signal) =>
          auth.login(
            providerInstanceId,
            method,
            scope,
            { ...interaction, signal },
            { ...callOptions, signal },
          ),
      ),
    logout: async (
      providerInstanceId: string,
      scope: TScopeHandle,
      callOptions?: {
        readonly revokeRemote?: boolean;
        readonly signal?: AbortSignal;
      },
    ) =>
      runLifecycleOperation(lifecycle, callOptions?.signal, (signal) =>
        auth.logout(providerInstanceId, scope, { ...callOptions, signal }),
      ),
  });

  const runtime: AiRuntime<TScopeHandle> = {
    providers,
    inventory: runtimeInventory,
    auth: runtimeAuth,
    models: runtimeModels,
    images: runtimeImages,
    videos: runtimeVideos,
    sessions: Object.freeze({
      cleanup: async (
        providerInstanceId: string,
        scope: TScopeHandle,
        sessionId: string,
        callOptions?: { readonly signal?: AbortSignal },
      ) =>
        runLifecycleOperation(
          lifecycle,
          callOptions?.signal,
          async (signal) => {
            if (!options.scopeAuthority)
              throw new AiRuntimeError(
                'SESSION_CLEANUP_UNAVAILABLE',
                'auth',
                'scopeAuthority is required to clean up a persistent session',
              );
            const resolvedScope = await options.scopeAuthority.resolve(
              scope,
              {
                expectedProviderInstanceId: providerInstanceId,
                action: 'cleanup_session',
              },
              signal,
            );
            const scopeFingerprint = await options.scopeAuthority.fingerprint(
              resolvedScope,
              signal,
            );
            await sessionManager.cleanup({
              providerInstanceId,
              credentialScopeFingerprint: scopeFingerprint,
              sessionId,
            });
          },
        ),
    }),
    stream: (model, context, streamOptions) => {
      lifecycle.assertRunning();
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
          const lease = lifecycle.acquire(() =>
            ownedStream.abort('runtime disposal timeout'),
          );
          try {
            await runChat({
              chat,
              providerSnapshot: entry.snapshot,
              model,
              context,
              resolved,
              credentialOverride: streamOptions?.credentialOverride,
              credentialFingerprintKey,
              storedAuth: handleStoredAuth.get(model as object),
              ambientAuth: handleAmbientAuth.get(model as object),
              authCoordinator,
              driver: options.transport,
              networkPolicy: options.networkPolicy,
              sessionManager,
              stream: ownedStream,
            });
          } finally {
            lease.release();
          }
        },
        {
          observerMaxItems: resourcePolicy.streamQueue.maxEvents,
          observerMaxBytes: resourcePolicy.streamQueue.maxBytes,
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
    dispose: (disposeOptions) =>
      lifecycle.dispose(disposeOptions, async () => {
        await runCleanupSteps([
          () => sessionManager.dispose(),
          () => {
            credentialFingerprintKey.fill(0);
            images.dispose();
            videos.dispose();
          },
          () => options.transport?.dispose?.(),
        ]);
      }),
  };

  return runtime;
}

async function runLifecycleOperation<T>(
  lifecycle: RuntimeLifecycle,
  callerSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const lease = lifecycle.acquire();
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, lease.signal])
    : lease.signal;
  try {
    return await operation(signal);
  } finally {
    lease.release();
  }
}

async function runCleanupSteps(
  steps: readonly (() => Promise<void> | void)[],
): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw errors[0];
}

function makeHandle<TProtocol extends string>(
  definition: ModelDefinition<TProtocol>,
  snapshot: ProviderSnapshot,
  runtimeId: symbol,
  sessionScopeFingerprint: string,
  credentialFingerprint?: string,
  storedAuth?: StoredRequestAuth,
  ambientAuth?: AmbientAuthResolution,
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
  if (ambientAuth !== undefined) handleAmbientAuth.set(handle, ambientAuth);
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
  const protocolOptions = asOptionRecord(input?.protocolOptions);
  const protocolToolChoice = isToolChoice(protocolOptions?.toolChoice)
    ? protocolOptions.toolChoice
    : undefined;
  const protocolReasoning = resolveProtocolReasoning(
    protocolOptions,
    model.capabilities.thinkingLevels,
  );
  const timeoutMs =
    input?.timeoutMs ??
    defaults?.timeoutMs ??
    model.requestDefaults?.timeoutMs ??
    120_000;
  const maxOutputTokens =
    input?.maxOutputTokens ??
    defaults?.maxOutputTokens ??
    model.requestDefaults?.maxOutputTokens ??
    Math.min(model.limits.maxOutputTokens, 8_192);
  const temperature =
    input?.temperature ??
    defaults?.temperature ??
    model.requestDefaults?.temperature;
  const topP = input?.topP ?? defaults?.topP ?? model.requestDefaults?.topP;
  const stop =
    input?.stop ?? defaults?.stop ?? model.requestDefaults?.stop ?? [];
  const toolChoice =
    input?.toolChoice ??
    protocolToolChoice ??
    defaults?.toolChoice ??
    model.requestDefaults?.toolChoice ??
    'auto';
  const reasoning =
    input?.reasoning ??
    protocolReasoning ??
    defaults?.reasoning ??
    model.requestDefaults?.reasoning ??
    'none';
  const cacheRetention =
    input?.cacheRetention ??
    defaults?.cacheRetention ??
    model.requestDefaults?.cacheRetention ??
    'short';
  const retry =
    input?.retry ??
    defaults?.retry ??
    model.requestDefaults?.retry ??
    DEFAULT_RETRY_POLICY;
  const contextPolicy =
    input?.contextPolicy ??
    defaults?.contextPolicy ??
    model.requestDefaults?.contextPolicy ??
    DEFAULT_CONTEXT_POLICY;
  validateTextRequestOptions({
    maxOutputTokens,
    modelMaxOutputTokens: model.limits.maxOutputTokens,
    temperature,
    topP,
    timeoutMs,
    stop,
    toolChoice,
    reasoning,
    model,
    cacheRetention,
    retry,
    contextPolicy,
  });
  return {
    signal: controller.signal,
    maxOutputTokens,
    ...(temperature === undefined ? {} : { temperature }),
    ...(topP === undefined ? {} : { topP }),
    stop,
    toolChoice,
    reasoning,
    cacheRetention,
    timeoutMs,
    retry,
    contextPolicy,
    ...(input?.sessionId ? { sessionId: input.sessionId } : {}),
    protocolOptions: (input?.protocolOptions ??
      {}) as ResolvedStreamOptions<TProtocol>['protocolOptions'],
  };
}

function asOptionRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function resolveProtocolReasoning(
  options: Readonly<Record<string, unknown>> | undefined,
  supported: readonly ReasoningLevel[],
): ReasoningLevel | undefined {
  if (!options) return undefined;
  if (options.thinkingEnabled === false) return 'none';
  const requested =
    options.reasoningEffort ?? options.thinkingLevel ?? options.reasoning;
  if (isReasoningLevel(requested)) return requested;
  if (options.thinkingEnabled === true)
    return supported.includes('medium')
      ? 'medium'
      : (supported.find((level) => level !== 'none') ?? 'medium');
  return undefined;
}

function validateTextRequestOptions(input: {
  readonly maxOutputTokens: number;
  readonly modelMaxOutputTokens: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly timeoutMs: number;
  readonly stop: readonly string[];
  readonly toolChoice: ToolChoice;
  readonly reasoning: ReasoningLevel;
  readonly model: Readonly<ModelDefinition>;
  readonly cacheRetention: CacheRetention;
  readonly retry: false | RetryPolicy;
  readonly contextPolicy: ContextNormalizationPolicy;
}): void {
  if (
    !Number.isInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    input.maxOutputTokens > input.modelMaxOutputTokens
  )
    throw new AiRuntimeError(
      'MAX_OUTPUT_TOKENS_INVALID',
      'invalid_request',
      'maxOutputTokens must be a positive integer within the model limit',
    );
  if (
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 1_000 ||
    input.timeoutMs > 900_000
  )
    throw new AiRuntimeError(
      'TIMEOUT_INVALID',
      'invalid_request',
      'timeoutMs must be an integer between 1000 and 900000',
    );
  if (
    !Array.isArray(input.stop) ||
    input.stop.length > 16 ||
    input.stop.some(
      (sequence) =>
        typeof sequence !== 'string' ||
        Buffer.byteLength(sequence, 'utf8') > 256,
    )
  )
    throw new AiRuntimeError(
      'STOP_INVALID',
      'invalid_request',
      'stop must contain at most 16 strings of at most 256 UTF-8 bytes',
    );
  if (
    input.temperature !== undefined &&
    (!Number.isFinite(input.temperature) ||
      input.temperature < 0 ||
      input.temperature > 2)
  )
    throw new AiRuntimeError(
      'TEMPERATURE_INVALID',
      'invalid_request',
      'temperature must be between 0 and 2',
    );
  if (
    input.topP !== undefined &&
    (!Number.isFinite(input.topP) || input.topP < 0 || input.topP > 1)
  )
    throw new AiRuntimeError(
      'TOP_P_INVALID',
      'invalid_request',
      'topP must be between 0 and 1',
    );
  if (!isToolChoice(input.toolChoice))
    throw new AiRuntimeError(
      'TOOL_CHOICE_INVALID',
      'invalid_request',
      'toolChoice must be auto, none, required, or a named tool',
    );
  if (!isReasoningLevel(input.reasoning))
    throw new AiRuntimeError(
      'REASONING_INVALID',
      'invalid_request',
      'reasoning level is invalid',
    );
  if (
    input.reasoning !== 'none' &&
    (!input.model.capabilities.reasoning ||
      (input.model.capabilities.thinkingLevels.length > 0 &&
        !input.model.capabilities.thinkingLevels.includes(input.reasoning)))
  )
    throw new AiRuntimeError(
      'REASONING_UNSUPPORTED',
      'invalid_request',
      'reasoning level is not supported by this model',
    );
  if (!['none', 'short', 'long'].includes(input.cacheRetention))
    throw new AiRuntimeError(
      'CACHE_RETENTION_INVALID',
      'invalid_request',
      'cacheRetention must be none, short, or long',
    );
  validateContextPolicy(input.contextPolicy);
  validateResolvedRetry(input.retry);
}

const DEFAULT_CONTEXT_POLICY: ContextNormalizationPolicy = Object.freeze({
  unsupportedImage: 'reject',
  crossProviderReasoning: 'as-text',
  failedTurn: 'drop',
  incompleteToolCall: 'drop',
  deferredTools: 'eager-fallback',
  tokenBudget: 'reject',
});

const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 5_000,
  jitterRatio: 0.2,
  retryOn: Object.freeze([
    'network',
    'rate_limit',
    'timeout',
    'provider_5xx',
  ] as const),
});

function isToolChoice(value: unknown): value is ToolChoice {
  if (value === 'auto' || value === 'none' || value === 'required') return true;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'tool' &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0
  );
}

function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
    value as string,
  );
}

function validateContextPolicy(policy: ContextNormalizationPolicy): void {
  if (
    !policy ||
    !['reject', 'placeholder'].includes(policy.unsupportedImage) ||
    !['preserve-readable', 'as-text', 'drop'].includes(
      policy.crossProviderReasoning,
    ) ||
    !['drop', 'preserve-readable'].includes(policy.failedTurn) ||
    !['drop', 'as-text'].includes(policy.incompleteToolCall) ||
    !['eager-fallback', 'require-deferred'].includes(policy.deferredTools) ||
    !['reject', 'truncate-oldest-safe-turns'].includes(policy.tokenBudget)
  )
    throw new AiRuntimeError(
      'CONTEXT_POLICY_INVALID',
      'invalid_request',
      'contextPolicy is invalid',
    );
}

function validateResolvedRetry(retry: false | RetryPolicy): void {
  if (retry === false) return;
  const retryKinds = ['network', 'rate_limit', 'timeout', 'provider_5xx'];
  if (
    !Number.isInteger(retry.maxAttempts) ||
    retry.maxAttempts < 1 ||
    retry.maxAttempts > 5 ||
    !Number.isInteger(retry.baseDelayMs) ||
    retry.baseDelayMs < 0 ||
    retry.baseDelayMs > 30_000 ||
    !Number.isInteger(retry.maxDelayMs) ||
    retry.maxDelayMs < retry.baseDelayMs ||
    retry.maxDelayMs > 30_000 ||
    !Number.isFinite(retry.jitterRatio) ||
    retry.jitterRatio < 0 ||
    retry.jitterRatio > 1 ||
    !Array.isArray(retry.retryOn) ||
    retry.retryOn.some((kind) => !retryKinds.includes(kind))
  )
    throw new AiRuntimeError(
      'RETRY_INVALID',
      'invalid_request',
      'retry policy is outside the supported hard limits',
    );
}

async function resolveModelAuth<TScopeHandle>(input: {
  transport?: ChatTransportBinding;
  auth: Provider['auth'];
  provider: ProviderSnapshot;
  scope: TScopeHandle;
  override?: RequestCredentialOverride;
  policy?: CredentialOverridePolicy<TScopeHandle>;
  ambientPolicy?: AmbientAuthPolicy<TScopeHandle>;
  key: Uint8Array;
  coordinator?: ReturnType<typeof createAuthCoordinator<TScopeHandle>>;
  action?: CredentialScopeAction;
  signal?: AbortSignal;
}): Promise<{
  credentialFingerprint?: string;
  storedAuth?: StoredRequestAuth;
  ambientAuth?: AmbientAuthResolution;
}> {
  if (!input.transport?.credential) return {};
  if (input.override)
    return {
      credentialFingerprint: await authorizeCredentialOverride(input),
    };
  if (input.coordinator) {
    try {
      const storedAuth = await input.coordinator.resolveStoredAuth(
        {
          snapshot: input.provider,
          transport: input.transport,
          auth: input.auth,
        },
        input.scope,
        input.action ?? 'use',
        input.signal,
      );
      return {
        credentialFingerprint: fingerprintCredential(
          storedAuth.override,
          input.key,
        ),
        storedAuth,
      };
    } catch (error) {
      if (
        !(error instanceof AiRuntimeError) ||
        error.code !== 'CREDENTIAL_UNCONFIGURED'
      )
        throw error;
    }
  }
  if (input.auth?.ambient) {
    const allowed = await input.ambientPolicy?.allow(
      input.scope,
      input.provider,
    );
    if (allowed !== true)
      throw new AiRuntimeError(
        'AMBIENT_AUTH_DENIED',
        'auth',
        'ambient authentication is not allowed',
      );
    const ambientAuth = await input.auth.ambient.resolve({
      provider: input.provider,
      signal: input.signal ?? new AbortController().signal,
    });
    if (ambientAuth) return { ambientAuth };
  }
  return {
    credentialFingerprint: await authorizeCredentialOverride(input),
  };
}

async function resolveSessionScopeFingerprint<TScopeHandle>(input: {
  providerInstanceId: string;
  scope: TScopeHandle;
  storedAuth?: StoredRequestAuth;
  ambientAuth?: AmbientAuthResolution;
  scopeAuthority?: CredentialScopeAuthority<TScopeHandle>;
  runtimeScopeFingerprint(scope: TScopeHandle): string;
  action?: CredentialScopeAction;
  signal?: AbortSignal;
}): Promise<string> {
  if (input.storedAuth) return input.storedAuth.scopeFingerprint;
  if (input.ambientAuth) {
    if (!input.scopeAuthority)
      return input.runtimeScopeFingerprint(input.scope);
    const resolvedScope = await input.scopeAuthority.resolve(
      input.scope,
      {
        expectedProviderInstanceId: input.providerInstanceId,
        action: input.action ?? 'use',
      },
      input.signal,
    );
    return input.scopeAuthority.fingerprint(resolvedScope, input.signal);
  }
  if (!input.scopeAuthority) return input.runtimeScopeFingerprint(input.scope);
  const resolvedScope = await input.scopeAuthority.resolve(
    input.scope,
    {
      expectedProviderInstanceId: input.providerInstanceId,
      action: input.action ?? 'use',
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
  transport?: ChatTransportBinding;
  provider: ProviderSnapshot;
  scope: TScopeHandle;
  override?: RequestCredentialOverride;
  policy?: CredentialOverridePolicy<TScopeHandle>;
  key: Uint8Array;
}): Promise<string | undefined> {
  if (!input.transport?.credential) return undefined;
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
    .update(JSON.stringify(override.bindingFacts ?? null))
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
  ambientAuth?: AmbientAuthResolution;
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
    if (!input.ambientAuth && (!override || expectedFingerprint === undefined))
      return new AiRuntimeError(
        'CREDENTIAL_OVERRIDE_MISMATCH',
        'auth',
        'request credential override does not match the model handle',
      );
    const actualFingerprint = override
      ? fingerprintCredential(override, input.credentialFingerprintKey)
      : undefined;
    if (
      !input.ambientAuth &&
      actualFingerprint !== undefined &&
      !credentialFingerprintsEqual(actualFingerprint, expectedFingerprint!)
    )
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
  let endpointUrl: URL;
  let allowedOrigins: readonly string[];
  try {
    const endpoint = binding.endpointForCredential
      ? binding.endpointForCredential(
          input.model.definition,
          override?.bindingFacts,
        )
      : (binding.endpointForModel?.(input.model.definition) ??
        binding.endpoint);
    endpointUrl = new URL(endpoint);
    allowedOrigins = binding.derivedOriginPolicy
      ? [
          new URL(binding.endpoint).origin,
          ...binding.derivedOriginPolicy.resolve(override?.bindingFacts),
        ]
      : [new URL(binding.endpoint).origin];
  } catch {
    return new AiRuntimeError(
      'INVALID_REQUEST_TARGET',
      'invalid_request',
      'provider model endpoint or credential binding facts are invalid',
    );
  }
  if (!allowedOrigins.includes(endpointUrl.origin))
    return new AiRuntimeError(
      'MODEL_ENDPOINT_ORIGIN_MISMATCH',
      'invalid_request',
      'provider model endpoint is outside the authorized origin policy',
    );
  const headers: Record<
    string,
    string | import('../transport/request-transport.js').SecretHeaderValue
  > = { ...(binding.headers ?? {}) };
  if (binding.credential && override) {
    const requestedScheme = override.scheme ?? credentialScheme(override);
    const credentialBinding =
      binding.credential.variants?.[requestedScheme] ?? binding.credential;
    const headerName = credentialBinding.headerName.toLowerCase();
    if (Object.keys(headers).some((name) => name.toLowerCase() === headerName))
      return new AiRuntimeError(
        'PROTECTED_HEADER_CONFLICT',
        'invalid_request',
        'credential header conflicts with a configured request header',
      );
    headers[headerName] = createSecretHeaderValue(
      override.secret,
      credentialBinding.defaultScheme ?? requestedScheme,
    );
  }
  return bindRequestTransport({
    target: createFinalRequestTarget({
      endpoint: endpointUrl,
      headers,
      limits: binding.limits,
    }),
    driver: input.driver,
    networkPolicy: input.networkPolicy,
    retry: input.retry,
    retrySafety: binding.retrySafety,
    redirect: binding.redirect,
    authorize: input.ambientAuth?.authorize,
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
  ambientAuth?: AmbientAuthResolution;
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
      const preparedContext = prepareContext(
        contextResult.context,
        input.model.definition,
        input.resolved,
      );
      if (preparedContext instanceof AiRuntimeError) {
        terminal = { status: 'failed', error: preparedContext };
        const sinkError = await sink.close();
        if (sinkError)
          terminal = { status: 'failed', error: failedError(sinkError) };
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
        return;
      }
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
          ambientAuth: input.ambientAuth,
          retry: input.resolved.retry,
        });
        if (transportResult instanceof AiRuntimeError) {
          terminal = { status: 'failed', error: transportResult };
        } else {
          const storedAuth = input.storedAuth;
          const credentialIdentity =
            storedAuth?.credentialInstanceId ??
            input.ambientAuth?.credentialInstanceId ??
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
            context: preparedContext,
            options: { ...input.resolved, signal: input.stream.signal },
            signal: input.stream.signal,
            session,
            ...(transportResult ? { transport: transportResult } : {}),
          };
          terminal = await runProviderChat(
            () => input.chat.runChat(request, sink),
            input.stream.signal,
          );
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

async function runProviderChat(
  run: () => Promise<ProtocolTerminal>,
  signal: AbortSignal,
): Promise<ProtocolTerminal> {
  if (signal.aborted)
    return { status: 'cancelled', error: cancelledError(signal.reason) };
  let onAbort: (() => void) | undefined;
  const providerOutcome = Promise.resolve()
    .then(run)
    .then((terminal) => ({ kind: 'provider' as const, terminal }));
  const abortOutcome = new Promise<Readonly<{ kind: 'abort' }>>((resolve) => {
    onAbort = () => resolve({ kind: 'abort' });
    signal.addEventListener('abort', onAbort, { once: true });
  });
  let outcome: Awaited<typeof providerOutcome> | Readonly<{ kind: 'abort' }>;
  try {
    outcome = await Promise.race([providerOutcome, abortOutcome]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
  if (outcome.kind === 'provider') return outcome.terminal;
  void providerOutcome.catch(() => undefined);
  return { status: 'cancelled', error: cancelledError(signal.reason) };
}

function prepareContext<TProtocol extends string>(
  context: Readonly<AiContext>,
  model: Readonly<ModelDefinition<TProtocol>>,
  options: Readonly<ResolvedStreamOptions<TProtocol>>,
): Readonly<AiContext> | AiRuntimeError {
  const selectedTool =
    typeof options.toolChoice === 'object'
      ? options.toolChoice.name
      : undefined;
  if (
    selectedTool !== undefined &&
    !context.tools?.some((tool) => tool.name === selectedTool)
  )
    return new AiRuntimeError(
      'TOOL_CHOICE_INVALID',
      'invalid_request',
      `selected tool is not defined: ${selectedTool}`,
    );
  if (
    (options.toolChoice === 'required' || selectedTool !== undefined) &&
    (!model.capabilities.toolCalling || !context.tools?.length)
  )
    return new AiRuntimeError(
      'TOOL_CHOICE_UNSUPPORTED',
      'invalid_request',
      'tool choice requires a tool-capable model and at least one tool',
    );

  const tools: import('../core/messages.js').ToolDefinition[] = [];
  for (const tool of context.tools ?? []) {
    if (
      tool.deferred &&
      options.contextPolicy.deferredTools === 'require-deferred' &&
      !model.capabilities.deferredTools
    )
      return new AiRuntimeError(
        'DEFERRED_TOOLS_UNSUPPORTED',
        'invalid_request',
        'deferred tools are not supported by this model',
      );
    tools.push(
      tool.deferred &&
        options.contextPolicy.deferredTools === 'eager-fallback' &&
        !model.capabilities.deferredTools
        ? Object.freeze({ ...tool, deferred: false })
        : tool,
    );
  }

  const messages: import('../core/messages.js').Message[] = [];
  for (const message of context.messages) {
    if (
      message.role === 'assistant' &&
      (message.status === 'failed' || message.status === 'cancelled') &&
      options.contextPolicy.failedTurn === 'drop'
    )
      continue;
    if (message.role === 'assistant') {
      const sourceModel = (
        message as import('../core/messages.js').AssistantMessage
      ).model;
      const crossProvider =
        sourceModel !== undefined &&
        sourceModel.providerInstanceId !== model.providerInstanceId;
      const content: (
        | import('../core/content.js').TextContent
        | import('../core/content.js').ReasoningContent
        | import('../core/content.js').ToolCallContent
      )[] = [];
      for (const part of message.content) {
        if (part.type === 'reasoning' && crossProvider) {
          if (options.contextPolicy.crossProviderReasoning === 'drop') continue;
          if (options.contextPolicy.crossProviderReasoning === 'as-text') {
            if (part.text) content.push({ type: 'text', text: part.text });
            continue;
          }
        }
        if (part.type === 'tool_call' && part.status === 'incomplete') {
          if (options.contextPolicy.incompleteToolCall === 'drop') continue;
          content.push({
            type: 'text',
            text: `${part.name}(${part.rawArguments})`,
          });
          continue;
        }
        content.push(part);
      }
      messages.push(
        Object.freeze({ ...message, content: Object.freeze(content) }),
      );
      continue;
    }

    const content: (
      | import('../core/content.js').TextContent
      | import('../core/content.js').ImageContent
    )[] = [];
    for (const part of message.content) {
      if (
        part.type === 'image' &&
        !model.capabilities.input.includes('image')
      ) {
        if (options.contextPolicy.unsupportedImage === 'reject')
          return new AiRuntimeError(
            'CONTEXT_IMAGE_UNSUPPORTED',
            'invalid_request',
            'context contains an image unsupported by this model',
          );
        content.push({
          type: 'text',
          text: '[unsupported image omitted]',
        });
      } else content.push(part);
    }
    messages.push(
      Object.freeze({ ...message, content: Object.freeze(content) }),
    );
  }

  let prepared: Readonly<AiContext> = Object.freeze({
    ...(context.systemPrompt ? { systemPrompt: context.systemPrompt } : {}),
    messages: Object.freeze(messages),
    ...(tools.length ? { tools: Object.freeze(tools) } : {}),
  });
  if (estimateContextTokens(prepared) <= model.limits.contextTokens)
    return prepared;
  if (options.contextPolicy.tokenBudget === 'truncate-oldest-safe-turns') {
    const truncated = [...prepared.messages];
    while (
      truncated.length > 0 &&
      estimateContextTokens({ ...prepared, messages: truncated }) >
        model.limits.contextTokens
    )
      truncated.shift();
    prepared = Object.freeze({
      ...prepared,
      messages: Object.freeze(truncated),
    });
    if (estimateContextTokens(prepared) <= model.limits.contextTokens)
      return prepared;
  }
  return new AiRuntimeError(
    'CONTEXT_OVERFLOW',
    'invalid_request',
    'context exceeds the model token limit',
  );
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
    diagnostics: toPublicDiagnostics(input.terminal.diagnostics),
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
      error: cancelledError(input.terminal.error),
    };
  return {
    ...base,
    status: 'failed',
    finishReason: 'error',
    partial: orderedContent.length > 0,
    error: failedError(input.terminal.error),
  };
}

function failedError(error: unknown): AiError {
  return toPublicAiError(error, {
    code: 'INTERNAL_ERROR',
    category: 'internal',
    message: 'AI provider failed internally',
  });
}

function cancelledError(error: unknown): AiError & { category: 'cancelled' } {
  return toPublicAiError(error, {
    code: 'REQUEST_CANCELLED',
    category: 'cancelled',
    message: 'request cancelled',
  }) as AiError & { category: 'cancelled' };
}
