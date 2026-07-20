import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import {
  credentialScheme,
  type RequestCredentialOverride,
} from '../auth/api-key.js';
import type { CredentialOverridePolicy } from '../auth/override-policy.js';
import { revealSecret } from '../auth/secret-value.js';
import { AiRuntimeError, type AiError } from '../core/errors.js';
import type { ProviderSnapshot } from '../core/models.js';
import type { ProviderRegistry } from '../runtime/registry.js';
import {
  bindRequestTransport,
  createFinalRequestTarget,
  createSecretHeaderValue,
} from '../transport/request-transport.js';
import type { NetworkPolicy, TransportDriver } from '../transport/types.js';
import { calculateImageCost } from './cost.js';
import type {
  DirectImageProtocolBinding,
  ImageGenerationOptions,
  ImageModelsApi,
  ImagesApi,
} from './contracts.js';
import {
  resolveImageGenerationInput,
  type ImageGenerationInput,
} from './input.js';
import {
  sameImageModelRef,
  type ImageModelDefinition,
  type ImageModelHandle,
  type ImageModelListFilter,
  type ImageModelRef,
} from './models.js';
import type { ImageGenerationOutput, ImageGenerationResult } from './output.js';
import { DirectImageGenerationStream } from './stream.js';

const handleRuntime = new WeakMap<object, symbol>();
const handleProviderGeneration = new WeakMap<object, string>();
const handleCredentialFingerprint = new WeakMap<object, string>();
const handleCredentialOverride = new WeakMap<
  object,
  RequestCredentialOverride
>();
const handleAssertCredentialCurrent = new WeakMap<
  object,
  (signal?: AbortSignal) => Promise<void>
>();

export interface CreateImagesApiOptions<TScopeHandle> {
  readonly registry: ProviderRegistry;
  readonly runtimeId: symbol;
  readonly transport?: TransportDriver;
  readonly networkPolicy?: NetworkPolicy;
  readonly credentialOverridePolicy?: CredentialOverridePolicy<TScopeHandle>;
  readonly imageDefaults?: Readonly<{
    timeoutMs?: number;
    responseFormat?: 'url' | 'base64';
    pollIntervalMs?: number;
  }>;
  readonly resolveAuth?: (input: {
    readonly provider: ProviderSnapshot;
    readonly scope: TScopeHandle;
    readonly override?: RequestCredentialOverride;
    readonly signal?: AbortSignal;
  }) => Promise<
    Readonly<{
      requestCredential?: RequestCredentialOverride;
      assertCurrent?: (signal?: AbortSignal) => Promise<void>;
    }>
  >;
}

