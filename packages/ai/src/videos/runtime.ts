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
import type { CredentialScopeAction } from '../auth/scope-authority.js';
import { revealSecret } from '../auth/secret-value.js';
import { AiRuntimeError, type AiError } from '../core/errors.js';
import { toPublicAiError, toPublicDiagnostics } from '../core/public-errors.js';
import type {
  CredentialIdentityLifetime,
  ProviderSnapshot,
} from '../core/models.js';
import {
  GenerationOperationMachine,
  resolveGenerationOperationPolicy,
  validateGenerationOperationEnvelope,
  validateGenerationOperationTimes,
  type GenerationOperationCodec,
  type GenerationOperationPolicy,
  type OperationCredentialVerifier,
} from '../generation/index.js';
import type { ProviderRegistry } from '../runtime/registry.js';
import {
  bindRequestTransport,
  createFinalRequestTarget,
  createSecretHeaderValue,
} from '../transport/request-transport.js';
import type { NetworkPolicy, TransportDriver } from '../transport/types.js';
import { calculateVideoCost } from './cost.js';
import type {
  VideoGenerationOptions,
  VideoModelsApi,
  VideoOperationResumeOptions,
  VideoProtocolAdapter,
  VideoProtocolBinding,
  VideoProtocolProfile,
  VideosApi,
  ResolvedVideoOperationResumeOptions,
  ResumableVideoProtocolAdapter,
  ResumableVideoProtocolBinding,
} from './contracts.js';
import {
  resolveVideoGenerationInput,
  type VideoGenerationInput,
} from './input.js';
import {
  sameVideoModelRef,
  type VideoModelDefinition,
  type VideoModelHandle,
  type VideoModelListFilter,
  type VideoModelRef,
} from './models.js';
import {
  asSerializedVideoOperationRef,
  createVideoOperationRef,
  fingerprintVideoGenerationInput,
  fingerprintVideoOperationBinding,
  fingerprintVideoProtocolProfile,
  videoClaimsEnvelope,
  inspectVideoOperationRef,
  parseVideoOperationEnvelope,
  parseSerializedVideoOperationRef,
  type VideoOperationClaims,
  type VideoOperationRef,
  type SerializedVideoOperationRef,
} from './operation-claims.js';
import type { VideoGenerationOutput, VideoGenerationResult } from './output.js';
import { projectVideoProtocolEvent } from './operation-projector.js';
import { DirectVideoGenerationStream } from './stream.js';

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
const handleOperationAuth = new WeakMap<object, BoundVideoOperationAuth>();

interface ResolvedVideoAuth {
  readonly requestCredential?: RequestCredentialOverride;
  readonly assertCurrent?: (signal?: AbortSignal) => Promise<void>;
  readonly authSource?: 'stored' | 'ambient' | 'override';
  readonly credentialInstanceId?: string;
  readonly credentialIdentityLifetime?: CredentialIdentityLifetime;
  readonly credentialScopeFingerprint?: string;
  readonly scopeIdentityLifetime?: CredentialIdentityLifetime;
  readonly authBindingFingerprint?: string;
}

interface BoundVideoOperationAuth {
  readonly authSource: 'stored' | 'ambient' | 'override';
  readonly credentialInstanceId?: string;
  readonly credentialIdentityLifetime: CredentialIdentityLifetime;
  readonly credentialScopeFingerprint: string;
  readonly scopeIdentityLifetime: CredentialIdentityLifetime;
  readonly authBindingFingerprint: string;
}

export interface CreateVideosApiOptions<TScopeHandle> {
  readonly registry: ProviderRegistry;
  readonly runtimeId: symbol;
  readonly transport?: TransportDriver;
  readonly networkPolicy?: NetworkPolicy;
  readonly credentialOverridePolicy?: CredentialOverridePolicy<TScopeHandle>;
  readonly videoDefaults?: Readonly<{
    timeoutMs?: number;
    responseFormat?: 'url' | 'base64';
    pollIntervalMs?: number;
  }>;
  readonly generationOperationCodec?: GenerationOperationCodec;
  readonly operationCredentialVerifier?: OperationCredentialVerifier;
  readonly generationOperationPolicy?: GenerationOperationPolicy;
  readonly now?: () => number;
  readonly beginOperation?: (
    abort: () => void,
  ) => Readonly<{ release(): void }>;
  readonly resolveAuth?: (input: {
    readonly binding: VideoProtocolBinding;
    readonly provider: ProviderSnapshot;
    readonly scope: TScopeHandle;
    readonly action: CredentialScopeAction;
    readonly override?: RequestCredentialOverride;
    readonly signal?: AbortSignal;
  }) => Promise<Readonly<ResolvedVideoAuth>>;
}

