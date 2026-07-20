import type {
  ModelDefinition,
  ModelPricing,
  ModelRef,
} from '../../core/models.js';
import { createOpenAiCodexResponsesAdapter } from '../../protocols/openai-codex-responses/index.js';
import {
  createOpenAiCodexOAuthFlow,
  type OpenAiCodexOAuthFlowOptions,
} from '../../auth/oauth/openai-codex/index.js';
import type { Provider } from '../../runtime/registry.js';

export interface OpenAiCodexModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly contextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly pricing?: ModelPricing;
}

export interface OpenAiCodexProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly models?: readonly OpenAiCodexModelInput[];
  readonly oauth?: OpenAiCodexOAuthFlowOptions | false;
}

export function openAiCodexProvider(
  options: OpenAiCodexProviderOptions = {},
): Provider {
  const id = options.id ?? 'openai-codex';
  const baseUrl = validateBaseUrl(
    options.baseUrl ?? 'https://chatgpt.com/backend-api',
  );
  const endpoint = new URL('codex/responses', `${baseUrl}/`).href;
  const models = options.models ?? [{ id: 'gpt-5-codex' }];
  if (models.length === 0)
    throw new TypeError('OpenAI Codex models cannot be empty');
  return {
    id,
    kind: 'openai-codex',
    name: 'OpenAI Codex',
    identity: Object.freeze({ endpoint, baseUrl }),
    ...(options.oauth === false
      ? {}
      : {
          auth: {
            policyFingerprint: `openai-codex:${new URL(baseUrl).origin}:oauth-v1`,
            oauth: createOpenAiCodexOAuthFlow(options.oauth),
          },
        }),
    contractManifest: {
      schemaVersion: 1,
      providerKind: 'openai-codex',
      bindings: [
        {
          capability: 'chat',
          protocol: 'openai-codex-responses',
          profileIds: ['openai-codex-default'],
          authSchemes: ['oauth'],
          endpointBranchIds: ['chatgpt-backend'],
          requestFixtureIds: ['codex-request'],
          streamFixtureIds: ['codex-sse'],
          errorFixtureIds: ['codex-error'],
          sources: [{ kind: 'pi', locator: 'providers/openai-codex.ts' }],
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
          'openai-beta': 'responses=experimental',
        }),
        credential: { headerName: 'authorization', defaultScheme: 'Bearer' },
        retrySafety: { mode: 'before-dispatch-only' },
      },
      runChat: createOpenAiCodexResponsesAdapter(),
    },
  };
}

export const createOpenAiCodexProvider = openAiCodexProvider;

export function openAiCodexModelRef(
  modelId = 'gpt-5-codex',
  providerInstanceId = 'openai-codex',
): ModelRef<'openai-codex-responses'> {
  return Object.freeze({
    providerInstanceId,
    modelId,
    protocol: 'openai-codex-responses',
  });
}

function makeModel(
  providerInstanceId: string,
  input: OpenAiCodexModelInput,
): ModelDefinition<'openai-codex-responses'> {
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: 'OpenAI',
    protocol: 'openai-codex-responses',
    protocolProfileId: 'openai-codex-default',
    capabilities: Object.freeze({
      input: ['text', 'image'] as const,
      streaming: true,
      reasoning: true,
      toolCalling: true,
      parallelToolCalls: true,
      deferredTools: false,
      thinkingLevels: ['none', 'low', 'medium', 'high'] as const,
    }),
    limits: Object.freeze({
      contextTokens: input.contextTokens ?? 200_000,
      maxOutputTokens: input.maxOutputTokens ?? 100_000,
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
    throw new TypeError('OpenAI Codex baseUrl must be a plain HTTPS URL');
  return url.href.replace(/\/+$/u, '');
}
