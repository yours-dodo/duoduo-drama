import type {
  DirectImageProtocolBinding,
  ImageProviderBinding,
} from '../../images/contracts.js';
import type { ResolvedImageGenerationInput } from '../../images/input.js';
import type {
  ImageModelCapabilities,
  ImageModelDefinition,
  ImageModelLimits,
  ImageModelPricing,
  ImageModelRef,
  ImageSize,
} from '../../images/models.js';
import { createXAiImagesAdapter } from '../../protocols/xai-images/index.js';

export interface XAiImageModelInput {
  readonly id?: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly capabilities?: Partial<ImageModelCapabilities>;
  readonly limits?: Partial<ImageModelLimits>;
  readonly inputDefaults?: Readonly<{ count: number; size: ImageSize }>;
  readonly pricing?: ImageModelPricing;
}

export function createXAiImagesBinding(input: {
  readonly providerInstanceId: string;
  readonly baseUrl: string;
  readonly models?: readonly XAiImageModelInput[];
}): ImageProviderBinding {
  const origin = mediaBase(input.baseUrl);
  const protocol: DirectImageProtocolBinding<'xai-images'> = Object.freeze({
    protocol: 'xai-images',
    operationMode: 'direct',
    endpoint: new URL('images/generations', origin).href,
    resolveEndpoint: (context: {
      input: Readonly<ResolvedImageGenerationInput>;
    }) =>
      new URL(
        context.input.content.some((part) => part.type === 'image')
          ? 'images/edits'
          : 'images/generations',
        origin,
      ),
    headers: Object.freeze({ 'content-type': 'application/json' }),
    credential: Object.freeze({
      headerName: 'authorization',
      defaultScheme: 'Bearer',
    }),
    retrySafety: Object.freeze({ mode: 'before-dispatch-only' as const }),
    requestDefaults: Object.freeze({
      timeoutMs: 180_000,
      retry: false,
      responseFormat: 'url' as const,
      pollIntervalMs: 1_000,
      protocolOptions: Object.freeze({}),
    }),
    defaultProfile: Object.freeze({
      id: 'xai-images-v1',
      compatibility: Object.freeze({
        wireVersion: 1 as const,
        routes: Object.freeze(['images/generations', 'images/edits'] as const),
      }),
    }),
    loadAdapter: async () => createXAiImagesAdapter(),
  });
  const models = (input.models ?? [{}]).map((model) =>
    makeModel(input.providerInstanceId, model),
  );
  ensureUnique(
    models.map(({ id }) => id),
    'xAI image model id',
  );
  return Object.freeze({
    catalogCompatibilityVersion: 'xai-images-v1',
    models: Object.freeze(models),
    protocols: Object.freeze([protocol]),
  });
}

function makeModel(
  providerInstanceId: string,
  input: XAiImageModelInput,
): ImageModelDefinition<'xai-images'> {
  const id = input.id ?? 'grok-imagine-image';
  const upstreamModelId = input.upstreamModelId ?? 'grok-imagine-image';
  const capabilities = input.capabilities ?? {};
  const limits = input.limits ?? {};
  return Object.freeze({
    id,
    upstreamModelId,
    name: input.name ?? 'Grok Imagine Image',
    providerInstanceId,
    publisher: 'xAI',
    family: 'Grok Imagine',
    protocol: 'xai-images',
    protocolProfileId: 'xai-images-v1',
    capabilities: Object.freeze({
      textToImage: capabilities.textToImage ?? true,
      referenceImages: capabilities.referenceImages ?? 'multiple',
      streamingPreviews: false,
      asyncOperation: false,
      seed: false,
      outputFormats: Object.freeze(
        capabilities.outputFormats ?? (['url', 'base64'] as const),
      ),
      output: Object.freeze(['image'] as const),
      sizes: Object.freeze(
        capabilities.sizes ??
          (['auto', '1024x1024', '1536x1024', '1024x1536'] as const),
      ),
    }),
    limits: Object.freeze({
      maxPromptCharacters: limits.maxPromptCharacters ?? 4_000,
      maxReferenceImages: limits.maxReferenceImages ?? 3,
      maxReferenceImageBytes: limits.maxReferenceImageBytes ?? 20 * 1024 * 1024,
      maxOutputs: limits.maxOutputs ?? 10,
    }),
    inputDefaults: Object.freeze(
      input.inputDefaults ?? { count: 1, size: 'auto' },
    ),
    requestDefaults: Object.freeze({
      timeoutMs: 180_000,
      retry: false as const,
      responseFormat: 'url' as const,
    }),
    ...(input.pricing ? { pricing: Object.freeze(input.pricing) } : {}),
  });
}

export function xAiImageModelRef(
  modelId = 'grok-imagine-image',
  providerInstanceId = 'xai',
): ImageModelRef<'xai-images'> {
  return Object.freeze({ providerInstanceId, modelId, protocol: 'xai-images' });
}

function mediaBase(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('xAI baseUrl must use https');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}
function ensureUnique(values: readonly string[], name: string): void {
  if (
    values.some((value) => !value.trim()) ||
    new Set(values).size !== values.length
  )
    throw new Error(`${name}s must be non-empty and unique`);
}