export function createVideosApi<TScopeHandle>(
  options: CreateVideosApiOptions<TScopeHandle>,
): VideosApi<TScopeHandle> & Readonly<{ dispose(): void }> {
  const credentialKey = randomBytes(32);
  const policy = resolveGenerationOperationPolicy(
    options.generationOperationPolicy,
  );
  const now = options.now ?? Date.now;
  const scopeFingerprint = createRuntimeScopeFingerprinter<TScopeHandle>();

  const resolveAuth = async (input: {
    binding: VideoProtocolBinding;
    provider: ProviderSnapshot;
    scope: TScopeHandle;
    action: CredentialScopeAction;
    override?: RequestCredentialOverride;
    signal?: AbortSignal;
  }): Promise<Readonly<ResolvedVideoAuth>> => {
    if (options.resolveAuth)
      return options.resolveAuth({
        binding: input.binding,
        provider: input.provider,
        scope: input.scope,
        action: input.action,
        ...(input.override ? { override: input.override } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    return authorizeOverride({
      binding: input.binding,
      provider: input.provider,
      scope: input.scope,
      override: input.override,
      policy: options.credentialOverridePolicy,
      scopeFingerprint: scopeFingerprint(input.scope),
    });
  };

  const findModel = async <TProtocol extends string>(
    ref: VideoModelRef<TProtocol>,
    scope: TScopeHandle,
    readOptions: import('./contracts.js').VideoModelReadOptions | undefined,
    action: CredentialScopeAction,
  ): Promise<VideoModelHandle<TProtocol> | undefined> => {
    const entry = options.registry.get(ref.providerInstanceId);
    const definition = entry?.provider.videos?.models.find((candidate) =>
      sameVideoModelRef(candidate, ref),
    );
    if (!entry || !definition) return undefined;
    const binding = findBinding(
      entry.provider.videos!.protocols,
      definition.protocol,
    );
    const auth = await resolveAuth({
      binding,
      provider: entry.snapshot,
      scope,
      action,
      override: readOptions?.credentialOverride,
      signal: readOptions?.signal,
    });
    return makeHandle(
      definition as VideoModelDefinition<TProtocol>,
      entry.snapshot,
      options.runtimeId,
      bindHandleAuth(auth, credentialKey, entry.snapshot),
    );
  };

  const requireModel = async <TProtocol extends string>(
    ref: VideoModelRef<TProtocol>,
    scope: TScopeHandle,
    readOptions: import('./contracts.js').VideoModelReadOptions | undefined,
    action: CredentialScopeAction,
  ): Promise<VideoModelHandle<TProtocol>> => {
    const model = await findModel(ref, scope, readOptions, action);
    if (!model)
      throw new AiRuntimeError(
        'VIDEO_MODEL_NOT_FOUND',
        'invalid_request',
        `video model not found: ${ref.providerInstanceId}/${ref.modelId}`,
      );
    return model;
  };

  const models: VideoModelsApi<TScopeHandle> = {
    find: <TProtocol extends string>(
      ref: VideoModelRef<TProtocol>,
      scope: TScopeHandle,
      readOptions: import('./contracts.js').VideoModelReadOptions | undefined,
    ) => findModel(ref, scope, readOptions, 'use'),
    require: <TProtocol extends string>(
      ref: VideoModelRef<TProtocol>,
      scope: TScopeHandle,
      readOptions: import('./contracts.js').VideoModelReadOptions | undefined,
    ) => requireModel(ref, scope, readOptions, 'use'),
    list: async (
      scope: TScopeHandle,
      filter?: VideoModelListFilter,
      readOptions?,
    ) => {
      if (readOptions?.credentialOverride && !filter?.providerInstanceId)
        throw new AiRuntimeError(
          'CREDENTIAL_OVERRIDE_PROVIDER_REQUIRED',
          'invalid_request',
          'providerInstanceId is required when listing video models with a credential override',
        );
      const handles: VideoModelHandle[] = [];
      for (const snapshot of options.registry.list()) {
        if (
          filter?.providerInstanceId &&
          filter.providerInstanceId !== snapshot.id
        )
          continue;
        const entry = options.registry.get(snapshot.id);
        if (!entry?.provider.videos) continue;
        for (const definition of entry.provider.videos.models) {
          if (filter?.protocol && definition.protocol !== filter.protocol)
            continue;
          const binding = findBinding(
            entry.provider.videos.protocols,
            definition.protocol,
          );
          const auth = await resolveAuth({
            binding,
            provider: snapshot,
            scope,
            action: 'use',
            override: readOptions?.credentialOverride,
            signal: readOptions?.signal,
          });
          handles.push(
            makeHandle(
              definition,
              snapshot,
              options.runtimeId,
              bindHandleAuth(auth, credentialKey, snapshot),
            ),
          );
        }
      }
      return { models: Object.freeze(handles) };
    },
  };

  const stream = <TProtocol extends string>(
    model: VideoModelHandle<TProtocol>,
    input: VideoGenerationInput,
    callOptions: VideoGenerationOptions<TProtocol> = {},
  ): DirectVideoGenerationStream => {
    const machine = new GenerationOperationMachine<VideoOperationRef>();
    let sequence = 0;
    let detachedBase:
      | Readonly<{
          requestId: string;
          model: Readonly<VideoModelDefinition>;
          outputs: VideoGenerationOutput[];
          startedAt: number;
        }>
      | undefined;

    return new DirectVideoGenerationStream(
      async (generationStream) => {
        const startedAt = now();
        const requestId = randomUUID();
        const outputs: VideoGenerationOutput[] = [];
        detachedBase = {
          requestId,
          model: model.definition as Readonly<VideoModelDefinition>,
          outputs,
          startedAt,
        };
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        let resumableContext:
          | {
              binding: ResumableVideoProtocolBinding<TProtocol>;
              adapter: ResumableVideoProtocolAdapter<TProtocol>;
              claims: VideoOperationClaims;
              override?: RequestCredentialOverride;
              entry: NonNullable<ReturnType<ProviderRegistry['get']>>;
              profile: VideoProtocolProfile<TProtocol>;
              resolvedOptions: import('./contracts.js').ResolvedVideoGenerationOptions<TProtocol>;
            }
          | undefined;
        const base = detachedBase;

        const finishAbort = async () => {
          if (!machine.tryWin('abort')) return;
          const snapshot = machine.snapshot();
          if (
            snapshot.operation &&
            resumableContext &&
            resumableContext.binding.operationActions.includes('cancel') &&
            resumableContext.adapter.cancel &&
            machine.requestRemoteCancel()
          ) {
            try {
              const cancellationSignal = createCancellationSignal();
              const transport = await resolveOperationTransport({
                binding: resumableContext.binding,
                action: 'cancel',
                claims: resumableContext.claims,
                provider: resumableContext.entry.snapshot,
                model,
                options: {
                  signal: cancellationSignal,
                  timeoutMs: resumableContext.resolvedOptions.timeoutMs,
                  retry: resumableContext.resolvedOptions.retry,
                  pollIntervalMs:
                    resumableContext.resolvedOptions.pollIntervalMs,
                  allowCatalogNetwork: false,
                },
                override: resumableContext.override,
                key: credentialKey,
                driver: options.transport,
                networkPolicy: options.networkPolicy,
              });
              await resumableContext.adapter.cancel({
                operation: resumableContext.claims as VideoOperationClaims & {
                  protocol: TProtocol;
                },
                provider: resumableContext.entry.snapshot,
                model: model.definition,
                compatibility: resumableContext.profile.compatibility,
                transport,
                signal: cancellationSignal,
              });
            } catch {
              // Cancellation is best-effort; the local terminal still wins.
            }
          }
          const error = timedOut
            ? timeoutError()
            : (normalizeError(undefined, true) as AiError & {
                readonly category: 'cancelled';
              });
          const result = failureResult({
            ...base,
            outputs: Object.freeze([...outputs]),
            completedAt: now(),
            status: 'cancelled',
            error,
            operation: snapshot.operation,
          });
          await generationStream.complete(result, {
            type: 'generation_error',
            sequence: sequence++,
            result,
          });
        };

        generationStream.signal.addEventListener(
          'abort',
          () => void finishAbort(),
          { once: true },
        );

        try {
          assertHandle(model, options.runtimeId, options.registry);
          const entry = options.registry.get(model.ref.providerInstanceId)!;
          const binding = findBinding(
            entry.provider.videos!.protocols,
            model.definition.protocol,
          ) as VideoProtocolBinding<TProtocol>;
          const adapter =
            (await binding.loadAdapter()) as VideoProtocolAdapter<TProtocol>;
          assertAdapter(binding, adapter);
          const profile = findProfile(binding, model.definition);
          const resolvedOptions = resolveOptions(
            binding,
            model.definition,
            callOptions,
            generationStream.signal,
            options.videoDefaults,
            adapter.contract,
          );
          timeout = setTimeout(() => {
            timedOut = true;
            generationStream.abort('video generation timeout');
          }, resolvedOptions.timeoutMs);
          await handleAssertCredentialCurrent.get(model as object)?.(
            generationStream.signal,
          );
          const effectiveOverride =
            callOptions.credentialOverride ??
            handleCredentialOverride.get(model as object);
          const operationAuth = handleOperationAuth.get(model as object);
          let overrideProof:
            | import('../generation/index.js').OperationCredentialProof
            | undefined;
          if (binding.operationMode === 'resumable') {
            if (!operationAuth)
              throw new AiRuntimeError(
                'OPERATION_AUTH_UNAVAILABLE',
                'auth',
                'operation authentication identity is unavailable',
              );
            if (operationAuth.authSource === 'override') {
              if (!effectiveOverride || !options.operationCredentialVerifier)
                throw new AiRuntimeError(
                  'OPERATION_CREDENTIAL_VERIFIER_REQUIRED',
                  'auth',
                  'an operation credential verifier is required for resumable credential overrides',
                );
              const proof = await options.operationCredentialVerifier.create(
                effectiveOverride,
                generationStream.signal,
              );
              if (proof.status === 'key_unavailable')
                throw new AiRuntimeError(
                  'OPERATION_CREDENTIAL_KEY_UNAVAILABLE',
                  'auth',
                  'operation credential proof key is unavailable',
                  proof.retryable,
                );
              overrideProof = proof.proof;
            }
          }
          const resolvedInput = await resolveVideoGenerationInput({
            model: model.definition,
            value: input,
            driver: options.transport,
            networkPolicy: options.networkPolicy,
            signal: generationStream.signal,
          });
          const requestEndpoint = binding.resolveEndpoint
            ? await binding.resolveEndpoint({
                provider: entry.snapshot,
                model: model.definition,
                input: resolvedInput,
                options: resolvedOptions,
                signal: generationStream.signal,
              })
            : undefined;
          const transport = resolveTransport({
            binding,
            model,
            ...(requestEndpoint ? { endpoint: requestEndpoint } : {}),
            override: effectiveOverride,
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

          const request = {
            provider: entry.snapshot,
            model: model.definition,
            input: resolvedInput,
            compatibility: profile.compatibility,
            options: resolvedOptions,
            transport,
            signal: generationStream.signal,
          };

          let adapterTerminal: import('./contracts.js').VideoProtocolTerminal;
          if (binding.operationMode === 'direct') {
            if (adapter.operationMode !== 'direct') throw protocolViolation();
            adapterTerminal = await adapter.run(request, {
              publish: async (event) => {
                if (event.type === 'generation_output')
                  outputs[event.outputIndex] = event.output;
                await generationStream.publish(
                  projectVideoProtocolEvent(event, sequence++),
                );
              },
            });
          } else {
            if (adapter.operationMode !== 'resumable' || !operationAuth)
              throw protocolViolation();
            let claims: VideoOperationClaims | undefined;
            const setOperation = async (operationInput: {
              readonly operationId: string;
              readonly operationState?: import('../core/content.js').JsonValue;
              readonly providerExpiresAt?: number;
            }) => {
              validateOperationId(operationInput.operationId);
              const operationState = adapter.parseOperationState(
                operationInput.operationState,
              );
              if (
                operationInput.operationState !== undefined &&
                operationState === undefined
              )
                throw protocolViolation('video operation state was rejected');
              if (
                operationState !== undefined &&
                JSON.stringify(operationState).length > 16_384
              )
                throw protocolViolation('video operation state is too large');
              const issuedAt = now();
              const providerExpiresAt = operationInput.providerExpiresAt;
              if (
                providerExpiresAt !== undefined &&
                (!Number.isInteger(providerExpiresAt) ||
                  providerExpiresAt <= issuedAt)
              )
                throw protocolViolation('video operation expiry is invalid');
              const expiresAt = Math.min(
                providerExpiresAt ?? Number.MAX_SAFE_INTEGER,
                issuedAt + policy.maxTtlMs,
              );
              const profileFingerprint = fingerprintVideoProtocolProfile({
                id: profile.id,
                compatibility: profile.compatibility,
                protocolDefaults: profile.protocolDefaults ?? null,
              });
              const common = {
                providerInstanceId: entry.snapshot.id,
                protocol: model.definition.protocol,
                modelId: model.definition.id,
                upstreamModelId: model.definition.upstreamModelId,
                protocolProfileId: model.definition.protocolProfileId,
                modelProtocolProfileFingerprint: profileFingerprint,
                providerOperationBindingFingerprint:
                  fingerprintVideoOperationBinding({
                    providerKind: entry.snapshot.kind,
                    providerInstanceId: entry.snapshot.id,
                    providerConfigFingerprint: entry.snapshot.configFingerprint,
                    protocol: binding.protocol,
                    operationCompatibilityVersion:
                      binding.operationCompatibilityVersion,
                    modelId: model.definition.id,
                    upstreamModelId: model.definition.upstreamModelId,
                    modelProtocolProfileFingerprint: profileFingerprint,
                  }),
                providerConfigFingerprint: entry.snapshot.configFingerprint,
                authBindingFingerprint: operationAuth.authBindingFingerprint,
                credentialScopeFingerprint:
                  operationAuth.credentialScopeFingerprint,
                operationId: operationInput.operationId,
                operationKind: resolvedInput.operation,
                inputDigest: fingerprintVideoGenerationInput(resolvedInput),
                outputSpecification: Object.freeze({
                  ...(resolvedInput.durationSeconds === undefined
                    ? {}
                    : { durationSeconds: resolvedInput.durationSeconds }),
                  ...(resolvedInput.resolution === undefined
                    ? {}
                    : { resolution: resolvedInput.resolution }),
                  ...(resolvedInput.aspectRatio === undefined
                    ? {}
                    : { aspectRatio: resolvedInput.aspectRatio }),
                  ...(resolvedInput.fps === undefined
                    ? {}
                    : { fps: resolvedInput.fps }),
                  generateAudio: resolvedInput.generateAudio,
                  count: resolvedInput.count,
                }),
                ...(operationState === undefined ? {} : { operationState }),
                issuedAt,
                expiresAt,
                credentialIdentityLifetime:
                  operationAuth.credentialIdentityLifetime,
              };
              claims = Object.freeze(
                operationAuth.authSource === 'override'
                  ? {
                      ...common,
                      authSource: 'override' as const,
                      overrideCredentialProof: overrideProof!,
                    }
                  : {
                      ...common,
                      authSource: operationAuth.authSource,
                      credentialInstanceId: operationAuth.credentialInstanceId!,
                    },
              ) as VideoOperationClaims;
              const operation = createVideoOperationRef({
                kind: 'memory',
                runtimeId: options.runtimeId,
                claims,
                authIdentityLifetime: operationAuth.credentialIdentityLifetime,
                scopeIdentityLifetime: operationAuth.scopeIdentityLifetime,
                ...(effectiveOverride
                  ? { requestCredential: effectiveOverride }
                  : {}),
              });
              try {
                machine.setOperation(operation);
              } catch {
                throw protocolViolation(
                  'video operation was set more than once',
                );
              }
              generationStream.setOperation(operation);
              resumableContext = {
                binding,
                adapter,
                claims,
                ...(effectiveOverride ? { override: effectiveOverride } : {}),
                entry,
                profile,
                resolvedOptions,
              };
              await generationStream.publish({
                type: 'generation_progress',
                phase: 'queued',
                sequence: sequence++,
                operation,
              });
            };
            adapterTerminal = await adapter.run(request, {
              setOperation,
              operationTransport: async (action) => {
                if (!claims)
                  throw protocolViolation(
                    'operation transport requested before setOperation',
                  );
                if (!binding.operationActions.includes(action))
                  throw protocolViolation('undeclared video operation action');
                return resolveOperationTransport({
                  binding,
                  action,
                  claims,
                  provider: entry.snapshot,
                  model,
                  options: {
                    signal: generationStream.signal,
                    timeoutMs: resolvedOptions.timeoutMs,
                    retry: resolvedOptions.retry,
                    pollIntervalMs: resolvedOptions.pollIntervalMs,
                    allowCatalogNetwork: false,
                  },
                  override: effectiveOverride,
                  key: credentialKey,
                  driver: options.transport,
                  networkPolicy: options.networkPolicy,
                });
              },
              publish: async (event) => {
                if (!claims)
                  throw protocolViolation(
                    'video protocol emitted before setOperation',
                  );
                if (event.type === 'generation_output')
                  outputs[event.outputIndex] = event.output;
                await generationStream.publish(
                  projectVideoProtocolEvent(
                    event,
                    sequence++,
                    machine.snapshot().operation,
                  ),
                );
              },
            });
            if (!claims && adapterTerminal.status !== 'failed')
              throw protocolViolation(
                'video protocol completed before setOperation',
              );
          }

          if (generationStream.signal.aborted) {
            await finishAbort();
            return;
          }
          if (!machine.tryWin('remote_terminal')) return;
          await completeTerminal({
            generationStream,
            terminal: adapterTerminal,
            base,
            outputs,
            operation: machine.snapshot().operation,
            sequence: () => sequence++,
            now,
          });
        } catch (error) {
          if (generationStream.signal.aborted) {
            await finishAbort();
            return;
          }
          if (!machine.tryWin('remote_terminal')) return;
          const normalized = normalizeError(error, false);
          const result = failureResult({
            ...base,
            outputs: Object.freeze([...outputs]),
            completedAt: now(),
            status:
              normalized.category === 'cancelled' ? 'cancelled' : 'failed',
            error: normalized,
            operation: machine.snapshot().operation,
          });
          await generationStream.complete(result, {
            type: 'generation_error',
            sequence: sequence++,
            result,
          });
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
      },
      callOptions.signal,
      async (generationStream, operation) => {
        if (!machine.tryWin('detach'))
          throw new AiRuntimeError(
            'OPERATION_NOT_AVAILABLE',
            'invalid_request',
            'video generation operation is already terminal',
          );
        if (!detachedBase)
          throw new AiRuntimeError(
            'OPERATION_NOT_AVAILABLE',
            'invalid_request',
            'video generation operation is not initialized',
          );
        const result: Extract<VideoGenerationResult, { status: 'detached' }> =
          Object.freeze({
            ...detachedBase,
            outputs: Object.freeze([...detachedBase.outputs]),
            status: 'detached',
            partial: detachedBase.outputs.length > 0,
            operation,
            completedAt: now(),
          });
        await generationStream.complete(result, {
          type: 'generation_detached',
          sequence: sequence++,
          result,
        });
      },
      options.beginOperation
        ? (generationStream) =>
            options.beginOperation!(() =>
              generationStream.abort('runtime disposal timeout'),
            )
        : undefined,
    );
  };

  const resume = async (
    operation: VideoOperationRef,
    resumeOptions: VideoOperationResumeOptions<TScopeHandle>,
  ): Promise<DirectVideoGenerationStream> => {
    const record = inspectVideoOperationRef(operation);
    let claims: VideoOperationClaims;
    if (record.kind === 'memory') {
      if (record.runtimeId !== options.runtimeId || !record.claims)
        throw new AiRuntimeError(
          'OPERATION_REF_RUNTIME_MISMATCH',
          'invalid_request',
          'video operation belongs to another runtime; serialize it first',
        );
      claims = record.claims;
    } else {
      if (!options.generationOperationCodec || !record.sealedToken)
        throw new AiRuntimeError(
          'OPERATION_NOT_PERSISTABLE',
          'invalid_request',
          'no operation codec is configured',
        );
      const opened = await options.generationOperationCodec.open(
        record.sealedToken,
        resumeOptions.signal,
      );
      if (opened.status === 'invalid')
        throw new AiRuntimeError(
          'OPERATION_TOKEN_INVALID',
          'invalid_request',
          'video operation token is invalid',
        );
      if (opened.status === 'key_unavailable')
        throw new AiRuntimeError(
          'OPERATION_CODEC_KEY_UNAVAILABLE',
          'invalid_request',
          'video operation codec key is unavailable',
          opened.retryable,
        );
      claims = parseVideoOperationEnvelope(
        validateGenerationOperationEnvelope(opened.envelope),
      );
    }
    try {
      validateGenerationOperationTimes(claims, policy, now());
    } catch {
      throw new AiRuntimeError(
        'OPERATION_TOKEN_INVALID',
        'invalid_request',
        'video operation token timestamps are invalid',
      );
    }

    const entry = options.registry.get(claims.providerInstanceId);
    const definition = entry?.provider.videos?.models.find(
      (candidate) => candidate.id === claims.modelId,
    );
    if (!entry || !definition)
      throw operationMismatch('operation provider or model is unavailable');
    if (
      entry.snapshot.configFingerprint !== claims.providerConfigFingerprint ||
      definition.protocol !== claims.protocol ||
      definition.upstreamModelId !== claims.upstreamModelId ||
      definition.protocolProfileId !== claims.protocolProfileId
    )
      throw operationMismatch('operation provider or model changed');
    const binding = findBinding(
      entry.provider.videos!.protocols,
      definition.protocol,
    );
    if (binding.operationMode !== 'resumable')
      throw operationMismatch('operation protocol is no longer resumable');
    const adapter = await binding.loadAdapter();
    assertAdapter(binding, adapter);
    const profile = findProfile(binding, definition);
    const profileFingerprint = fingerprintVideoProtocolProfile({
      id: profile.id,
      compatibility: profile.compatibility,
      protocolDefaults: profile.protocolDefaults ?? null,
    });
    if (
      profileFingerprint !== claims.modelProtocolProfileFingerprint ||
      fingerprintVideoOperationBinding({
        providerKind: entry.snapshot.kind,
        providerInstanceId: entry.snapshot.id,
        providerConfigFingerprint: entry.snapshot.configFingerprint,
        protocol: binding.protocol,
        operationCompatibilityVersion: binding.operationCompatibilityVersion,
        modelId: definition.id,
        upstreamModelId: definition.upstreamModelId,
        modelProtocolProfileFingerprint: profileFingerprint,
      }) !== claims.providerOperationBindingFingerprint
    )
      throw operationMismatch('operation protocol profile changed');

    const effectiveOverride =
      resumeOptions.credentialOverride ?? record.requestCredential;
    const model = await requireModel(
      {
        providerInstanceId: definition.providerInstanceId,
        modelId: definition.id,
        protocol: definition.protocol,
      },
      resumeOptions.scope,
      {
        ...(resumeOptions.signal ? { signal: resumeOptions.signal } : {}),
        ...(effectiveOverride ? { credentialOverride: effectiveOverride } : {}),
      },
      'resume_operation',
    );
    const auth = handleOperationAuth.get(model as object);
    if (
      !auth ||
      auth.credentialScopeFingerprint !== claims.credentialScopeFingerprint ||
      auth.authBindingFingerprint !== claims.authBindingFingerprint ||
      auth.authSource !== claims.authSource
    )
      throw operationMismatch('operation scope or authentication changed');
    if (claims.authSource === 'override') {
      if (!effectiveOverride || !options.operationCredentialVerifier)
        throw operationMismatch(
          'operation credential proof cannot be verified',
        );
      const verified = await options.operationCredentialVerifier.verify(
        effectiveOverride,
        claims.overrideCredentialProof,
        resumeOptions.signal,
      );
      if (verified.status === 'key_unavailable')
        throw new AiRuntimeError(
          'OPERATION_CREDENTIAL_KEY_UNAVAILABLE',
          'auth',
          'operation credential proof key is unavailable',
          verified.retryable,
        );
      if (verified.status !== 'match')
        throw operationMismatch('operation credential changed');
    } else if (auth.credentialInstanceId !== claims.credentialInstanceId) {
      throw operationMismatch('operation credential identity changed');
    }
    await handleAssertCredentialCurrent.get(model as object)?.(
      resumeOptions.signal,
    );

    const resolvedOptions: ResolvedVideoOperationResumeOptions = Object.freeze({
      signal: resumeOptions.signal ?? new AbortController().signal,
      timeoutMs: resumeOptions.timeoutMs ?? 1_800_000,
      retry: resumeOptions.retry ?? false,
      pollIntervalMs: resumeOptions.pollIntervalMs ?? 2_000,
      allowCatalogNetwork: resumeOptions.allowCatalogNetwork ?? false,
    });
    validateVideoTimingOptions(
      resolvedOptions.timeoutMs,
      resolvedOptions.pollIntervalMs,
    );
    const pollTransport = await resolveOperationTransport({
      binding,
      action: 'poll',
      claims,
      provider: entry.snapshot,
      model,
      options: resolvedOptions,
      override: effectiveOverride,
      key: credentialKey,
      driver: options.transport,
      networkPolicy: options.networkPolicy,
    });
    const cancelTransport = binding.operationActions.includes('cancel')
      ? await resolveOperationTransport({
          binding,
          action: 'cancel',
          claims,
          provider: entry.snapshot,
          model,
          options: resolvedOptions,
          override: effectiveOverride,
          key: credentialKey,
          driver: options.transport,
          networkPolicy: options.networkPolicy,
        })
      : undefined;

    const machine = new GenerationOperationMachine<VideoOperationRef>();
    machine.setOperation(operation);
    let sequence = 0;
    return new DirectVideoGenerationStream(
      async (generationStream) => {
        const startedAt = now();
        const requestId = randomUUID();
        const outputs: VideoGenerationOutput[] = [];
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        const base = {
          requestId,
          model: definition as Readonly<VideoModelDefinition>,
          outputs,
          startedAt,
        };
        const finishAbort = async () => {
          if (!machine.tryWin('abort')) return;
          if (
            cancelTransport &&
            adapter.cancel &&
            machine.requestRemoteCancel()
          ) {
            try {
              const cancellationSignal = createCancellationSignal();
              await adapter.cancel({
                operation: claims,
                provider: entry.snapshot,
                model: definition,
                compatibility: profile.compatibility,
                transport: cancelTransport,
                signal: cancellationSignal,
              });
            } catch {
              // Best effort only.
            }
          }
          const error = timedOut
            ? timeoutError()
            : (normalizeError(undefined, true) as AiError & {
                readonly category: 'cancelled';
              });
          const result = failureResult({
            ...base,
            outputs: Object.freeze([...outputs]),
            completedAt: now(),
            status: 'cancelled',
            error,
            operation,
          });
          await generationStream.complete(result, {
            type: 'generation_error',
            sequence: sequence++,
            result,
          });
        };
        generationStream.signal.addEventListener(
          'abort',
          () => void finishAbort(),
          { once: true },
        );
        try {
          generationStream.setOperation(operation);
          await generationStream.publish({
            type: 'generation_start',
            sequence: sequence++,
            model: definition,
            operation,
          });
          timeout = setTimeout(() => {
            timedOut = true;
            generationStream.abort('video operation resume timeout');
          }, resolvedOptions.timeoutMs);
          const terminal = await adapter.resume(
            {
              operation: claims,
              provider: entry.snapshot,
              model: definition,
              compatibility: profile.compatibility,
              options: resolvedOptions,
              pollTransport,
              ...(cancelTransport ? { cancelTransport } : {}),
              signal: generationStream.signal,
            },
            {
              publish: async (event) => {
                if (event.type === 'generation_output')
                  outputs[event.outputIndex] = event.output;
                await generationStream.publish(
                  projectVideoProtocolEvent(event, sequence++, operation),
                );
              },
            },
          );
          if (generationStream.signal.aborted) {
            await finishAbort();
            return;
          }
          if (!machine.tryWin('remote_terminal')) return;
          await completeTerminal({
            generationStream,
            terminal,
            base,
            outputs,
            operation,
            sequence: () => sequence++,
            now,
          });
        } catch (error) {
          if (generationStream.signal.aborted) {
            await finishAbort();
            return;
          }
          if (!machine.tryWin('remote_terminal')) return;
          const normalized = normalizeError(error, false);
          const result = failureResult({
            ...base,
            outputs: Object.freeze([...outputs]),
            completedAt: now(),
            status:
              normalized.category === 'cancelled' ? 'cancelled' : 'failed',
            error: normalized,
            operation,
          });
          await generationStream.complete(result, {
            type: 'generation_error',
            sequence: sequence++,
            result,
          });
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
      },
      resumeOptions.signal,
      async (generationStream) => {
        if (!machine.tryWin('detach'))
          throw new AiRuntimeError(
            'OPERATION_NOT_AVAILABLE',
            'invalid_request',
            'video generation operation is already terminal',
          );
        const result: Extract<VideoGenerationResult, { status: 'detached' }> =
          Object.freeze({
            requestId: randomUUID(),
            model: definition,
            outputs: Object.freeze([]),
            status: 'detached',
            partial: false,
            operation,
            startedAt: now(),
            completedAt: now(),
          });
        await generationStream.complete(result, {
          type: 'generation_detached',
          sequence: sequence++,
          result,
        });
      },
      options.beginOperation
        ? (generationStream) =>
            options.beginOperation!(() =>
              generationStream.abort('runtime disposal timeout'),
            )
        : undefined,
    );
  };

  return Object.freeze({
    models: Object.freeze(models),
    stream,
    generate: async <TProtocol extends string>(
      model: VideoModelHandle<TProtocol>,
      input: VideoGenerationInput,
      callOptions?: VideoGenerationOptions<TProtocol>,
    ) => stream(model, input, callOptions).result(),
    resume,
    serializeOperation: async (
      operation: VideoOperationRef,
    ): Promise<SerializedVideoOperationRef> => {
      const record = inspectVideoOperationRef(operation);
      if (
        record.kind !== 'memory' ||
        record.runtimeId !== options.runtimeId ||
        !record.claims
      )
        throw new AiRuntimeError(
          'OPERATION_REF_RUNTIME_MISMATCH',
          'invalid_request',
          'only a memory operation from this runtime can be serialized',
        );
      if (!options.generationOperationCodec)
        throw new AiRuntimeError(
          'OPERATION_NOT_PERSISTABLE',
          'invalid_request',
          'no operation codec is configured',
        );
      if (record.authIdentityLifetime !== 'cross-runtime')
        throw new AiRuntimeError(
          'OPERATION_AUTH_NOT_PERSISTABLE',
          'auth',
          'operation authentication identity is process-local',
        );
      if (record.scopeIdentityLifetime !== 'cross-runtime')
        throw new AiRuntimeError(
          'OPERATION_SCOPE_NOT_PERSISTABLE',
          'auth',
          'operation scope identity is process-local',
        );
      const sealed = await options.generationOperationCodec.seal(
        videoClaimsEnvelope(record.claims),
      );
      if (sealed.status === 'key_unavailable')
        throw new AiRuntimeError(
          'OPERATION_CODEC_KEY_UNAVAILABLE',
          'invalid_request',
          'video operation codec key is unavailable',
          sealed.retryable,
        );
      return asSerializedVideoOperationRef(sealed.token);
    },
    parseOperation: async (serialized: string) =>
      parseSerializedVideoOperationRef(serialized),
    dispose: () => credentialKey.fill(0),
  });
}

function makeHandle<TProtocol extends string>(
  definition: Readonly<VideoModelDefinition<TProtocol>>,
  snapshot: ProviderSnapshot,
  runtimeId: symbol,
  auth: Readonly<{
    credentialFingerprint?: string;
    requestCredential?: RequestCredentialOverride;
    assertCurrent?: (signal?: AbortSignal) => Promise<void>;
    operationAuth?: BoundVideoOperationAuth;
  }>,
): VideoModelHandle<TProtocol> {
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
  if (auth.operationAuth) handleOperationAuth.set(handle, auth.operationAuth);
  return handle;
}

function assertHandle(
  model: VideoModelHandle,
  runtimeId: symbol,
  registry: ProviderRegistry,
): void {
  if (handleRuntime.get(model as object) !== runtimeId)
    throw new AiRuntimeError(
      'VIDEO_MODEL_HANDLE_RUNTIME_MISMATCH',
      'invalid_request',
      'video model handle belongs to another runtime',
    );
  const entry = registry.get(model.ref.providerInstanceId);
  if (
    !entry ||
    handleProviderGeneration.get(model as object) !==
      entry.snapshot.registrationGeneration
  )
    throw new AiRuntimeError(
      'VIDEO_MODEL_HANDLE_STALE',
      'invalid_request',
      'video model handle is stale',
    );
}

function findBinding(
  bindings: readonly VideoProtocolBinding[],
  protocol: string,
): VideoProtocolBinding {
  const binding = bindings.find((candidate) => candidate.protocol === protocol);
  if (!binding)
    throw new AiRuntimeError(
      'VIDEO_PROTOCOL_BINDING_NOT_FOUND',
      'invalid_request',
      `video protocol binding not found: ${protocol}`,
    );
  return binding;
}

function findProfile<TProtocol extends string>(
  binding: VideoProtocolBinding<TProtocol>,
  model: Readonly<VideoModelDefinition<TProtocol>>,
): VideoProtocolProfile<TProtocol> {
  const profile =
    binding.profiles?.[model.protocolProfileId] ??
    (binding.defaultProfile.id === model.protocolProfileId
      ? binding.defaultProfile
      : undefined);
  if (!profile)
    throw new AiRuntimeError(
      'VIDEO_PROTOCOL_PROFILE_NOT_FOUND',
      'invalid_request',
      'video protocol profile is not registered',
    );
  return profile;
}

function assertAdapter(
  binding: VideoProtocolBinding,
  adapter: VideoProtocolAdapter,
): void {
  if (
    adapter.id !== binding.protocol ||
    adapter.operationMode !== binding.operationMode
  )
    throw protocolViolation('video protocol adapter does not match binding');
}

async function authorizeOverride<TScopeHandle>(input: {
  readonly binding: VideoProtocolBinding;
  readonly provider: ProviderSnapshot;
  readonly scope: TScopeHandle;
  readonly override?: RequestCredentialOverride;
  readonly policy?: CredentialOverridePolicy<TScopeHandle>;
  readonly scopeFingerprint: string;
}): Promise<Readonly<ResolvedVideoAuth>> {
  if (!input.binding.credential) {
    if (input.override)
      throw new AiRuntimeError(
        'CREDENTIAL_OVERRIDE_MISMATCH',
        'auth',
        'video provider does not accept a credential override',
      );
    return Object.freeze({});
  }
  if (!input.override)
    throw new AiRuntimeError(
      'CREDENTIAL_OVERRIDE_REQUIRED',
      'auth',
      'a request credential override is required for this video provider',
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
  return Object.freeze({
    requestCredential: input.override,
    authSource: 'override',
    credentialIdentityLifetime: 'cross-runtime',
    credentialScopeFingerprint: input.scopeFingerprint,
    scopeIdentityLifetime: 'process-local',
    authBindingFingerprint: input.provider.authPolicyFingerprint,
  });
}

function bindHandleAuth(
  auth: Readonly<ResolvedVideoAuth>,
  key: Uint8Array,
  provider: ProviderSnapshot,
): Readonly<{
  credentialFingerprint?: string;
  requestCredential?: RequestCredentialOverride;
  assertCurrent?: (signal?: AbortSignal) => Promise<void>;
  operationAuth?: BoundVideoOperationAuth;
}> {
  const operationAuth = auth.authSource
    ? Object.freeze({
        authSource: auth.authSource,
        ...(auth.credentialInstanceId
          ? { credentialInstanceId: auth.credentialInstanceId }
          : {}),
        credentialIdentityLifetime:
          auth.credentialIdentityLifetime ?? 'process-local',
        credentialScopeFingerprint:
          auth.credentialScopeFingerprint ?? 'process-local-scope',
        scopeIdentityLifetime: auth.scopeIdentityLifetime ?? 'process-local',
        authBindingFingerprint:
          auth.authBindingFingerprint ?? provider.authPolicyFingerprint,
      })
    : undefined;
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
    ...(operationAuth ? { operationAuth } : {}),
  });
}

function resolveTransport(input: {
  readonly binding: VideoProtocolBinding;
  readonly model: VideoModelHandle;
  readonly override?: RequestCredentialOverride;
  readonly key: Uint8Array;
  readonly driver?: TransportDriver;
  readonly networkPolicy?: NetworkPolicy;
  readonly retry: false | import('../transport/retry.js').RetryPolicy;
  readonly endpoint?: string | URL;
  readonly headers?: Readonly<Record<string, string>>;
}) {
  if (!input.driver || !input.networkPolicy)
    throw new AiRuntimeError(
      'TRANSPORT_UNAVAILABLE',
      'invalid_request',
      'transport and network policy are required for this video provider',
    );
  const expected = handleCredentialFingerprint.get(input.model as object);
  if (input.binding.credential) {
    if (!input.override || !expected)
      throw new AiRuntimeError(
        'CREDENTIAL_OVERRIDE_MISMATCH',
        'auth',
        'request credential override does not match the video model handle',
      );
    const actual = fingerprintCredential(input.override, input.key);
    if (!fingerprintsEqual(actual, expected))
      throw new AiRuntimeError(
        'CREDENTIAL_OVERRIDE_MISMATCH',
        'auth',
        'request credential override does not match the video model handle',
      );
  } else if (input.override) {
    throw new AiRuntimeError(
      'CREDENTIAL_OVERRIDE_MISMATCH',
      'auth',
      'video model handle is not bound to a credential override',
    );
  }
  const headers: Record<
    string,
    string | ReturnType<typeof createSecretHeaderValue>
  > = { ...(input.binding.headers ?? {}), ...(input.headers ?? {}) };
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
      endpoint:
        input.endpoint instanceof URL
          ? input.endpoint
          : new URL(input.endpoint ?? input.binding.endpoint),
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

async function resolveOperationTransport<TProtocol extends string>(input: {
  readonly binding: ResumableVideoProtocolBinding<TProtocol>;
  readonly action: 'poll' | 'cancel';
  readonly claims: VideoOperationClaims;
  readonly provider: ProviderSnapshot;
  readonly model: VideoModelHandle<TProtocol>;
  readonly options: ResolvedVideoOperationResumeOptions;
  readonly override?: RequestCredentialOverride;
  readonly key: Uint8Array;
  readonly driver?: TransportDriver;
  readonly networkPolicy?: NetworkPolicy;
}) {
  if (!input.binding.operationActions.includes(input.action))
    throw protocolViolation('undeclared video operation action');
  const endpoint = await input.binding.resolveOperationEndpoint({
    action: input.action,
    operation: input.claims as VideoOperationClaims & { protocol: TProtocol },
    provider: input.provider,
    model: input.model.definition,
    options: input.options,
    signal: input.options.signal,
  });
  return resolveTransport({
    binding: input.binding,
    model: input.model,
    override: input.override,
    key: input.key,
    driver: input.driver,
    networkPolicy: input.networkPolicy,
    retry: input.options.retry,
    endpoint,
    headers: input.binding.operationHeaders,
  });
}

function resolveOptions<TProtocol extends string>(
  binding: VideoProtocolBinding<TProtocol>,
  model: Readonly<VideoModelDefinition<TProtocol>>,
  input: VideoGenerationOptions<TProtocol>,
  signal: AbortSignal,
  runtimeDefaults:
    | Readonly<{
        timeoutMs?: number;
        responseFormat?: 'url' | 'base64';
        pollIntervalMs?: number;
      }>
    | undefined,
  contract: import('./contracts.js').VideoProtocolContract<TProtocol>,
): import('./contracts.js').ResolvedVideoGenerationOptions<TProtocol> {
  const profile = findProfile(binding, model);
  const protocolOptions = contract.mergeOptions([
    binding.requestDefaults?.protocolOptions as
      import('./contracts.js').VideoProtocolOptions<TProtocol> | undefined,
    profile.protocolDefaults as
      import('./contracts.js').VideoProtocolOptions<TProtocol> | undefined,
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
      'VIDEO_RESPONSE_FORMAT_UNSUPPORTED',
      'invalid_request',
      'video response format is not supported by this model',
    );
  const timeoutMs =
    input.timeoutMs ??
    runtimeDefaults?.timeoutMs ??
    model.requestDefaults?.timeoutMs ??
    binding.requestDefaults?.timeoutMs ??
    1_800_000;
  const pollIntervalMs =
    input.pollIntervalMs ??
    runtimeDefaults?.pollIntervalMs ??
    model.requestDefaults?.pollIntervalMs ??
    binding.requestDefaults?.pollIntervalMs ??
    2_000;
  validateVideoTimingOptions(timeoutMs, pollIntervalMs);
  return {
    signal,
    timeoutMs,
    retry:
      input.retry ??
      model.requestDefaults?.retry ??
      binding.requestDefaults?.retry ??
      false,
    responseFormat,
    pollIntervalMs,
    protocolOptions,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function validateVideoTimingOptions(
  timeoutMs: number,
  pollIntervalMs: number,
): void {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 21_600_000
  )
    throw new AiRuntimeError(
      'VIDEO_TIMEOUT_INVALID',
      'invalid_request',
      'video timeoutMs must be an integer between 1000 and 21600000',
    );
  if (
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs < 0 ||
    pollIntervalMs > 60_000
  )
    throw new AiRuntimeError(
      'VIDEO_POLL_INTERVAL_INVALID',
      'invalid_request',
      'video pollIntervalMs must be an integer between 0 and 60000',
    );
}

async function completeTerminal(input: {
  generationStream: DirectVideoGenerationStream;
  terminal: import('./contracts.js').VideoProtocolTerminal;
  base: Readonly<{
    requestId: string;
    model: Readonly<VideoModelDefinition>;
    outputs: VideoGenerationOutput[];
    startedAt: number;
  }>;
  outputs: readonly VideoGenerationOutput[];
  operation?: VideoOperationRef;
  sequence(): number;
  now(): number;
}): Promise<void> {
  const completedAt = input.now();
  const cost = input.terminal.usage
    ? calculateVideoCost(input.base.model, input.terminal.usage)
    : undefined;
  const diagnostics = toPublicDiagnostics(input.terminal.diagnostics);
  if (input.terminal.status === 'completed') {
    const result: Extract<VideoGenerationResult, { status: 'completed' }> =
      Object.freeze({
        ...input.base,
        outputs: Object.freeze([...input.outputs]),
        status: 'completed',
        partial: false,
        ...(input.operation ? { operation: input.operation } : {}),
        ...(input.terminal.responseId
          ? { responseId: input.terminal.responseId }
          : {}),
        ...(input.terminal.usage ? { usage: input.terminal.usage } : {}),
        ...(cost ? { cost } : {}),
        ...(diagnostics ? { diagnostics } : {}),
        completedAt,
      });
    await input.generationStream.complete(result, {
      type: 'generation_end',
      sequence: input.sequence(),
      result,
    });
    return;
  }
  const result = failureResult({
    ...input.base,
    outputs: Object.freeze([...input.outputs]),
    completedAt,
    status: input.terminal.status,
    error: normalizeError(
      input.terminal.error,
      input.terminal.status === 'cancelled',
    ),
    operation: input.operation,
    responseId: input.terminal.responseId,
    usage: input.terminal.usage,
    cost,
    diagnostics,
  });
  await input.generationStream.complete(result, {
    type: 'generation_error',
    sequence: input.sequence(),
    result,
  });
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
  readonly model: Readonly<VideoModelDefinition>;
  readonly outputs: readonly VideoGenerationOutput[];
  readonly startedAt: number;
  readonly completedAt: number;
  readonly status: 'failed' | 'cancelled';
  readonly error: AiError;
  readonly operation?: VideoOperationRef;
  readonly responseId?: string;
  readonly usage?: import('./cost.js').VideoUsage;
  readonly cost?: import('./cost.js').VideoCost;
  readonly diagnostics?: readonly import('../core/events.js').AiDiagnostic[];
}): Extract<VideoGenerationResult, { status: 'failed' | 'cancelled' }> {
  const common = {
    requestId: input.requestId,
    model: input.model,
    outputs: input.outputs,
    partial: input.outputs.length > 0,
    error: input.error,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    ...(input.operation ? { operation: input.operation } : {}),
    ...(input.responseId ? { responseId: input.responseId } : {}),
    ...(input.usage ? { usage: input.usage } : {}),
    ...(input.cost ? { cost: input.cost } : {}),
    ...(input.diagnostics
      ? { diagnostics: toPublicDiagnostics(input.diagnostics) }
      : {}),
  };
  return Object.freeze(
    input.status === 'cancelled'
      ? {
          ...common,
          status: 'cancelled',
          error: input.error as AiError & { category: 'cancelled' },
        }
      : { ...common, status: 'failed' },
  ) as Extract<VideoGenerationResult, { status: 'failed' | 'cancelled' }>;
}

function normalizeError(error: unknown, aborted: boolean): AiError {
  return toPublicAiError(
    error,
    aborted
      ? {
          code: 'VIDEO_GENERATION_CANCELLED',
          category: 'cancelled',
          message: 'video generation was cancelled',
        }
      : {
          code: 'VIDEO_GENERATION_INTERNAL_ERROR',
          category: 'internal',
          message: 'video generation failed internally',
        },
  );
}

function timeoutError(): AiError & { readonly category: 'cancelled' } {
  return new AiRuntimeError(
    'VIDEO_GENERATION_TIMEOUT',
    'cancelled',
    'video generation timed out',
  ) as AiError & { readonly category: 'cancelled' };
}

function protocolViolation(
  message = 'video protocol violated the resumable operation contract',
): AiRuntimeError {
  return new AiRuntimeError('VIDEO_PROTOCOL_VIOLATION', 'protocol', message);
}

function operationMismatch(message: string): AiRuntimeError {
  return new AiRuntimeError('OPERATION_CONTEXT_MISMATCH', 'auth', message);
}

function validateOperationId(value: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1024 ||
    /[/?#]/u.test(value) ||
    hasAsciiControlCharacter(value)
  )
    throw protocolViolation('video operation id is invalid');
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function createCancellationSignal(): AbortSignal {
  return AbortSignal.timeout(10_000);
}

function createRuntimeScopeFingerprinter<TScopeHandle>(): (
  scope: TScopeHandle,
) => string {
  const objects = new WeakMap<object, string>();
  const primitives = new Map<unknown, string>();
  let next = 0;
  return (scope) => {
    const isObject =
      (typeof scope === 'object' && scope !== null) ||
      typeof scope === 'function';
    const map = isObject ? objects : primitives;
    const key = scope as object & TScopeHandle;
    const existing = map.get(key);
    if (existing) return existing;
    const value = `runtime-video-scope-${++next}`;
    map.set(key, value);
    return value;
  };
}
