import {
  createArkVideoTasksAdapter,
  validateArkVideoTaskId,
} from '../../protocols/ark-video-tasks/index.js';
import type {
  ResumableVideoProtocolBinding,
  VideoOperationEndpointContext,
  VideoProviderBinding,
} from '../../videos/contracts.js';
import type {
  VideoModelCapabilities,
  VideoModelDefinition,
  VideoModelLimits,
  VideoModelPricing,
  VideoModelRef,
} from '../../videos/models.js';
import { appendDoubaoPath, type DoubaoEndpoints } from './endpoints.js';

export interface DoubaoExplicitVideoModelInput {
  readonly id?: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly protocol?: 'ark-video-tasks';
  readonly protocolProfileId?: 'doubao-seedance-2-v1';
  readonly capabilities?: Partial<VideoModelCapabilities>;
  readonly limits?: Partial<VideoModelLimits>;
  readonly inputDefaults?: VideoModelDefinition['inputDefaults'];
  readonly pricing?: VideoModelPricing;
}

export function createDoubaoVideosBinding(input: {
  readonly providerInstanceId: string;
  readonly endpoints: DoubaoEndpoints;
  readonly models: readonly DoubaoExplicitVideoModelInput[];
}): VideoProviderBinding {
  const protocol: ResumableVideoProtocolBinding<'ark-video-tasks'> =
    Object.freeze({
      protocol: 'ark-video-tasks',
      operationMode: 'resumable',
      endpoint: input.endpoints.contentsGenerationTasksUrl,
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
        id: 'doubao-seedance-2-v1',
        compatibility: Object.freeze({
          wireVersion: 1 as const,
          taskApi: 'ark-contents-generations-v3' as const,
          modelFamily: 'seedance-2' as const,
        }),
      }),
      operationCompatibilityVersion: 'ark-video-tasks-operation-v1',
      operationActions: Object.freeze(['poll'] as const),
      resolveOperationEndpoint: (
        context: VideoOperationEndpointContext<'ark-video-tasks'>,
      ) =>
        appendDoubaoPath(
          input.endpoints.contentsGenerationTasksUrl,
          validateArkVideoTaskId(context.operation.operationId),
        ),
      loadAdapter: async () => createArkVideoTasksAdapter(),
    });
  const models = input.models.map((model) =>
    makeModel(input.providerInstanceId, model),
  );
  const ids = models.map(({ id }) => id);
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length)
    throw new Error('Doubao video model ids must be non-empty and unique');
  return Object.freeze({
    catalogCompatibilityVersion: 'doubao-videos-v1',
    models: Object.freeze(models),
    protocols: Object.freeze([protocol]),
  });
}

function makeModel(
  providerInstanceId: string,
  input: DoubaoExplicitVideoModelInput,
): VideoModelDefinition<'ark-video-tasks'> {
  if (input.protocol && input.protocol !== 'ark-video-tasks')
    throw new Error('Doubao video protocol must be ark-video-tasks');
  if (
    input.protocolProfileId &&
    input.protocolProfileId !== 'doubao-seedance-2-v1'
  )
    throw new Error('Doubao video profile does not match ark-video-tasks');
  const capabilities = input.capabilities ?? {};
  const limits = input.limits ?? {};
  return Object.freeze({
    id: input.id ?? 'doubao-seedance-2-0',
    upstreamModelId: input.upstreamModelId ?? 'doubao-seedance-2-0-260128',
    name: input.name ?? 'Doubao Seedance 2.0',
    providerInstanceId,
    publisher: 'ByteDance',
    family: 'Seedance',
    protocol: 'ark-video-tasks',
    protocolProfileId: 'doubao-seedance-2-v1',
    capabilities: Object.freeze({
      operations: Object.freeze(
        capabilities.operations ?? (['generate'] as const),
      ),
      inputModalities: Object.freeze(
        capabilities.inputModalities ??
          (['text', 'image', 'video', 'audio'] as const),
      ),
      imageRoles: Object.freeze(
        capabilities.imageRoles ?? (['reference'] as const),
      ),
      videoRoles: Object.freeze(
        capabilities.videoRoles ?? (['reference'] as const),
      ),
      audioInput: capabilities.audioInput ?? true,
      audioOutput: capabilities.audioOutput ?? true,
      streamingPreviews: capabilities.streamingPreviews ?? false,
      asyncOperation: true,
      seed: capabilities.seed ?? true,
      durationsSeconds: capabilities.durationsSeconds ?? {
        min: 4,
        max: 15,
        step: 1,
      },
      resolutions: Object.freeze(
        capabilities.resolutions ?? (['480p', '720p', '1080p'] as const),
      ),
      aspectRatios: Object.freeze(
        capabilities.aspectRatios ??
          (['auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const),
      ),
      frameRates: Object.freeze(capabilities.frameRates ?? ([] as const)),
      outputFormats: Object.freeze(['url'] as const),
    }),
    limits: Object.freeze({
      maxPromptCharacters: limits.maxPromptCharacters ?? 8_000,
      maxReferenceImages: limits.maxReferenceImages ?? 4,
      maxReferenceImageBytes: limits.maxReferenceImageBytes ?? 10 * 1024 * 1024,
      maxInputVideos: limits.maxInputVideos ?? 4,
      maxInputVideoBytes: limits.maxInputVideoBytes ?? 100 * 1024 * 1024,
      maxInputVideoSeconds: limits.maxInputVideoSeconds ?? 15,
      maxInputAudioBytes: limits.maxInputAudioBytes ?? 20 * 1024 * 1024,
      maxOutputs: limits.maxOutputs ?? 1,
    }),
    inputDefaults: Object.freeze(
      input.inputDefaults ?? {
        resolution: '720p',
        aspectRatio: 'auto',
        generateAudio: false,
        count: 1,
      },
    ),
    requestDefaults: Object.freeze({
      timeoutMs: 900_000,
      retry: false as const,
      responseFormat: 'url' as const,
      pollIntervalMs: 2_000,
    }),
    ...(input.pricing ? { pricing: Object.freeze(input.pricing) } : {}),
  });
}

export function doubaoVideoModelRef(
  modelId = 'doubao-seedance-2-0',
  providerInstanceId = 'doubao',
): VideoModelRef<'ark-video-tasks'> {
  return Object.freeze({
    providerInstanceId,
    modelId,
    protocol: 'ark-video-tasks',
  });
}
