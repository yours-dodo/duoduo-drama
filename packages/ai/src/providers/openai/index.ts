import type { ModelDefinition, ModelPricing } from '../../core/models.js';
import type { Provider } from '../../runtime/registry.js';
import { runOpenAiResponses } from '../../protocols/openai-responses/adapter.js';

export interface OpenAiModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly contextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: boolean;
  readonly pricing?: ModelPricing;
}

export interface CreateOpenAiProviderOptions {
  readonly id?: string;
  readonly endpoint?: string;
  readonly models?: readonly OpenAiModelInput[];
}

export function createOpenAiProvider(
  options: CreateOpenAiProviderOptions = {},
): Provider {
  const id = options.id ?? 'openai';
  const models = options.models ?? [{ id: 'gpt-4.1-mini' }];
  return {
    id,
    kind: 'openai',
    name: 'OpenAI',
    identity: {
      endpoint: options.endpoint ?? 'https://api.openai.com/v1/responses',
    },
    contractManifest: Object.freeze({
      schemaVersion: 1 as const,
      providerKind: 'openai',
      bindings: Object.freeze([
        Object.freeze({
          capability: 'chat' as const,
          protocol: 'openai-responses',
          profileIds: Object.freeze(['openai-responses-default']),
          authSchemes: Object.freeze(['api_key']),
          endpointBranchIds: Object.freeze([
            'responses-default',
            'explicit-endpoint',
          ]),
          requestFixtureIds: Object.freeze(['openai_responses_request']),
          streamFixtureIds: Object.freeze(['openai_responses_stream']),
          errorFixtureIds: Object.freeze(['openai_responses_error']),
          sources: Object.freeze([
            Object.freeze({
              kind: 'official' as const,
              locator:
                'https://platform.openai.com/docs/api-reference/responses-streaming',
            }),
            Object.freeze({
              kind: 'fixture' as const,
              locator:
                'src/protocols/openai-responses/openai-responses.test.ts',
            }),
          ]),
        }),
      ]),
    }),
    chat: {
      models: models.map((model) => makeModel(id, model)),
      transport: {
        endpoint: options.endpoint ?? 'https://api.openai.com/v1/responses',
        headers: { 'content-type': 'application/json' },
        credential: { headerName: 'authorization', defaultScheme: 'Bearer' },
        retrySafety: {
          mode: 'idempotency-key',
          headerName: 'idempotency-key',
          keyVersion: 1,
        },
      },
      runChat: runOpenAiResponses,
    },
  };
}

function makeModel(
  providerInstanceId: string,
  input: OpenAiModelInput,
): ModelDefinition<'openai-responses'> {
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: 'OpenAI',
    protocol: 'openai-responses',
    protocolProfileId: 'openai-responses-default',
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
      contextTokens: input.contextTokens ?? 128_000,
      maxOutputTokens: input.maxOutputTokens ?? 16_384,
    }),
    ...(input.pricing ? { pricing: Object.freeze(input.pricing) } : {}),
  });
}
