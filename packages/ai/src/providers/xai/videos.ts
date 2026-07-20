import type {
  ResumableVideoProtocolBinding,
  VideoOperationEndpointContext,
  VideoProviderBinding,
} from '../../videos/contracts.js';
import type { ResolvedVideoGenerationInput } from '../../videos/input.js';
import type {
  VideoModelCapabilities,
  VideoModelDefinition,
  VideoModelLimits,
  VideoModelPricing,
  VideoModelRef,
} from '../../videos/models.js';
import {
  createXAiVideosAdapter,
  validateXAiVideoRequestId,
} from '../../protocols/xai-videos/index.js';

export interface XAiVideoModelInput {
  readonly id?: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly capabilities?: Partial<VideoModelCapabilities>;
  readonly limits?: Partial<VideoModelLimits>;
  readonly inputDefaults?: VideoModelDefinition['inputDefaults'];
  readonly pricing?: VideoModelPricing;
}

export function createXAiVideosBinding(input: {
  readonly providerInstanceId: string;
  readonly baseUrl: string;
  readonly models?: readonly XAiVideoModelInput[];
}): VideoProviderBinding {
  const base = mediaBase(input.baseUrl);
  const protocol: ResumableVideoProtocolBinding<'xai-videos'> = Object.freeze({
    protocol: 'xai-videos',
    operationMode: 'resumable',
    endpoint: new URL('videos/generations', base).href,
    resolveEndpoint: ({
      input: requestInput,
    }: {
      input: Readonly<ResolvedVideoGenerationInput>;
    }) =>
      new URL(
        requestInput.operation === 'generate'
          ? 'videos/generations'
          : requestInput.operation === 'edit'
            ? 'videos/edits'
            : 'videos/extensions',
        base,
      ),
    headers: Object.freeze({ 'content-type': 'application/json' }),
    credential: Object.freeze({
      headerName: 'authorization',
      defaultScheme: 'Bearer',
    }),
    retrySafety: Object.freeze({ mode: 'before-dispatch-only' as const }),
    requestDefaults: Object.freeze({
      timeoutMs: 900_000,
      retry: false,
      responseFormat: 'url' as const,
      pollIntervalMs: 2_000,
      protocolOptions: Object.freeze({}),
    }),
    defaultProfile: Object.freeze({
      id: 'xai-videos-v1',
      compatibility: Object.freeze({
        wireVersion: 1 as const,
        api: 'xai-v1' as const,
      }),
    }),
    operationCompatibilityVersion: 'xai-videos-operation-v1',
    operationActions: Object.freeze(['poll'] as const),
    resolveOperationEndpoint: (
      context: VideoOperationEndpointContext<'xai-videos'>,
    ) =>
      new URL(
        `videos/${validateXAiVideoRequestId(context.operation.operationId)}`,
        base,
      ),
    loadAdapter: async () => createXAiVideosAdapter(),
  });
  const models = (input.models ?? [{}]).map((model) =>
    makeModel(input.providerInstanceId, model),
  );
  const ids = models.map(({ id }) => id);
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length)
    throw new Error('xAI video model ids must be non-empty and unique');
  return Object.freeze({
    catalogCompatibilityVersion: 'xai-videos-v1',
    models: Object.freeze(models),
    protocols: Object.freeze([protocol]),
  });
}

function makeModel(
  providerInstanceId: string,
  input: XAiVideoModelInput,
): VideoModelDefinition<'xai-videos'> {
  const capabilities = input.capabilities ?? {};
  const limits = input.limits ?? {};
  return Object.freeze({
    id: input.id ?? 'grok-imagine-video',
    upstreamModelId: input.upstreamModelId ?? 'grok-imagine-video',
    name: input.name ?? 'Grok Imagine Video',
    providerInstanceId,
    publisher: 'xAI',
    family: 'Grok Imagine',
    protocol: 'xai-videos',
    protocolProfileId: 'xai-videos-v1',
    capabilities: Object.freeze({
      operations: Object.freeze(
        capabilities.operations ?? (['generate', 'edit', 'extend'] as const),
      ),
      inputModalities: Object.freeze(
        capabilities.inputModalities ?? (['text', 'image', 'video'] as const),
      ),
      imageRoles: Object.freeze(
        capabilities.imageRoles ?? (['first_frame'] as const),
      ),
      videoRoles: Object.freeze(
        capabilities.videoRoles ?? (['source'] as const),
      ),
      audioInput: capabilities.audioInput ?? false,
      audioOutput: capabilities.audioOutput ?? true,
      streamingPreviews: capabilities.streamingPreviews ?? false,
      asyncOperation: true,
      seed: capabilities.seed ?? false,
      durationsSeconds: capabilities.durationsSeconds ?? {
        min: 1,
        max: 15,
        step: 1,
      },
      resolutions: Object.freeze(
        capabilities.resolutions ?? (['480p', '720p'] as const),
      ),
      aspectRatios: Object.freeze(
        capabilities.aspectRatios ??
          ([
            'auto',
            '1:1',
            '16:9',
            '9:16',
            '4:3',
            '3:4',
            '3:2',
            '2:3',
          ] as const),
      ),
      frameRates: Object.freeze(capabilities.frameRates ?? ([] as const)),
      outputFormats: Object.freeze(['url'] as const),
    }),
    limits: Object.freeze({
      maxPromptCharacters: limits.maxPromptCharacters ?? 4_000,
      maxReferenceImages: limits.maxReferenceImages ?? 1,
      maxReferenceImageBytes: limits.maxReferenceImageBytes ?? 20 * 1024 * 1024,
      maxInputVideos: limits.maxInputVideos ?? 1,
      maxInputVideoBytes: limits.maxInputVideoBytes ?? 100 * 1024 * 1024,
      maxInputVideoSeconds: limits.maxInputVideoSeconds ?? 15,
      maxInputAudioBytes: limits.maxInputAudioBytes ?? 20 * 1024 * 1024,
      maxOutputs: limits.maxOutputs ?? 1,
    }),
    inputDefaults: Object.freeze(
      input.inputDefaults ?? {
        generateAudio: true,
        count: 1,
      },
    ),
    requestDefaults: Object.freeze({
      timeoutMs: 900_000,
      retry: false as const,
      responseFormat: 'url' as const,
      pollIntervalMs: 2_000,
    }),
    pricing: Object.freeze(
      input.pricing ?? { currency: 'USD' as const, perOutputSecond: 0.05 },
    ),
  });
}

export function xAiVideoModelRef(
  modelId = 'grok-imagine-video',
  providerInstanceId = 'xai',
): VideoModelRef<'xai-videos'> {
  return Object.freeze({ providerInstanceId, modelId, protocol: 'xai-videos' });
}

function mediaBase(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('xAI baseUrl must use https');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}