export function createImagesApi<TScopeHandle>(
  options: CreateImagesApiOptions<TScopeHandle>,
): ImagesApi<TScopeHandle> {
  const credentialKey = randomBytes(32);

  const models: ImageModelsApi<TScopeHandle> = {
    find: async <TProtocol extends string>(
      ref: ImageModelRef<TProtocol>,
      scope: TScopeHandle,
      readOptions: import('./contracts.js').ImageModelReadOptions | undefined,
    ) => {
      const entry = options.registry.get(ref.providerInstanceId);
      const definition = entry?.provider.images?.models.find((candidate) =>
        sameImageModelRef(candidate, ref),
      );
      if (!entry || !definition) return undefined;
      const binding = findBinding(
        entry.provider.images!.protocols,
        definition.protocol,
      );
      const resolvedAuth = options.resolveAuth
        ? await options.resolveAuth({
            provider: entry.snapshot,
            scope,
            override: readOptions?.credentialOverride,
            signal: readOptions?.signal,
          })
        : await authorizeOverride({
            binding,
            provider: entry.snapshot,
            scope,
            override: readOptions?.credentialOverride,
            policy: options.credentialOverridePolicy,
          });
      return makeHandle(
        definition as ImageModelDefinition<TProtocol>,
        entry.snapshot,
        options.runtimeId,
        bindHandleAuth(resolvedAuth, credentialKey),
      );
    },
    require: async <TProtocol extends string>(
      ref: ImageModelRef<TProtocol>,
      scope: TScopeHandle,
      readOptions: import('./contracts.js').ImageModelReadOptions | undefined,
    ) => {
      const model = await models.find(ref, scope, readOptions);
      if (!model)
        throw new AiRuntimeError(
          'IMAGE_MODEL_NOT_FOUND',
          'invalid_request',
          `image model not found: ${ref.providerInstanceId}/${ref.modelId}`,
        );
      return model;
    },
    list: async (
      scope: TScopeHandle,
      filter?: ImageModelListFilter,
      readOptions?,
    ) => {
      if (readOptions?.credentialOverride && !filter?.providerInstanceId)
        throw new AiRuntimeError(
          'CREDENTIAL_OVERRIDE_PROVIDER_REQUIRED',
          'invalid_request',
          'providerInstanceId is required when listing image models with a credential override',
        );
      const handles: ImageModelHandle[] = [];
      for (const snapshot of options.registry.list()) {
        if (
          filter?.providerInstanceId &&
          filter.providerInstanceId !== snapshot.id
        )
          continue;
        const entry = options.registry.get(snapshot.id);
        if (!entry?.provider.images) continue;
        for (const definition of entry.provider.images.models) {
          if (filter?.protocol && definition.protocol !== filter.protocol)
            continue;
          const binding = findBinding(
            entry.provider.images.protocols,
            definition.protocol,
          );
          const resolvedAuth = options.resolveAuth
            ? await options.resolveAuth({
                provider: snapshot,
                scope,
                override: readOptions?.credentialOverride,
                signal: readOptions?.signal,
              })
            : await authorizeOverride({
                binding,
                provider: snapshot,
                scope,
                override: readOptions?.credentialOverride,
                policy: options.credentialOverridePolicy,
              });
          handles.push(
            makeHandle(
              definition,
              snapshot,
              options.runtimeId,
              bindHandleAuth(resolvedAuth, credentialKey),
            ),
          );
        }
      }
      return { models: Object.freeze(handles) };
    },
  };

  const stream = <TProtocol extends string>(
    model: ImageModelHandle<TProtocol>,
    input: ImageGenerationInput,
    callOptions: ImageGenerationOptions<TProtocol> = {},
  ) =>
    new DirectImageGenerationStream(async (generationStream) => {
      const startedAt = Date.now();
      const requestId = randomUUID();
      const outputs: ImageGenerationOutput[] = [];
      let sequence = 0;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const base = {
        requestId,
        model: model.definition as Readonly<ImageModelDefinition>,
        outputs,
        startedAt,
      };
      try {
        assertHandle(model, options.runtimeId, options.registry);
        const entry = options.registry.get(model.ref.providerInstanceId)!;
        const binding = findBinding(
          entry.provider.images!.protocols,
          model.definition.protocol,
        );
        const adapter = await binding.loadAdapter();
        const resolvedOptions = resolveOptions(
          binding,
          model.definition,
          callOptions,
          generationStream.signal,
          options.imageDefaults,
          adapter.contract,
        );
        timeout = setTimeout(() => {
          timedOut = true;
          generationStream.abort('image generation timeout');
        }, resolvedOptions.timeoutMs);
        await handleAssertCredentialCurrent.get(model as object)?.(
          generationStream.signal,
        );
        const resolvedInput = await resolveImageGenerationInput({
          model: model.definition,
          value: input,
          driver: options.transport,
          networkPolicy: options.networkPolicy,
          signal: generationStream.signal,
        });
        const transport = resolveTransport({
          binding,
          model,
          override:
            callOptions.credentialOverride ??
            handleCredentialOverride.get(model as object),
          key: credentialKey,
          driver: options.transport,
          networkPolicy: options.networkPolicy,
          retry: resolvedOptions.retry,
        });
        await generationStream.publish({
          type: 'generation_start',
          sequence: sequence++,
          model: model.definition,
        });
        const profile =
          binding.profiles?.[model.definition.protocolProfileId] ??
          (binding.defaultProfile.id === model.definition.protocolProfileId
            ? binding.defaultProfile
            : undefined);
        if (!profile)
          throw new AiRuntimeError(
            'IMAGE_PROTOCOL_PROFILE_NOT_FOUND',
            'invalid_request',
            'image protocol profile is not registered',
          );
        const adapterTerminal = await adapter.run(
          {
            provider: entry.snapshot,
            model: model.definition,
            input: resolvedInput,
            compatibility: profile.compatibility,
            options: resolvedOptions,
            transport,
            signal: generationStream.signal,
          },
          {
            publish: async (event) => {
              if (event.type === 'generation_output')
                outputs[event.outputIndex] = event.output;
              await generationStream.publish({
                ...event,
                sequence: sequence++,
              });
            },
          },
        );
        const terminal = timedOut
          ? ({ status: 'cancelled', error: timeoutError() } as const)
          : adapterTerminal;
        const completedAt = Date.now();
        const cost = terminal.usage
          ? calculateImageCost(model.definition, terminal.usage)
          : undefined;
        if (terminal.status === 'completed') {
          const result: Extract<
            ImageGenerationResult,
            { status: 'completed' }
          > = Object.freeze({
            ...base,
            outputs: Object.freeze([...outputs]),
            status: 'completed',
            partial: false,
            ...(terminal.responseId ? { responseId: terminal.responseId } : {}),
            ...(terminal.usage ? { usage: terminal.usage } : {}),
            ...(cost ? { cost } : {}),
            ...(terminal.diagnostics
              ? { diagnostics: terminal.diagnostics }
              : {}),
            completedAt,
          });
          await generationStream.complete(result, {
            type: 'generation_end',
            sequence: sequence++,
            result,
          });
          return;
        }
        const result = failureResult({
          ...base,
          outputs: Object.freeze([...outputs]),
          completedAt,
          status: terminal.status,
          error: terminal.error,
          responseId: terminal.responseId,
          usage: terminal.usage,
          cost,
          diagnostics: terminal.diagnostics,
        });
        await generationStream.complete(result, {
          type: 'generation_error',
          sequence: sequence++,
          result,
        });
      } catch (error) {
        const normalized = timedOut
          ? timeoutError()
          : normalizeError(error, generationStream.signal.aborted);
        const result = failureResult({
          ...base,
          outputs: Object.freeze([...outputs]),
          completedAt: Date.now(),
          status: normalized.category === 'cancelled' ? 'cancelled' : 'failed',
          error: normalized,
        });
        await generationStream.complete(result, {
          type: 'generation_error',
          sequence: sequence++,
          result,
        });
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    }, callOptions.signal);

  return Object.freeze({
    models: Object.freeze(models),
    stream,
    generate: async <TProtocol extends string>(
      model: ImageModelHandle<TProtocol>,
      input: ImageGenerationInput,
      callOptions?: ImageGenerationOptions<TProtocol>,
    ) => stream(model, input, callOptions).result(),
  });
}

function makeHandle<TProtocol extends string>(
  definition: Readonly<ImageModelDefinition<TProtocol>>,
  snapshot: ProviderSnapshot,
  runtimeId: symbol,
  auth: Readonly<{
    credentialFingerprint?: string;
    requestCredential?: RequestCredentialOverride;
    assertCurrent?: (signal?: AbortSignal) => Promise<void>;
  }>,
): ImageModelHandle<TProtocol> {
  const handle = Object.freeze({
    ref: Object.freeze({
      providerInstanceId: definition.providerInstanceId,
      modelId: definition.id,
      protocol: definition.protocol,
    }),
    definition,
  });
  handleRuntime.set(handle, runtimeId);
  handleProviderGeneration.set(handle, snapshot.registrationGeneration);
  if (auth.credentialFingerprint)
    handleCredentialFingerprint.set(handle, auth.credentialFingerprint);
  if (auth.requestCredential)
    handleCredentialOverride.set(handle, auth.requestCredential);
  if (auth.assertCurrent)
    handleAssertCredentialCurrent.set(handle, auth.assertCurrent);
  return handle;
}

function assertHandle(
  model: ImageModelHandle,
  runtimeId: symbol,
  registry: ProviderRegistry,
): void {
  if (handleRuntime.get(model as object) !== runtimeId)
    throw new AiRuntimeError(
      'IMAGE_MODEL_HANDLE_RUNTIME_MISMATCH',
      'invalid_request',
      'image model handle belongs to another runtime',
    );
  const entry = registry.get(model.ref.providerInstanceId);
  if (
    !entry ||
    handleProviderGeneration.get(model as object) !==
      entry.snapshot.registrationGeneration
  )
    throw new AiRuntimeError(
      'IMAGE_MODEL_HANDLE_STALE',
      'invalid_request',
      'image model handle is stale',
    );
}

function findBinding(
  bindings: readonly DirectImageProtocolBinding[],
  protocol: string,
): DirectImageProtocolBinding {
  const binding = bindings.find((candidate) => candidate.protocol === protocol);
  if (!binding)
    throw new AiRuntimeError(
      'IMAGE_PROTOCOL_BINDING_NOT_FOUND',
      'invalid_request',
      `image protocol binding not found: ${protocol}`,
    );
  return binding;
}

async function authorizeOverride<TScopeHandle>(input: {
  readonly binding: DirectImageProtocolBinding;
  readonly provider: ProviderSnapshot;
  readonly scope: TScopeHandle;
  readonly override?: RequestCredentialOverride;
  readonly policy?: CredentialOverridePolicy<TScopeHandle>;
}): Promise<Readonly<{ requestCredential?: RequestCredentialOverride }>> {
  if (!input.binding.credential) {
    if (input.override)
      throw new AiRuntimeError(
        'CREDENTIAL_OVERRIDE_MISMATCH',
        'auth',
        'image provider does not accept a credential override',
      );
    return Object.freeze({});
  }
  if (!input.override)
    throw new AiRuntimeError(
      'CREDENTIAL_OVERRIDE_REQUIRED',
      'auth',
      'a request credential override is required for this image provider',
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
  return Object.freeze({ requestCredential: input.override });
}

function bindHandleAuth(
  auth: Readonly<{
    requestCredential?: RequestCredentialOverride;
    assertCurrent?: (signal?: AbortSignal) => Promise<void>;
  }>,
  key: Uint8Array,
): Readonly<{
  credentialFingerprint?: string;
  requestCredential?: RequestCredentialOverride;
  assertCurrent?: (signal?: AbortSignal) => Promise<void>;
}> {
  return Object.freeze({
    ...(auth.requestCredential
      ? {
          requestCredential: auth.requestCredential,
          credentialFingerprint: fingerprintCredential(
            auth.requestCredential,
            key,
          ),
        }
      : {}),
    ...(auth.assertCurrent ? { assertCurrent: auth.assertCurrent } : {}),
  });
}

function resolveTransport(input: {
  readonly binding: DirectImageProtocolBinding;
  readonly model: ImageModelHandle;
  readonly override?: RequestCredentialOverride;
  readonly key: Uint8Array;
  readonly driver?: TransportDriver;
  readonly networkPolicy?: NetworkPolicy;
  readonly retry: false | import('../transport/retry.js').RetryPolicy;
}) {
  if (!input.driver || !input.networkPolicy)
    throw new AiRuntimeError(
      'TRANSPORT_UNAVAILABLE',
      'invalid_request',
      'transport and network policy are required for this image provider',
    );
  const expected = handleCredentialFingerprint.get(input.model as object);
  if (input.binding.credential) {
    if (!input.override || !expected)
      throw new AiRuntimeError(
        'CREDENTIAL_OVERRIDE_MISMATCH',
        'auth',
        'request credential override does not match the image model handle',
      );
    const actual = fingerprintCredential(input.override, input.key);
    if (!fingerprintsEqual(actual, expected))
      throw new AiRuntimeError(
        'CREDENTIAL_OVERRIDE_MISMATCH',
        'auth',
        'request credential override does not match the image model handle',
      );
  } else if (input.override) {
    throw new AiRuntimeError(
      'CREDENTIAL_OVERRIDE_MISMATCH',
      'auth',
      'image model handle is not bound to a credential override',
    );
  }
  const headers: Record<
    string,
    string | ReturnType<typeof createSecretHeaderValue>
  > = { ...(input.binding.headers ?? {}) };
  if (input.binding.credential && input.override) {
    headers[input.binding.credential.headerName] = createSecretHeaderValue(
      input.override.secret,
      input.override.scheme ??
        input.binding.credential.defaultScheme ??
        'Bearer',
    );
  }
  return bindRequestTransport({
    target: createFinalRequestTarget({
      endpoint: new URL(input.binding.endpoint),
      headers: Object.freeze(headers),
      limits: input.binding.limits,
    }),
    driver: input.driver,
    networkPolicy: input.networkPolicy,
    retry: input.retry,
    retrySafety: input.binding.retrySafety,
    redirect: 'error',
  });
}

function resolveOptions<TProtocol extends string>(
  binding: DirectImageProtocolBinding<TProtocol>,
  model: Readonly<ImageModelDefinition<TProtocol>>,
  input: ImageGenerationOptions<TProtocol>,
  signal: AbortSignal,
  runtimeDefaults:
    | Readonly<{
        timeoutMs?: number;
        responseFormat?: 'url' | 'base64';
        pollIntervalMs?: number;
      }>
    | undefined,
  contract: import('./contracts.js').ImageProtocolContract<TProtocol>,
) {
  const profile =
    binding.profiles?.[model.protocolProfileId] ??
    (binding.defaultProfile.id === model.protocolProfileId
      ? binding.defaultProfile
      : undefined);
  const protocolOptions = contract.mergeOptions([
    binding.requestDefaults?.protocolOptions as
      import('./contracts.js').ImageProtocolOptions<TProtocol> | undefined,
    profile?.protocolDefaults as
      import('./contracts.js').ImageProtocolOptions<TProtocol> | undefined,
    input.protocolOptions,
  ]);
  const responseFormat =
    input.responseFormat ??
    runtimeDefaults?.responseFormat ??
    model.requestDefaults?.responseFormat ??
    binding.requestDefaults?.responseFormat ??
    'base64';
  if (!model.capabilities.outputFormats.includes(responseFormat))
    throw new AiRuntimeError(
      'IMAGE_RESPONSE_FORMAT_UNSUPPORTED',
      'invalid_request',
      'image response format is not supported by this model',
    );
  return {
    signal,
    timeoutMs:
      input.timeoutMs ??
      runtimeDefaults?.timeoutMs ??
      model.requestDefaults?.timeoutMs ??
      binding.requestDefaults?.timeoutMs ??
      60_000,
    retry:
      input.retry ??
      model.requestDefaults?.retry ??
      binding.requestDefaults?.retry ??
      false,
    responseFormat,
    pollIntervalMs:
      input.pollIntervalMs ??
      runtimeDefaults?.pollIntervalMs ??
      model.requestDefaults?.pollIntervalMs ??
      binding.requestDefaults?.pollIntervalMs ??
      1_000,
    protocolOptions,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  } as unknown as import('./contracts.js').ResolvedImageGenerationOptions<TProtocol>;
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

function fingerprintsEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'base64url');
  const rightBytes = Buffer.from(right, 'base64url');
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function failureResult(input: {
  readonly requestId: string;
  readonly model: Readonly<ImageModelDefinition>;
  readonly outputs: readonly ImageGenerationOutput[];
  readonly startedAt: number;
  readonly completedAt: number;
  readonly status: 'failed' | 'cancelled';
  readonly error: AiError;
  readonly responseId?: string;
  readonly usage?: import('./cost.js').ImageUsage;
  readonly cost?: import('./cost.js').ImageCost;
  readonly diagnostics?: readonly import('../core/events.js').AiDiagnostic[];
}): Extract<ImageGenerationResult, { status: 'failed' | 'cancelled' }> {
  const common = {
    requestId: input.requestId,
    model: input.model,
    outputs: input.outputs,
    partial: input.outputs.length > 0,
    error: input.error,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    ...(input.responseId ? { responseId: input.responseId } : {}),
    ...(input.usage ? { usage: input.usage } : {}),
    ...(input.cost ? { cost: input.cost } : {}),
    ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
  };
  return Object.freeze(
    input.status === 'cancelled'
      ? {
          ...common,
          status: 'cancelled',
          error: input.error as AiError & { category: 'cancelled' },
        }
      : { ...common, status: 'failed' },
  ) as Extract<ImageGenerationResult, { status: 'failed' | 'cancelled' }>;
}

function normalizeError(error: unknown, aborted: boolean): AiError {
  if (aborted)
    return new AiRuntimeError(
      'IMAGE_GENERATION_CANCELLED',
      'cancelled',
      'image generation was cancelled',
    );
  return error instanceof AiRuntimeError
    ? error
    : new AiRuntimeError(
        'IMAGE_GENERATION_INTERNAL_ERROR',
        'internal',
        error instanceof Error ? error.message : 'image generation failed',
      );
}

function timeoutError(): AiError & { readonly category: 'cancelled' } {
  return new AiRuntimeError(
    'IMAGE_GENERATION_TIMEOUT',
    'cancelled',
    'image generation timed out',
  ) as AiError & { readonly category: 'cancelled' };
}
