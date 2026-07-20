import type {
  ChatRequest,
  ProtocolContentEvent,
  ProtocolTerminal,
} from '../core/events.js';
import type {
  ModelDefinition,
  ProviderInstanceId,
  ProviderSnapshot,
} from '../core/models.js';
import type { RetrySafety } from '../transport/dispatcher.js';
import type { TransportLimits } from '../transport/types.js';
import type { OAuthFlow } from '../auth/oauth.js';
import type { AmbientAuth } from '../auth/ambient.js';
import type { CredentialBindingFacts } from '../auth/api-key.js';
import type { ImageProviderBinding } from '../images/contracts.js';
import type { VideoProviderBinding } from '../videos/contracts.js';

export interface ProtocolEventSink {
  publish(event: ProtocolContentEvent): Promise<void>;
}

export interface ChatTransportBinding {
  readonly endpoint: string;
  readonly endpointForModel?: (model: Readonly<ModelDefinition>) => string;
  readonly endpointForCredential?: (
    model: Readonly<ModelDefinition>,
    facts: CredentialBindingFacts | undefined,
  ) => string;
  readonly derivedOriginPolicy?: Readonly<{
    id: string;
    version: number;
    configuration: Readonly<Record<string, string>>;
    resolve(facts: CredentialBindingFacts | undefined): readonly string[];
  }>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly credential?: Readonly<{
    readonly headerName: string;
    readonly defaultScheme?: string;
    readonly variants?: Readonly<
      Record<
        string,
        Readonly<{
          readonly headerName: string;
          readonly defaultScheme?: string;
        }>
      >
    >;
  }>;
  readonly limits?: Partial<TransportLimits>;
  readonly retrySafety?: RetrySafety;
  readonly redirect?: 'error' | 'same-origin';
}

export interface ChatProvider<TProtocol extends string = string> {
  readonly models: readonly ModelDefinition<TProtocol>[];
  readonly transport?: ChatTransportBinding;
  runChat(
    request: ChatRequest<TProtocol>,
    sink: ProtocolEventSink,
  ): Promise<ProtocolTerminal>;
}

export interface ProviderContractSource {
  readonly kind: 'pi' | 'official' | 'fixture';
  readonly locator: string;
  readonly digest?: string;
}

export interface ProviderProtocolManifest {
  readonly capability: 'chat' | 'images' | 'videos';
  readonly protocol: string;
  readonly profileIds: readonly string[];
  readonly authSchemes: readonly string[];
  readonly endpointBranchIds: readonly string[];
  readonly requestFixtureIds: readonly string[];
  readonly streamFixtureIds: readonly string[];
  readonly errorFixtureIds: readonly string[];
  readonly sources: readonly ProviderContractSource[];
}

export interface ProviderContractManifest {
  readonly schemaVersion: 1;
  readonly providerKind: string;
  readonly bindings: readonly ProviderProtocolManifest[];
}

export interface ProviderAuth {
  readonly policyFingerprint?: string;
  readonly oauth?: OAuthFlow;
  readonly ambient?: AmbientAuth;
}

export interface Provider {
  readonly id: ProviderInstanceId;
  readonly kind: string;
  readonly name: string;
  readonly identity?: Readonly<Record<string, string>>;
  readonly auth?: ProviderAuth;
  readonly contractManifest?: ProviderContractManifest;
  readonly chat?: ChatProvider;
  readonly images?: ImageProviderBinding;
  readonly videos?: VideoProviderBinding;
}

export interface ProvidersApi {
  register(provider: Provider): void;
  registerAll(providers: Iterable<Provider>): void;
  unregister(providerInstanceId: ProviderInstanceId): boolean;
  list(): readonly ProviderSnapshot[];
}

export class ProviderRegistry implements ProvidersApi {
  private generation = 0;
  private readonly providers = new Map<
    string,
    { provider: Provider; snapshot: ProviderSnapshot }
  >();

  register(provider: Provider): void {
    validateCredentialEndpointPolicy(provider.chat?.transport);
    validateImageBindings(provider);
    validateVideoBindings(provider);
    if (this.providers.has(provider.id))
      throw new Error(`provider already registered: ${provider.id}`);
    const snapshot: ProviderSnapshot = Object.freeze({
      id: provider.id,
      kind: provider.kind,
      name: provider.name,
      registrationGeneration: `generation-${++this.generation}`,
      configFingerprint: JSON.stringify(provider.identity ?? {}),
      authPolicyFingerprint: provider.auth?.policyFingerprint ?? 'none',
    });
    this.providers.set(provider.id, { provider, snapshot });
  }

  registerAll(providers: Iterable<Provider>): void {
    for (const provider of providers) this.register(provider);
  }

  unregister(providerInstanceId: string): boolean {
    return this.providers.delete(providerInstanceId);
  }

  list(): readonly ProviderSnapshot[] {
    return [...this.providers.values()].map(({ snapshot }) => snapshot);
  }

  get(
    providerId: string,
  ): { provider: Provider; snapshot: ProviderSnapshot } | undefined {
    return this.providers.get(providerId);
  }

