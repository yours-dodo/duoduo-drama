import type {
  DirectImageProtocolBinding,
  ImageModelDefinition,
  ImageModelRef,
  ImageProviderBinding,
} from '../../images/index.js';
import { createOpenRouterImagesAdapter } from '../../protocols/openrouter-images/index.js';

export const openRouterDefaultImageModelId =
  'google/gemini-2.5-flash-image' as const;

export function openRouterImageModelRef(
  modelId: string = openRouterDefaultImageModelId,
  providerInstanceId = 'openrouter',
): ImageModelRef<'openrouter-images'> {
  return Object.freeze({
    providerInstanceId,
    modelId,
    protocol: 'openrouter-images',
  });
}

export function createOpenRouterImagesBinding(input: {
  readonly providerInstanceId: string;
  readonly baseUrl?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly additionalModels?: readonly OpenRouterImageModelInput[];
}): ImageProviderBinding {
  const endpoint = appendPath(
    input.baseUrl ?? 'https://openrouter.ai/api/v1',
    'chat/completions',
  );
  const profile = Object.freeze({
    id: 'openrouter-images-v1',
    compatibility: Object.freeze({
      wireVersion: 1 as const,
      requestOperation: 'chat-completions' as const,
      outputEncoding: 'data-url' as const,
    }),
    protocolDefaults: Object.freeze({}),
  });
  const protocol: DirectImageProtocolBinding<'openrouter-images'> =
    Object.freeze({
      protocol: 'openrouter-images',
      operationMode: 'direct',
      endpoint,
      headers: Object.freeze({
        'content-type': 'application/json',
        ...(input.headers ?? {}),
      }),
      credential: Object.freeze({
        headerName: 'authorization',
        defaultScheme: 'Bearer',
      }),
      retrySafety: Object.freeze({
        mode: 'before-dispatch-only' as const,
      }),
      requestDefaults: Object.freeze({
        timeoutMs: 120_000,
        retry: false,
        responseFormat: 'base64' as const,
        pollIntervalMs: 1_000,
        protocolOptions: Object.freeze({}),
      }),
      defaultProfile: profile,
      loadAdapter: async () => createOpenRouterImagesAdapter(),
    });
  return Object.freeze({
    catalogCompatibilityVersion: 'openrouter-images-catalog-v1',
    models: Object.freeze([
      makeModel(input.providerInstanceId, {
        id: openRouterDefaultImageModelId,
        name: 'Google: Nano Banana (Gemini 2.5 Flash Image)',
        output: ['image', 'text'],
        pricing: {
          currency: 'USD',
          tokenRates: {
            inputPerMillion: 0.3,
            outputPerMillion: 2.5,
            cacheReadPerMillion: 0.03,
            cacheWritePerMillion: 0.08333333333333334,
          },
        },
      }),
      ...(input.additionalModels ?? []).map((model) =>
        makeModel(input.providerInstanceId, model),
      ),
    ]),
    protocols: Object.freeze([protocol]),
  });
}

export interface OpenRouterImageModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly output?: readonly ('text' | 'image')[];
  readonly referenceImages?: 'none' | 'single' | 'multiple';
  readonly maxPromptCharacters?: number;
  readonly maxReferenceImages?: number;
  readonly maxReferenceImageBytes?: number;
  readonly maxOutputs?: number;
  readonly pricing?: ImageModelDefinition['pricing'];
}

function makeModel(
  providerInstanceId: string,
  input: OpenRouterImageModelInput,
): ImageModelDefinition<'openrouter-images'> {
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: 'OpenRouter',
    protocol: 'openrouter-images',
    protocolProfileId: 'openrouter-images-v1',
    capabilities: Object.freeze({
      textToImage: true,
      referenceImages: input.referenceImages ?? 'multiple',
      streamingPreviews: false,
      asyncOperation: false,
      seed: false,
      outputFormats: Object.freeze(['base64'] as const),
      output: Object.freeze(input.output ?? (['image'] as const)),
      sizes: Object.freeze(['auto']),
    }),
    limits: Object.freeze({
      maxPromptCharacters: input.maxPromptCharacters ?? 32_768,
      maxReferenceImages: input.maxReferenceImages ?? 8,
      maxReferenceImageBytes: input.maxReferenceImageBytes ?? 10 * 1024 * 1024,
      maxOutputs: input.maxOutputs ?? 1,
    }),
    inputDefaults: Object.freeze({ count: 1, size: 'auto' }),
    requestDefaults: Object.freeze({
      timeoutMs: 120_000,
      retry: false,
      responseFormat: 'base64' as const,
    }),
    ...(input.pricing ? { pricing: Object.freeze(input.pricing) } : {}),
    providerMetadata: Object.freeze({
      source: 'vendor/pi/packages/ai/src/image-models.generated.ts',
    }),
  });
}

function appendPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'OpenRouter image baseUrl must be an absolute HTTPS URL without credentials, query, or fragment',
    );
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  return url.href;
}
