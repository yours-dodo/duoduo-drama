import { AiRuntimeError } from '../../core/errors.js';
import type { Provider } from '../../runtime/registry.js';
import type {
  ImageModelDefinition,
  ImageModelRef,
} from '../../images/index.js';
import type {
  VideoModelDefinition,
  VideoModelRef,
} from '../../videos/index.js';
import type {
  ImageOperationEndpointContext,
  ResumableImageProtocolBinding,
} from '../../images/contracts.js';
import type {
  VideoOperationEndpointContext,
  ResumableVideoProtocolBinding,
} from '../../videos/contracts.js';
import {
  createDuoduoGenerationAdapter,
  type DuoduoGenerationGateway,
  type DuoduoGenerationGatewayCatalog,
  type DuoduoGenerationGatewayModel,
} from '../../protocols/duoduo-generation-v1/index.js';

export interface SelfHostedGenerationProviderOptions {
  readonly gateway: DuoduoGenerationGateway;
  readonly id?: string;
  readonly name?: string;
  readonly gatewayBaseUrl?: string;
}

export async function selfHostedGenerationProvider(
  options: SelfHostedGenerationProviderOptions,
): Promise<Provider> {
  const id = options.id ?? 'self-hosted-generation';
  const catalog = normalizeCatalog(await options.gateway.listModels());
  const models = catalog.models.filter((model) => model.online !== false);
  const adapters = createDuoduoGenerationAdapter(options.gateway);
  const endpoint = normalizeBaseUrl(
    options.gatewayBaseUrl ?? 'https://self-hosted-generation.invalid/v1',
  );
  const imageBinding: ResumableImageProtocolBinding<'duoduo-generation-v1'> =
    Object.freeze({
      protocol: 'duoduo-generation-v1',
      operationMode: 'resumable',
      operationCompatibilityVersion: 'duoduo-generation-v1',
      operationActions: Object.freeze(['poll', 'cancel'] as const),
      endpoint: `${endpoint}/tasks`,
      credential: Object.freeze({
        headerName: 'authorization',
        defaultScheme: 'Bearer',
      }),
      retrySafety: Object.freeze({ mode: 'idempotent' as const }),
      requestDefaults: Object.freeze({
        timeoutMs: 3_600_000,
        retry: false,
        responseFormat: 'url',
        pollIntervalMs: 0,
      }),
      defaultProfile: Object.freeze({
        id: 'duoduo-generation-v1',
        compatibility: Object.freeze({
          wireVersion: 1 as const,
          taskApi: 'duoduo-generation-v1' as const,
        }),
      }),
      resolveOperationEndpoint: ({
        operation,
        action,
      }: ImageOperationEndpointContext<'duoduo-generation-v1'>) =>
        `${endpoint}/tasks/${encodeURIComponent(operation.operationId)}${action === 'cancel' ? '/cancel' : ''}`,
      loadAdapter: async () => adapters.images,
    });
  const videoBinding: ResumableVideoProtocolBinding<'duoduo-generation-v1'> =
    Object.freeze({
      protocol: 'duoduo-generation-v1',
      operationMode: 'resumable',
      operationCompatibilityVersion: 'duoduo-generation-v1',
      operationActions: Object.freeze(['poll', 'cancel'] as const),
      endpoint: `${endpoint}/tasks`,
      credential: Object.freeze({
        headerName: 'authorization',
        defaultScheme: 'Bearer',
      }),
      retrySafety: Object.freeze({ mode: 'idempotent' as const }),
      requestDefaults: Object.freeze({
        timeoutMs: 3_600_000,
        retry: false,
        responseFormat: 'url',
        pollIntervalMs: 0,
      }),
      defaultProfile: Object.freeze({
        id: 'duoduo-generation-v1',
        compatibility: Object.freeze({
          wireVersion: 1 as const,
          taskApi: 'duoduo-generation-v1' as const,
        }),
      }),
      resolveOperationEndpoint: ({
        operation,
        action,
      }: VideoOperationEndpointContext<'duoduo-generation-v1'>) =>
        `${endpoint}/tasks/${encodeURIComponent(operation.operationId)}${action === 'cancel' ? '/cancel' : ''}`,
      loadAdapter: async () => adapters.videos,
    });
  return Object.freeze({
    id,
    kind: 'self-hosted-generation',
    name: options.name ?? 'Self-hosted Generation',
    identity: Object.freeze({
      gatewayAdapterId: options.gateway.adapterId,
      catalogRevision: catalog.revision,
      gatewayBaseUrl: endpoint,
    }),
    contractManifest: Object.freeze({
      schemaVersion: 1 as const,
      providerKind: 'self-hosted-generation',
      bindings: Object.freeze([
        Object.freeze({
          capability: 'images' as const,
          protocol: 'duoduo-generation-v1',
          profileIds: Object.freeze(['duoduo-generation-v1']),
          authSchemes: Object.freeze(['api_key', 'ambient_service_identity']),
          endpointBranchIds: Object.freeze(['create', 'poll', 'cancel']),
          requestFixtureIds: Object.freeze([
            'self_hosted_image_create',
            'self_hosted_catalog',
          ]),
          streamFixtureIds: Object.freeze([
            'self_hosted_queued',
            'self_hosted_preparing',
            'self_hosted_running',
            'self_hosted_finalizing',
            'self_hosted_succeeded_image',
          ]),
          errorFixtureIds: Object.freeze([
            'self_hosted_cancelled',
            'self_hosted_invalid_extension',
          ]),
          sources: Object.freeze([
            Object.freeze({
              kind: 'official' as const,
              locator:
                'docs/superpowers/specs/2026-07-19-duoduo-ai-design.md#self-hosted-generation',
            }),
            Object.freeze({
              kind: 'fixture' as const,
              locator: 'test/fixtures/self-hosted-generation',
            }),
          ]),
        }),
        Object.freeze({
          capability: 'videos' as const,
          protocol: 'duoduo-generation-v1',
          profileIds: Object.freeze(['duoduo-generation-v1']),
          authSchemes: Object.freeze(['api_key', 'ambient_service_identity']),
          endpointBranchIds: Object.freeze(['create', 'poll', 'cancel']),
          requestFixtureIds: Object.freeze([
            'self_hosted_video_create',
            'self_hosted_catalog',
          ]),
          streamFixtureIds: Object.freeze([
            'self_hosted_queued',
            'self_hosted_preparing',
            'self_hosted_running',
            'self_hosted_finalizing',
            'self_hosted_succeeded_video',
          ]),
          errorFixtureIds: Object.freeze([
            'self_hosted_cancelled',
            'self_hosted_invalid_extension',
          ]),
          sources: Object.freeze([
            Object.freeze({
              kind: 'official' as const,
              locator:
                'docs/superpowers/specs/2026-07-19-duoduo-ai-design.md#self-hosted-generation',
            }),
            Object.freeze({
              kind: 'fixture' as const,
              locator: 'test/fixtures/self-hosted-generation',
            }),
          ]),
        }),
      ]),
    }),
    images: Object.freeze({
      catalogCompatibilityVersion: `duoduo-generation-v1:${catalog.revision}`,
      models: Object.freeze(
        models
          .filter(({ domain }) => domain === 'images')
          .map((model) => imageModel(id, model)),
      ),
      protocols: Object.freeze([imageBinding]),
    }),
    videos: Object.freeze({
      catalogCompatibilityVersion: `duoduo-generation-v1:${catalog.revision}`,
      models: Object.freeze(
        models
          .filter(({ domain }) => domain === 'videos')
          .map((model) => videoModel(id, model)),
      ),
      protocols: Object.freeze([videoBinding]),
    }),
  });
}