  imageModels(): readonly import('../images/models.js').ImageModelDefinition[] {
    return [...this.providers.values()].flatMap(
      ({ provider }) => provider.images?.models ?? [],
    );
  }

  videoModels(): readonly import('../videos/models.js').VideoModelDefinition[] {
    return [...this.providers.values()].flatMap(
      ({ provider }) => provider.videos?.models ?? [],
    );
  }

  models(): readonly ModelDefinition[] {
    return [...this.providers.values()].flatMap(
      ({ provider }) => provider.chat?.models ?? [],
    );
  }
}

function validateCredentialEndpointPolicy(
  transport: ChatTransportBinding | undefined,
): void {
  const hasResolver = transport?.endpointForCredential !== undefined;
  const hasPolicy = transport?.derivedOriginPolicy !== undefined;
  if (hasResolver !== hasPolicy)
    throw new Error(
      'credential endpoint resolver and derived origin policy must be declared together',
    );
  const policy = transport?.derivedOriginPolicy;
  if (!policy) return;
  if (
    !policy.id.trim() ||
    !Number.isInteger(policy.version) ||
    policy.version < 1
  )
    throw new Error('derived origin policy descriptor is invalid');
}

function validateImageBindings(provider: Provider): void {
  const images = provider.images;
  if (!images) return;
  if (images.catalogCompatibilityVersion.trim() === '')
    throw new Error('image catalog compatibility version must not be empty');

  const protocols = new Set(
    images.protocols.map((binding) => binding.protocol),
  );
  if (protocols.size !== images.protocols.length)
    throw new Error('image protocol bindings must be unique');

  for (const binding of images.protocols) {
    if (binding.operationMode === 'resumable') {
      if (binding.operationCompatibilityVersion.trim() === '')
        throw new Error(
          'image operation compatibility version must not be empty',
        );
      const pollCount = binding.operationActions.filter(
        (action) => action === 'poll',
      ).length;
      const cancelCount = binding.operationActions.filter(
        (action) => action === 'cancel',
      ).length;
      if (
        pollCount !== 1 ||
        cancelCount > 1 ||
        pollCount + cancelCount !== binding.operationActions.length
      )
        throw new Error(
          'image operation actions must contain poll exactly once and cancel at most once',
        );
      if (typeof binding.resolveOperationEndpoint !== 'function')
        throw new Error('image operation endpoint resolver must be a function');
    }
    const profiles = [
      binding.defaultProfile,
      ...Object.values(binding.profiles ?? {}),
    ];
    const profileIds = new Set(profiles.map((profile) => profile.id));
    if (profileIds.size !== profiles.length)
      throw new Error('image protocol profile ids must be unique');
    if (profiles.some((profile) => profile.id.trim() === ''))
      throw new Error('image protocol profile ids must not be empty');
  }

  const modelRefs = new Set<string>();
  for (const model of images.models) {
    if (model.providerInstanceId !== provider.id)
      throw new Error('image model providerInstanceId must match provider id');
    const modelRef = `${model.providerInstanceId}\0${model.id}`;
    if (modelRefs.has(modelRef))
      throw new Error('image model references must be unique');
    modelRefs.add(modelRef);

    const binding = images.protocols.find(
      (candidate) => candidate.protocol === model.protocol,
    );
    if (!binding)
      throw new Error(
        `image model protocol binding not found: ${model.protocol}`,
      );
    const profiles = [
      binding.defaultProfile,
      ...Object.values(binding.profiles ?? {}),
    ];
    if (!profiles.some((profile) => profile.id === model.protocolProfileId))
      throw new Error('image model protocol profile not found');
    if (binding.operationMode === 'direct' && model.capabilities.asyncOperation)
      throw new Error('direct image models must not enable asyncOperation');
    if (
      binding.operationMode === 'resumable' &&
      !model.capabilities.asyncOperation
    )
      throw new Error('resumable image models must enable asyncOperation');

    const limits = Object.values(model.limits);
    if (limits.some((value) => !Number.isInteger(value) || value <= 0))
      throw new Error('image model limits must be positive integers');
    if (model.capabilities.outputFormats.length === 0)
      throw new Error('image model output formats must not be empty');
    if (model.capabilities.output.length === 0)
      throw new Error('image model outputs must not be empty');
    if (model.capabilities.sizes.length === 0)
      throw new Error('image model sizes must not be empty');
    if (
      !Number.isInteger(model.inputDefaults.count) ||
      model.inputDefaults.count <= 0 ||
      model.inputDefaults.count > model.limits.maxOutputs ||
      !model.capabilities.sizes.some((size) =>
        sameImageSize(size, model.inputDefaults.size),
      ) ||
      (model.requestDefaults?.responseFormat !== undefined &&
        !model.capabilities.outputFormats.includes(
          model.requestDefaults.responseFormat,
        ))
    )
      throw new Error('image model input defaults are invalid');
  }
}

function sameImageSize(
  left: import('../images/models.js').ImageSize,
  right: import('../images/models.js').ImageSize,
): boolean {
  if (typeof left === 'string' || typeof right === 'string')
    return left === right;
  return left.width === right.width && left.height === right.height;
}

