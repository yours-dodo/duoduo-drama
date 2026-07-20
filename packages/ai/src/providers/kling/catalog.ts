import type {
  VideoModelCapabilities,
  VideoModelDefinition,
  VideoModelLimits,
  VideoModelPricing,
} from '../../videos/models.js';

export interface KlingVideoModelInput {
  readonly id?: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly protocol?: 'kling-video-tasks';
  readonly protocolProfileId?: 'kling-video-3-0-omni-v2';
  readonly capabilities?: Partial<VideoModelCapabilities>;
  readonly limits?: Partial<VideoModelLimits>;
  readonly inputDefaults?: VideoModelDefinition['inputDefaults'];
  readonly pricing?: VideoModelPricing;
}

export function buildKlingVideoCatalog(input: {
  readonly providerInstanceId: string;
  readonly models?: readonly KlingVideoModelInput[];
}): readonly VideoModelDefinition<'kling-video-tasks'>[] {
  const models = (input.models ?? [{}]).map((model) =>
    makeModel(input.providerInstanceId, model),
  );
  const ids = models.map(({ id }) => id);
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length)
    throw new Error('Kling video model ids must be non-empty and unique');
  return Object.freeze(models);
}

function makeModel(
  providerInstanceId: string,
  input: KlingVideoModelInput,
): VideoModelDefinition<'kling-video-tasks'> {
  if (input.protocol && input.protocol !== 'kling-video-tasks')
    throw new Error('Kling video protocol must be kling-video-tasks');
  if (
    input.protocolProfileId &&
    input.protocolProfileId !== 'kling-video-3-0-omni-v2'
  )
    throw new Error('Kling video profile does not match kling-video-tasks');
  const capabilities = input.capabilities ?? {};
  const limits = input.limits ?? {};
  return Object.freeze({
    id: input.id ?? 'kling-video-3-0-omni',
    upstreamModelId: input.upstreamModelId ?? 'kling-3.0-omni',
    name: input.name ?? 'Kling VIDEO 3.0 Omni',
    providerInstanceId,
    publisher: 'Kuaishou',
    family: 'Kling VIDEO',
    protocol: 'kling-video-tasks',
    protocolProfileId: 'kling-video-3-0-omni-v2',
    capabilities: Object.freeze({
      operations: Object.freeze(
        capabilities.operations ?? (['generate'] as const),
      ),
      inputModalities: Object.freeze(
        capabilities.inputModalities ?? (['text', 'image'] as const),
      ),
      imageRoles: Object.freeze(
        capabilities.imageRoles ??
          (['reference', 'first_frame', 'last_frame'] as const),
      ),
      videoRoles: Object.freeze(capabilities.videoRoles ?? ([] as const)),
      audioInput: capabilities.audioInput ?? false,
      audioOutput: capabilities.audioOutput ?? true,
      streamingPreviews: capabilities.streamingPreviews ?? false,
      asyncOperation: true,
      seed: capabilities.seed ?? false,
      durationsSeconds: capabilities.durationsSeconds ?? {
        min: 3,
        max: 15,
        step: 1,
      },
      resolutions: Object.freeze(
        capabilities.resolutions ?? (['720p', '1080p', '4k'] as const),
      ),
      aspectRatios: Object.freeze(
        capabilities.aspectRatios ?? (['16:9', '9:16', '1:1'] as const),
      ),
      frameRates: Object.freeze(capabilities.frameRates ?? ([] as const)),
      outputFormats: Object.freeze(['url'] as const),
    }),
    limits: Object.freeze({
      maxPromptCharacters: limits.maxPromptCharacters ?? 3_072,
      maxReferenceImages: limits.maxReferenceImages ?? 7,
      maxReferenceImageBytes: limits.maxReferenceImageBytes ?? 50 * 1024 * 1024,
      maxInputVideos: limits.maxInputVideos ?? 1,
      maxInputVideoBytes: limits.maxInputVideoBytes ?? 200 * 1024 * 1024,
      maxInputVideoSeconds: limits.maxInputVideoSeconds ?? 15,
      maxInputAudioBytes: limits.maxInputAudioBytes ?? 1,
      maxOutputs: limits.maxOutputs ?? 1,
    }),
    inputDefaults: Object.freeze(
      input.inputDefaults ?? {
        durationSeconds: 5,
        resolution: '720p',
        aspectRatio: '16:9',
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
