import type {
  ModelDefinition,
  ModelPricing,
  ModelRef,
} from '../../core/models.js';
import { createMistralConversationsAdapter } from '../../protocols/mistral-conversations/index.js';
import type { Provider } from '../../runtime/registry.js';

export interface MistralModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly contextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: boolean;
  readonly pricing?: ModelPricing;
}

export interface MistralProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly models?: readonly MistralModelInput[];
}

export function mistralProvider(
  options: MistralProviderOptions = {},
): Provider {
  const id = options.id ?? 'mistral';
  const baseUrl = validateBaseUrl(options.baseUrl ?? 'https://api.mistral.ai');
  const endpoint = new URL('v1/chat/completions', `${baseUrl}/`).href;
  const models = options.models ?? [{ id: 'mistral-large-latest' }];
  if (models.length === 0)
    throw new TypeError('Mistral models cannot be empty');
  return {
    id,
    kind: 'mistral',
    name: 'Mistral',
    identity: Object.freeze({
      endpoint,
      environmentVariable: 'MISTRAL_API_KEY',
    }),
    auth: {
      policyFingerprint: `mistral:${new URL(endpoint).origin}:api-key-v1`,
    },
    contractManifest: {
      schemaVersion: 1,
      providerKind: 'mistral',
      bindings: [
        {
          capability: 'chat',
          protocol: 'mistral-conversations',
          profileIds: ['mistral-default'],
          authSchemes: ['api-key'],
          endpointBranchIds: ['mistral-api'],
          requestFixtureIds: ['mistral-request'],
          streamFixtureIds: ['mistral-stream'],
          errorFixtureIds: ['mistral-error'],
          sources: [{ kind: 'pi', locator: 'providers/mistral.ts' }],
        },
      ],
    },
    chat: {
      models: Object.freeze(models.map((model) => makeModel(id, model))),
      transport: {
        endpoint,
        headers: Object.freeze({
          'content-type': 'application/json',
          accept: 'text/event-stream',
        }),
        credential: { headerName: 'authorization', defaultScheme: 'Bearer' },
        retrySafety: { mode: 'before-dispatch-only' },
      },
      runChat: createMistralConversationsAdapter(),
    },
  };
}

export const createMistralProvider = mistralProvider;

export function mistralModelRef(
  modelId = 'mistral-large-latest',
  providerInstanceId = 'mistral',
): ModelRef<'mistral-conversations'> {
  return Object.freeze({
    providerInstanceId,
    modelId,
    protocol: 'mistral-conversations',
  });
}

function makeModel(
  providerInstanceId: string,
  input: MistralModelInput,
): ModelDefinition<'mistral-conversations'> {
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: 'Mistral AI',
    protocol: 'mistral-conversations',
    protocolProfileId: 'mistral-default',
    capabilities: Object.freeze({
      input: ['text', 'image'] as const,
      streaming: true,
      reasoning: input.reasoning ?? true,
      toolCalling: true,
      parallelToolCalls: true,
      deferredTools: false,
      thinkingLevels: ['none', 'high'] as const,
    }),
    limits: Object.freeze({
      contextTokens: input.contextTokens ?? 128_000,
      maxOutputTokens: input.maxOutputTokens ?? 32_768,
    }),
    ...(input.pricing ? { pricing: Object.freeze(input.pricing) } : {}),
  });
}

function validateBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new TypeError('Mistral baseUrl must be a plain HTTPS URL');
  return url.href.replace(/\/+$/u, '');
}
