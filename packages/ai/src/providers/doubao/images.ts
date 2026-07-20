import type {
  DirectImageProtocolBinding,
  ImageProviderBinding,
} from '../../images/contracts.js';
import type {
  ImageModelCapabilities,
  ImageModelDefinition,
  ImageModelLimits,
  ImageModelPricing,
  ImageModelRef,
  ImageSize,
} from '../../images/models.js';
import { createArkImagesAdapter } from '../../protocols/ark-images/index.js';
import type { DoubaoEndpoints } from './endpoints.js';
import type { DoubaoUpstream } from './catalog.js';

export interface DoubaoExplicitImageModelInput {
  readonly id: string;
  readonly name: string;
  readonly protocol?: 'ark-images';
  readonly protocolProfileId?: 'doubao-ark-images-v1';
  readonly capabilities?: Partial<ImageModelCapabilities>;
  readonly limits?: Partial<ImageModelLimits>;
  readonly inputDefaults?: Readonly<{ count: number; size: ImageSize }>;
  readonly pricing?: ImageModelPricing;
  readonly upstream: DoubaoUpstream;
}

export function createDoubaoImagesBinding(input: {
  readonly providerInstanceId: string;
  readonly endpoints: DoubaoEndpoints;
  readonly models: readonly DoubaoExplicitImageModelInput[];
}): ImageProviderBinding {
  const protocol: DirectImageProtocolBinding<'ark-images'> = Object.freeze({
    protocol: 'ark-images',
    operationMode: 'direct',
    endpoint: input.endpoints.imagesUrl,
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
      id: 'doubao-ark-images-v1',
      compatibility: Object.freeze({
        wireVersion: 1 as const,
        route: 'images/generations' as const,
      }),
    }),
    loadAdapter: async () => createArkImagesAdapter(),
  });
  const models = input.models.map((model) =>
    makeModel(input.providerInstanceId, model),
  );
  const ids = new Set(models.map(({ id }) => id));
  if (ids.size !== models.length)
    throw new Error('duplicate Doubao image model id');
  return Object.freeze({
    catalogCompatibilityVersion: 'doubao-images-v1',
    models: Object.freeze(models),
    protocols: Object.freeze([protocol]),
  });
}

function makeModel(
  providerInstanceId: string,
  input: DoubaoExplicitImageModelInput,
): ImageModelDefinition<'ark-images'> {
  if (input.protocol && input.protocol !== 'ark-images')
    throw new Error('Doubao image protocol must be ark-images');
  if (
    input.protocolProfileId &&
    input.protocolProfileId !== 'doubao-ark-images-v1'
  )
    throw new Error('Doubao image protocol profile does not match ark-images');
  const upstreamModelId =
    input.upstream.type === 'model'
      ? input.upstream.modelId
      : input.upstream.endpointId;
  if (!input.id.trim() || !upstreamModelId.trim())
    throw new Error('Doubao image model ids must not be empty');
  const capabilities = input.capabilities ?? {};
  const limits = input.limits ?? {};
  return Object.freeze({
    id: input.id,
    upstreamModelId,
    name: input.name,
    providerInstanceId,
    publisher: 'Volcengine',
    family: 'Seedream',
    protocol: 'ark-images',
    protocolProfileId: 'doubao-ark-images-v1',
    capabilities: Object.freeze({
      textToImage: capabilities.textToImage ?? true,
      referenceImages: capabilities.referenceImages ?? 'multiple',
      streamingPreviews: false,
      asyncOperation: false,
      seed: capabilities.seed ?? true,
      outputFormats: Object.freeze(
        capabilities.outputFormats ?? (['url', 'base64'] as const),
      ),
      output: Object.freeze(['image'] as const),
      sizes: Object.freeze(
        capabilities.sizes ?? (['auto', '1024x1024', '2048x2048'] as const),
      ),
    }),
    limits: Object.freeze({
      maxPromptCharacters: limits.maxPromptCharacters ?? 8_000,
      maxReferenceImages: limits.maxReferenceImages ?? 4,
      maxReferenceImageBytes: limits.maxReferenceImageBytes ?? 10 * 1024 * 1024,
      maxOutputs: limits.maxOutputs ?? 4,
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
    providerMetadata: Object.freeze({ upstreamType: input.upstream.type }),
  });
}

export function doubaoImageModelRef(
  modelId: string,
  providerInstanceId = 'doubao',
): ImageModelRef<'ark-images'> {
  return Object.freeze({
    providerInstanceId,
    modelId,
    protocol: 'ark-images',
  });
}
