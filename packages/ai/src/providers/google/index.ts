import type { ModelDefinition, ModelPricing } from '../../core/models.js';
import { runGoogleGenerativeAi } from '../../protocols/google-generative-ai/adapter.js';
import type { Provider } from '../../runtime/registry.js';

export interface GoogleModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly contextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: boolean;
  readonly pricing?: ModelPricing;
}

export interface CreateGoogleProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly models?: readonly GoogleModelInput[];
}

export function createGoogleProvider(
  options: CreateGoogleProviderOptions = {},
): Provider {
  const id = options.id ?? 'google';
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta',
  );
  const models = options.models ?? [{ id: 'gemini-2.5-pro' }];
  return {
    id,
    kind: 'google',
    name: 'Google Gemini Developer API',
    identity: { baseUrl, authMode: 'api-key', apiVersion: 'v1beta' },
    contractManifest: Object.freeze({
      schemaVersion: 1 as const,
      providerKind: 'google',
      bindings: Object.freeze([
        Object.freeze({
          capability: 'chat' as const,
          protocol: 'google-generative-ai',
          profileIds: Object.freeze(['google-generative-ai-default']),
          authSchemes: Object.freeze(['api_key']),
          endpointBranchIds: Object.freeze([
            'generative-language-v1beta',
            'explicit-base-url',
          ]),
          requestFixtureIds: Object.freeze(['google_thinking_tool_request']),
          streamFixtureIds: Object.freeze(['google_thinking_tool_stream']),
          errorFixtureIds: Object.freeze(['google_api_error']),
          sources: Object.freeze([
            Object.freeze({
              kind: 'official' as const,
              locator:
                'https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent',
            }),
            Object.freeze({
              kind: 'fixture' as const,
              locator: 'test/fixtures/google-generative-ai',
            }),
          ]),
        }),
      ]),
    }),
    chat: {
      models: models.map((model) => makeModel(id, model)),
      transport: {
        endpoint: baseUrl,
        endpointForModel: (model) =>
          `${baseUrl}/models/${encodeURIComponent(model.upstreamModelId)}:streamGenerateContent?alt=sse`,
        headers: { 'content-type': 'application/json' },
        credential: { headerName: 'x-goog-api-key', defaultScheme: '' },
      },
      runChat: runGoogleGenerativeAi,
    },
  };
}

function makeModel(
  providerInstanceId: string,
  input: GoogleModelInput,
): ModelDefinition<'google-generative-ai'> {
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: 'Google',
    family: 'Gemini',
    protocol: 'google-generative-ai',
    protocolProfileId: 'google-generative-ai-default',
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
      contextTokens: input.contextTokens ?? 1_048_576,
      maxOutputTokens: input.maxOutputTokens ?? 65_536,
    }),
    ...(input.pricing ? { pricing: Object.freeze(input.pricing) } : {}),
  });
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/$/, '');
}