function validateVideoBindings(provider: Provider): void {
  const videos = provider.videos;
  if (!videos) return;
  if (videos.catalogCompatibilityVersion.trim() === '')
    throw new Error('video catalog compatibility version must not be empty');

  const protocols = new Set(
    videos.protocols.map((binding) => binding.protocol),
  );
  if (protocols.size !== videos.protocols.length)
    throw new Error('video protocol bindings must be unique');

  for (const binding of videos.protocols) {
    if (binding.operationMode === 'resumable') {
      if (binding.operationCompatibilityVersion.trim() === '')
        throw new Error(
          'video operation compatibility version must not be empty',
        );
      const pollCount = binding.operationActions.filter(
        (action) => action === 'poll',
      ).length;
      const cancelCount = binding.operationActions.filter(
        (action) => action === 'cancel',
      ).length;
      if (
        pollCount !== 1 ||
        cancelCount > 1 ||
        pollCount + cancelCount !== binding.operationActions.length
      )
        throw new Error(
          'video operation actions must contain poll exactly once and cancel at most once',
        );
      if (typeof binding.resolveOperationEndpoint !== 'function')
        throw new Error('video operation endpoint resolver must be a function');
    }
    const profiles = [
      binding.defaultProfile,
      ...Object.values(binding.profiles ?? {}),
    ];
    const profileIds = new Set(profiles.map((profile) => profile.id));
    if (profileIds.size !== profiles.length)
      throw new Error('video protocol profile ids must be unique');
    if (profiles.some((profile) => profile.id.trim() === ''))
      throw new Error('video protocol profile ids must not be empty');
  }

  const modelRefs = new Set<string>();
  for (const model of videos.models) {
    if (model.providerInstanceId !== provider.id)
      throw new Error('video model providerInstanceId must match provider id');
    const modelRef = `${model.providerInstanceId}\0${model.id}`;
    if (modelRefs.has(modelRef))
      throw new Error('video model references must be unique');
    modelRefs.add(modelRef);

    const binding = videos.protocols.find(
      (candidate) => candidate.protocol === model.protocol,
    );
    if (!binding)
      throw new Error(
        `video model protocol binding not found: ${model.protocol}`,
      );
    const profiles = [
      binding.defaultProfile,
      ...Object.values(binding.profiles ?? {}),
    ];
    if (!profiles.some((profile) => profile.id === model.protocolProfileId))
      throw new Error('video model protocol profile not found');
    if (binding.operationMode === 'direct' && model.capabilities.asyncOperation)
      throw new Error('direct video models must not enable asyncOperation');
    if (
      binding.operationMode === 'resumable' &&
      !model.capabilities.asyncOperation
    )
      throw new Error('resumable video models must enable asyncOperation');

    const limits = Object.values(model.limits);
    if (limits.some((value) => !Number.isInteger(value) || value <= 0))
      throw new Error('video model limits must be positive integers');
    if (model.capabilities.operations.length === 0)
      throw new Error('video model operations must not be empty');
    if (model.capabilities.inputModalities.length === 0)
      throw new Error('video model input modalities must not be empty');
    if (model.capabilities.outputFormats.length === 0)
      throw new Error('video model output formats must not be empty');
    const count = model.inputDefaults.count ?? 1;
    if (
      !Number.isInteger(count) ||
      count <= 0 ||
      count > model.limits.maxOutputs ||
      (model.inputDefaults.durationSeconds !== undefined &&
        !supportsVideoDuration(
          model.capabilities.durationsSeconds,
          model.inputDefaults.durationSeconds,
        )) ||
      (model.inputDefaults.resolution !== undefined &&
        !model.capabilities.resolutions.some((resolution) =>
          sameVideoResolution(resolution, model.inputDefaults.resolution!),
        )) ||
      (model.inputDefaults.aspectRatio !== undefined &&
        !model.capabilities.aspectRatios.includes(
          model.inputDefaults.aspectRatio,
        )) ||
      (model.inputDefaults.fps !== undefined &&
        !model.capabilities.frameRates.includes(model.inputDefaults.fps)) ||
      (model.requestDefaults?.responseFormat !== undefined &&
        !model.capabilities.outputFormats.includes(
          model.requestDefaults.responseFormat,
        ))
    )
      throw new Error('video model input defaults are invalid');
  }
}

function supportsVideoDuration(
  allowed: import('../videos/models.js').VideoModelCapabilities['durationsSeconds'],
  value: number,
): boolean {
  if (Array.isArray(allowed)) return allowed.includes(value);
  const range = allowed as import('../videos/models.js').VideoNumericRange;
  return (
    Number.isFinite(value) &&
    value >= range.min &&
    value <= range.max &&
    (range.step === undefined || (value - range.min) % range.step === 0)
  );
}

function sameVideoResolution(
  left: import('../videos/models.js').VideoResolution,
  right: import('../videos/models.js').VideoResolution,
): boolean {
  if (typeof left === 'string' || typeof right === 'string')
    return left === right;
  return left.width === right.width && left.height === right.height;
}