export function selfHostedImageModelRef(
  modelId: string,
  providerInstanceId = 'self-hosted-generation',
): ImageModelRef<'duoduo-generation-v1'> {
  return Object.freeze({
    providerInstanceId,
    modelId,
    protocol: 'duoduo-generation-v1',
  });
}
export function selfHostedVideoModelRef(
  modelId: string,
  providerInstanceId = 'self-hosted-generation',
): VideoModelRef<'duoduo-generation-v1'> {
  return Object.freeze({
    providerInstanceId,
    modelId,
    protocol: 'duoduo-generation-v1',
  });
}

function imageModel(
  providerInstanceId: string,
  model: DuoduoGenerationGatewayModel,
): ImageModelDefinition<'duoduo-generation-v1'> {
  return Object.freeze({
    id: model.id,
    upstreamModelId: model.upstreamModelId,
    name: model.name,
    providerInstanceId,
    publisher: model.publisher,
    family: model.family,
    protocol: 'duoduo-generation-v1',
    protocolProfileId: 'duoduo-generation-v1',
    capabilities: Object.freeze({
      textToImage: true,
      output: Object.freeze(['image'] as const),
      referenceImages: 'multiple' as const,
      streamingPreviews: false,
      seed: true,
      asyncOperation: true,
      sizes: Object.freeze(['1024x1024']),
      outputFormats: Object.freeze(['url', 'base64'] as const),
    }),
    limits: Object.freeze({
      maxPromptCharacters: 20_000,
      maxReferenceImages: 8,
      maxReferenceImageBytes: 20_000_000,
      maxOutputs: 4,
    }),
    inputDefaults: Object.freeze({ count: 1, size: '1024x1024' }),
    requestDefaults: Object.freeze({
      pollIntervalMs: 0,
      responseFormat: 'url' as const,
    }),
  });
}
function videoModel(
  providerInstanceId: string,
  model: DuoduoGenerationGatewayModel,
): VideoModelDefinition<'duoduo-generation-v1'> {
  return Object.freeze({
    id: model.id,
    upstreamModelId: model.upstreamModelId,
    name: model.name,
    providerInstanceId,
    publisher: model.publisher,
    family: model.family,
    protocol: 'duoduo-generation-v1',
    protocolProfileId: 'duoduo-generation-v1',
    capabilities: Object.freeze({
      operations: Object.freeze(['generate', 'edit', 'extend'] as const),
      inputModalities: Object.freeze([
        'text',
        'image',
        'video',
        'audio',
      ] as const),
      imageRoles: Object.freeze([
        'reference',
        'first_frame',
        'last_frame',
      ] as const),
      videoRoles: Object.freeze(['source', 'reference'] as const),
      audioInput: true,
      audioOutput: true,
      streamingPreviews: false,
      asyncOperation: true,
      seed: true,
      durationsSeconds: Object.freeze({ min: 1, max: 60, step: 1 }),
      resolutions: Object.freeze(['720p', '1080p']),
      aspectRatios: Object.freeze(['16:9', '9:16', '1:1']),
      frameRates: Object.freeze([24, 30]),
      outputFormats: Object.freeze(['url', 'base64'] as const),
    }),
    limits: Object.freeze({
      maxPromptCharacters: 20_000,
      maxReferenceImages: 8,
      maxReferenceImageBytes: 20_000_000,
      maxInputVideos: 2,
      maxInputVideoBytes: 200_000_000,
      maxInputVideoSeconds: 120,
      maxInputAudioBytes: 50_000_000,
      maxOutputs: 4,
    }),
    inputDefaults: Object.freeze({
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      fps: 24,
      generateAudio: false,
      count: 1,
    }),
    requestDefaults: Object.freeze({
      pollIntervalMs: 0,
      responseFormat: 'url' as const,
    }),
  });
}
function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  return url.toString().replace(/\/$/u, '');
}

