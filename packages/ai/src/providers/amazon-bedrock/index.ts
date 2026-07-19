import type { AmbientAuth, EnvironmentSource } from '../../auth/ambient.js';
import { resolveBedrockRegion } from '../../auth/ambient/aws.js';
import type { ModelDefinition, ModelPricing } from '../../core/models.js';
import { runBedrockConverseStream } from '../../protocols/bedrock-converse-stream/adapter.js';
import type { Provider } from '../../runtime/registry.js';

export type BedrockAuthMode = 'auto' | 'bearer' | 'aws';

export interface BedrockModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly contextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: boolean;
  readonly pricing?: ModelPricing;
}

export interface CreateAmazonBedrockProviderOptions {
  readonly id?: string;
  readonly authMode?: BedrockAuthMode;
  readonly region?: string;
  readonly profile?: string;
  readonly profileRegion?: string;
  readonly baseUrl?: string;
  readonly environment?: EnvironmentSource;
  readonly ambientAuth?: AmbientAuth;
  readonly models?: readonly BedrockModelInput[];
}

export function createAmazonBedrockProvider(
  options: CreateAmazonBedrockProviderOptions = {},
): Provider {
  const id = options.id ?? 'amazon-bedrock';
  const models = options.models ?? [
    { id: 'anthropic.claude-3-7-sonnet-20250219-v1:0' },
  ];
  if (models.length === 0) throw new TypeError('Bedrock models are required');
  const authMode = resolveAuthMode(options.authMode, options.ambientAuth);
  if (authMode === 'aws' && !options.ambientAuth)
    throw new TypeError('Amazon Bedrock AWS ambientAuth is required');
  const region = resolveBedrockRegion({
    modelId: models[0]!.upstreamModelId ?? models[0]!.id,
    explicitRegion: options.region,
    environment: options.environment,
    profileRegion: options.profileRegion,
  });
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? `https://bedrock-runtime.${region}.amazonaws.com`,
  );
  const identity = {
    authMode,
    region,
    profile: options.profile ?? '',
    baseUrl,
  };
  return {
    id,
    kind: 'amazon-bedrock',
    name: 'Amazon Bedrock',
    identity,
    ...(authMode === 'aws'
      ? {
          auth: {
            policyFingerprint: JSON.stringify(identity),
            ambient: options.ambientAuth!,
          },
        }
      : {}),
    chat: {
      models: models.map((model) => makeModel(id, model)),
      transport: {
        endpoint: baseUrl,
        endpointForModel: (model) =>
          `${baseUrl}/model/${encodeURIComponent(model.upstreamModelId)}/converse-stream`,
        headers: {
          accept: 'application/vnd.amazon.eventstream',
          'content-type': 'application/json',
        },
        credential: {
          headerName: 'authorization',
          defaultScheme: authMode === 'bearer' ? 'Bearer' : undefined,
        },
      },
      runChat: runBedrockConverseStream,
    },
  };
}

function resolveAuthMode(
  requested: BedrockAuthMode | undefined,
  ambientAuth: AmbientAuth | undefined,
): Exclude<BedrockAuthMode, 'auto'> {
  if (!requested || requested === 'auto') return ambientAuth ? 'aws' : 'bearer';
  return requested;
}

function makeModel(
  providerInstanceId: string,
  input: BedrockModelInput,
): ModelDefinition<'bedrock-converse-stream'> {
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: publisher(input.id),
    protocol: 'bedrock-converse-stream',
    protocolProfileId: 'bedrock-converse-stream-default',
    capabilities: Object.freeze({
      input: ['text', 'image'] as const,
      streaming: true,
      reasoning: input.reasoning ?? true,
      toolCalling: true,
      parallelToolCalls: true,
      deferredTools: false,
      thinkingLevels: ['none', 'low', 'medium', 'high'] as const,
    }),
    limits: Object.freeze({
      contextTokens: input.contextTokens ?? 200_000,
      maxOutputTokens: input.maxOutputTokens ?? 64_000,
    }),
    ...(input.pricing ? { pricing: Object.freeze(input.pricing) } : {}),
  });
}

function publisher(modelId: string): string {
  if (/anthropic|claude/i.test(modelId)) return 'Anthropic';
  if (/amazon|nova/i.test(modelId)) return 'Amazon';
  return 'Amazon Bedrock';
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/$/, '');
}