function normalizeCatalog(input: unknown): DuoduoGenerationGatewayCatalog {
  if (!isRecord(input) || !Array.isArray(input.models))
    throw invalidCatalog('generation gateway catalog must contain models');
  const revision = boundedText(input.revision, 'catalog revision', 256);
  const seen = new Set<string>();
  const models = input.models.map((value, index) => {
    if (!isRecord(value))
      throw invalidCatalog(`generation gateway model ${index} is invalid`);
    if (value.domain !== 'images' && value.domain !== 'videos')
      throw invalidCatalog(
        `generation gateway model ${index} domain is invalid`,
      );
    const id = modelIdentity(
      value.id,
      `generation gateway model ${index} id`,
      256,
    );
    const upstreamModelId = modelIdentity(
      value.upstreamModelId,
      `generation gateway model ${index} upstream id`,
      512,
    );
    const duplicateKey = `${value.domain}\0${id}`;
    if (seen.has(duplicateKey))
      throw invalidCatalog(`generation gateway model ${id} is duplicated`);
    seen.add(duplicateKey);
    if (value.online !== undefined && typeof value.online !== 'boolean')
      throw invalidCatalog(
        `generation gateway model ${id} online flag is invalid`,
      );
    return Object.freeze({
      domain: value.domain,
      id,
      upstreamModelId,
      name: boundedText(value.name, `generation gateway model ${id} name`, 256),
      ...(value.online === undefined ? {} : { online: value.online }),
      ...(value.publisher === undefined
        ? {}
        : {
            publisher: boundedText(
              value.publisher,
              `generation gateway model ${id} publisher`,
              256,
            ),
          }),
      ...(value.family === undefined
        ? {}
        : {
            family: boundedText(
              value.family,
              `generation gateway model ${id} family`,
              256,
            ),
          }),
    });
  });
  return Object.freeze({ revision, models: Object.freeze(models) });
}

function modelIdentity(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  const text = boundedText(value, label, maxLength);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/+@-]*$/u.test(text))
    throw invalidCatalog(`${label} contains unsupported characters`);
  return text;
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim().length === 0 ||
    hasControlCharacters(value)
  )
    throw invalidCatalog(`${label} is invalid`);
  return value;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 31 || codePoint === 127;
  });
}

function invalidCatalog(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'DUODUO_GENERATION_CATALOG_INVALID',
    'invalid_response',
    message,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
