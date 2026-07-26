import { createHash } from 'node:crypto';

import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type {
  ModelCapabilities,
  ModelDefinition,
  ModelLimits,
  ModelPricing,
  ModelRef,
} from '../../core/models.js';
import {
  createAnthropicMessagesAdapter,
  type AnthropicMessagesCompatibility,
} from '../../protocols/anthropic-messages/adapter.js';
import { runGoogleGenerativeAi } from '../../protocols/google-generative-ai/adapter.js';
import {
  createOpenAiChatCompletionsAdapter,
  type OpenAiChatCompatibility,
  type OpenRouterRoutingProfile,
  type VercelGatewayRoutingProfile,
} from '../../protocols/openai-chat-completions/adapter.js';
import { runOpenAiResponses } from '../../protocols/openai-responses/adapter.js';
import type {
  ProtocolEventSink,
  Provider,
  ProviderContractManifest,
} from '../../runtime/registry.js';

export type GatewayProtocol =
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'openai-chat-completions'
  | 'openai-responses';

export interface GatewayBindingDescriptor {
  readonly protocol: GatewayProtocol;
  readonly endpoint: (options: GatewayEndpointOptions) => string;
  readonly profileId: string;
  readonly openAiChatCompatibility?: OpenAiChatCompatibility;
  readonly anthropicCompatibility?: AnthropicMessagesCompatibility;
}

export interface GatewayProviderDescriptor {
  readonly kind: string;
  readonly name: string;
  readonly publisher: string;
  readonly environmentVariable: string;
  readonly defaultModelId: string;
  readonly bindings: readonly GatewayBindingDescriptor[];
  readonly officialSource: string;
}

export interface GatewayEndpointOptions {
  readonly baseUrl?: string;
  readonly accountId?: string;
  readonly gatewayId?: string;
}

export interface GatewayModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly publisher?: string;
  readonly family?: string;
  readonly protocol: GatewayProtocol;
  readonly protocolProfileId?: string;
  readonly capabilities?: Partial<ModelCapabilities>;
  readonly limits?: Partial<ModelLimits>;
  readonly pricing?: ModelPricing;
}

export interface GatewayProviderOptions extends GatewayEndpointOptions {
  readonly id?: string;
  readonly models?: readonly GatewayModelInput[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly openRouterRouting?: Readonly<OpenRouterRoutingProfile>;
  readonly vercelGatewayRouting?: Readonly<VercelGatewayRoutingProfile>;
}

function binding(
  protocol: GatewayProtocol,
  endpoint: (options: GatewayEndpointOptions) => string,
  options: Omit<
    GatewayBindingDescriptor,
    'protocol' | 'endpoint' | 'profileId'
  > & {
    readonly profileId?: string;
  } = {},
): GatewayBindingDescriptor {
  return Object.freeze({
    protocol,
    endpoint,
    profileId: options.profileId ?? `${protocol}-default`,
    ...(options.openAiChatCompatibility
      ? { openAiChatCompatibility: options.openAiChatCompatibility }
      : {}),
    ...(options.anthropicCompatibility
      ? { anthropicCompatibility: options.anthropicCompatibility }
      : {}),
  });
}

function fixed(baseUrl: string, path: string) {
  return (options: GatewayEndpointOptions) =>
    appendPath(options.baseUrl ?? baseUrl, path);
}

function cloudflare(path: string) {
  return (options: GatewayEndpointOptions) => {
    const accountId = requireIdentifier(options.accountId, 'accountId');
    const gatewayId = requireIdentifier(options.gatewayId, 'gatewayId');
    return appendPath(
      options.baseUrl ??
        `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}`,
      path,
    );
  };
}

export const gatewayProviderDescriptors = Object.freeze([
  Object.freeze({
    kind: 'cloudflare-ai-gateway',
    name: 'Cloudflare AI Gateway',
    publisher: 'Cloudflare',
    environmentVariable: 'CLOUDFLARE_API_KEY',
    defaultModelId: 'gateway-default',
    officialSource: 'https://developers.cloudflare.com/ai-gateway',
    bindings: Object.freeze([
      binding('anthropic-messages', cloudflare('anthropic/v1/messages')),
      binding('openai-chat-completions', cloudflare('compat/chat/completions')),
      binding('openai-responses', cloudflare('openai/responses')),
    ]),
  }),
  Object.freeze({
    kind: 'fireworks',
    name: 'Fireworks AI',
    publisher: 'Fireworks AI',
    environmentVariable: 'FIREWORKS_API_KEY',
    defaultModelId: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    officialSource: 'https://docs.fireworks.ai',
    bindings: Object.freeze([
      binding(
        'anthropic-messages',
        fixed('https://api.fireworks.ai/inference', 'v1/messages'),
      ),
      binding(
        'openai-chat-completions',
        fixed('https://api.fireworks.ai/inference', 'v1/chat/completions'),
      ),
    ]),
  }),
  Object.freeze({
    kind: 'kimi-coding',
    name: 'Kimi Coding',
    publisher: 'Moonshot AI',
    environmentVariable: 'KIMI_API_KEY',
    defaultModelId: 'kimi-for-coding',
    officialSource: 'https://www.kimi.com/code/docs',
    bindings: Object.freeze([
      binding(
        'anthropic-messages',
        fixed('https://api.kimi.com/coding', 'v1/messages'),
      ),
    ]),
  }),
  Object.freeze({
    kind: 'minimax',
    name: 'MiniMax',
    publisher: 'MiniMax',
    environmentVariable: 'MINIMAX_API_KEY',
    defaultModelId: 'MiniMax-M2.1',
    officialSource: 'https://platform.minimax.io/docs',
    bindings: Object.freeze([
      binding(
        'anthropic-messages',
        fixed('https://api.minimax.io/anthropic', 'v1/messages'),
      ),
    ]),
  }),
  Object.freeze({
    kind: 'minimax-cn',
    name: 'MiniMax China',
    publisher: 'MiniMax',
    environmentVariable: 'MINIMAX_CN_API_KEY',
    defaultModelId: 'MiniMax-M2.1',
    officialSource: 'https://platform.minimaxi.com/docs',
    bindings: Object.freeze([
      binding(
        'anthropic-messages',
        fixed('https://api.minimaxi.com/anthropic', 'v1/messages'),
      ),
    ]),
  }),
  Object.freeze({
    kind: 'opencode',
    name: 'OpenCode Zen',
    publisher: 'OpenCode',
    environmentVariable: 'OPENCODE_API_KEY',
    defaultModelId: 'opencode/default',
    officialSource: 'https://opencode.ai/docs/zen',
    bindings: Object.freeze([
      binding(
        'anthropic-messages',
        fixed('https://opencode.ai/zen', 'v1/messages'),
      ),
      binding(
        'google-generative-ai',
        fixed('https://opencode.ai/zen/v1', 'models'),
      ),
      binding(
        'openai-chat-completions',
        fixed('https://opencode.ai/zen/v1', 'chat/completions'),
      ),
      binding(
        'openai-responses',
        fixed('https://opencode.ai/zen/v1', 'responses'),
      ),
    ]),
  }),
  Object.freeze({
    kind: 'opencode-go',
    name: 'OpenCode Zen Go',
    publisher: 'OpenCode',
    environmentVariable: 'OPENCODE_API_KEY',
    defaultModelId: 'opencode/go-default',
    officialSource: 'https://opencode.ai/docs/zen',
    bindings: Object.freeze([
      binding(
        'anthropic-messages',
        fixed('https://opencode.ai/zen/go', 'v1/messages'),
      ),
      binding(
        'openai-chat-completions',
        fixed('https://opencode.ai/zen/go/v1', 'chat/completions'),
      ),
    ]),
  }),
  Object.freeze({
    kind: 'openrouter',
    name: 'OpenRouter',
    publisher: 'OpenRouter',
    environmentVariable: 'OPENROUTER_API_KEY',
    defaultModelId: 'openai/gpt-4.1-mini',
    officialSource: 'https://openrouter.ai/docs',
    bindings: Object.freeze([
      binding(
        'openai-chat-completions',
        fixed('https://openrouter.ai/api/v1', 'chat/completions'),
        {
          openAiChatCompatibility: {
            thinkingFormat: 'openrouter',
            supportsUsageInStreaming: true,
          },
        },
      ),
    ]),
  }),
  Object.freeze({
    kind: 'vercel-ai-gateway',
    name: 'Vercel AI Gateway',
    publisher: 'Vercel',
    environmentVariable: 'AI_GATEWAY_API_KEY',
    defaultModelId: 'anthropic/claude-sonnet-4',
    officialSource: 'https://vercel.com/docs/ai-gateway',
    bindings: Object.freeze([
      binding(
        'anthropic-messages',
        fixed('https://ai-gateway.vercel.sh', 'v1/messages'),
      ),
    ]),
  }),
] satisfies readonly GatewayProviderDescriptor[]);

export function createGatewayProvider(
  descriptor: GatewayProviderDescriptor,
  options: GatewayProviderOptions = {},
): Provider {
  if (descriptor.bindings.length === 0)
    throw new Error(`${descriptor.kind} must declare at least one binding`);
  validateHeaders(options.headers);
  const id = options.id ?? descriptor.kind;
  const resolvedBindings = descriptor.bindings.map((item) => ({
    descriptor: item,
    endpoint: item.endpoint(options),
  }));
  const origin = new URL(resolvedBindings[0]!.endpoint).origin;
  if (
    resolvedBindings.some(({ endpoint }) => new URL(endpoint).origin !== origin)
  )
    throw new Error(
      `${descriptor.kind} protocol endpoints must share an origin`,
    );

  const routing =
    descriptor.kind === 'openrouter'
      ? options.openRouterRouting
      : descriptor.kind === 'vercel-ai-gateway'
        ? options.vercelGatewayRouting
        : undefined;
  const models =
    options.models ??
    descriptor.bindings.map((item) => ({
      id: descriptor.defaultModelId,
      protocol: item.protocol,
      protocolProfileId: item.profileId,
    }));
  const byProtocol = new Map(
    resolvedBindings.map((item) => [item.descriptor.protocol, item]),
  );
  for (const model of models) {
    if (!byProtocol.has(model.protocol))
      throw new Error(
        `${descriptor.kind} does not support protocol ${model.protocol}`,
      );
  }

  const manifest = makeManifest(descriptor);
  const chatAdapters = new Map<
    GatewayProtocol,
    ReturnType<typeof makeRunner>
  >();
  for (const item of descriptor.bindings)
    chatAdapters.set(item.protocol, makeRunner(item, routing));

  return {
    id,
    kind: descriptor.kind,
    name: descriptor.name,
    identity: Object.freeze({
      endpoints: JSON.stringify(
        Object.fromEntries(
          resolvedBindings.map(({ descriptor: item, endpoint }) => [
            item.protocol,
            endpoint,
          ]),
        ),
      ),
      environmentVariable: descriptor.environmentVariable,
      ...(routing ? { routing: JSON.stringify(routing) } : {}),
    }),
    auth: Object.freeze({
      policyFingerprint:
        createHash('sha256')
          .update(
            JSON.stringify([
              descriptor.kind,
              descriptor.environmentVariable,
              resolvedBindings.map(({ endpoint }) => endpoint),
            ]),
          )
          .digest('base64url') + `:${descriptor.environmentVariable}`,
    }),
    contractManifest: manifest,
    chat: {
      models: Object.freeze(
        models.map((model) => makeModel(id, descriptor, model)),
      ),
      transport: {
        endpoint: resolvedBindings[0]!.endpoint,
        endpointForModel: (model) => {
          const resolved = byProtocol.get(model.protocol as GatewayProtocol);
          if (!resolved)
            throw new Error(`unsupported protocol: ${model.protocol}`);
          return resolved.endpoint;
        },
        headers: Object.freeze({
          'content-type': 'application/json',
          ...(options.headers ?? {}),
        }),
        credential:
          descriptor.kind === 'cloudflare-ai-gateway'
            ? {
                headerName: 'cf-aig-authorization',
                defaultScheme: 'Bearer',
              }
            : { headerName: 'authorization', defaultScheme: 'Bearer' },
      },
      runChat: async (request, sink) => {
        const runner = chatAdapters.get(
          request.model.protocol as GatewayProtocol,
        );
        if (!runner)
          throw new Error(`unsupported protocol: ${request.model.protocol}`);
        return runner(request, sink);
      },
    },
  };
}

function makeRunner(
  descriptor: GatewayBindingDescriptor,
  routing:
    | Readonly<OpenRouterRoutingProfile>
    | Readonly<VercelGatewayRoutingProfile>
    | undefined,
): (
  request: ChatRequest,
  sink: ProtocolEventSink,
) => Promise<ProtocolTerminal> {
  switch (descriptor.protocol) {
    case 'anthropic-messages':
      return createAnthropicMessagesAdapter({
        compatibility: descriptor.anthropicCompatibility,
      }) as unknown as (
        request: ChatRequest,
        sink: ProtocolEventSink,
      ) => Promise<ProtocolTerminal>;
    case 'google-generative-ai':
      return runGoogleGenerativeAi as unknown as (
        request: ChatRequest,
        sink: ProtocolEventSink,
      ) => Promise<ProtocolTerminal>;
    case 'openai-responses':
      return runOpenAiResponses as unknown as (
        request: ChatRequest,
        sink: ProtocolEventSink,
      ) => Promise<ProtocolTerminal>;
    case 'openai-chat-completions':
      return createOpenAiChatCompletionsAdapter({
        compatibility: {
          ...descriptor.openAiChatCompatibility,
          ...(routing && 'allow_fallbacks' in routing
            ? { openRouterRouting: routing }
            : {}),
          ...(routing && !('allow_fallbacks' in routing)
            ? { vercelGatewayRouting: routing }
            : {}),
        },
      }) as unknown as (
        request: ChatRequest,
        sink: ProtocolEventSink,
      ) => Promise<ProtocolTerminal>;
  }
}

function makeModel(
  providerInstanceId: string,
  descriptor: GatewayProviderDescriptor,
  input: GatewayModelInput,
): ModelDefinition<GatewayProtocol> {
  const capabilities = input.capabilities ?? {};
  const limits = input.limits ?? {};
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: input.publisher ?? descriptor.publisher,
    ...(input.family ? { family: input.family } : {}),
    protocol: input.protocol,
    protocolProfileId:
      input.protocolProfileId ?? `${descriptor.kind}-${input.protocol}`,
    capabilities: Object.freeze({
      input: capabilities.input ?? (['text', 'image'] as const),
      streaming: capabilities.streaming ?? true,
      reasoning: capabilities.reasoning ?? true,
      toolCalling: capabilities.toolCalling ?? true,
      parallelToolCalls: capabilities.parallelToolCalls ?? true,
      deferredTools:
        capabilities.deferredTools ?? descriptor.kind === 'kimi-coding',
      thinkingLevels:
        capabilities.thinkingLevels ??
        (['none', 'low', 'medium', 'high'] as const),
    }),
    limits: Object.freeze({
      contextTokens: limits.contextTokens ?? 128_000,
      maxOutputTokens: limits.maxOutputTokens ?? 16_384,
      ...(limits.maxInputImages === undefined
        ? {}
        : { maxInputImages: limits.maxInputImages }),
      ...(limits.maxInputImageBytes === undefined
        ? {}
        : { maxInputImageBytes: limits.maxInputImageBytes }),
    }),
    ...(input.pricing ? { pricing: Object.freeze(input.pricing) } : {}),
  });
}

function makeManifest(
  descriptor: GatewayProviderDescriptor,
): ProviderContractManifest {
  return Object.freeze({
    schemaVersion: 1,
    providerKind: descriptor.kind,
    bindings: Object.freeze(
      descriptor.bindings.map((item) =>
        Object.freeze({
          capability: 'chat' as const,
          protocol: item.protocol,
          profileIds: Object.freeze([item.profileId]),
          authSchemes: Object.freeze(['api_key']),
          endpointBranchIds: Object.freeze([
            'default',
            ...(descriptor.kind === 'cloudflare-ai-gateway'
              ? ['account-gateway']
              : ['explicit-base-url']),
          ]),
          requestFixtureIds: Object.freeze([
            `${descriptor.kind}_${item.protocol}_request`,
          ]),
          streamFixtureIds: Object.freeze([
            `${descriptor.kind}_${item.protocol}_stream`,
          ]),
          errorFixtureIds: Object.freeze([
            `${descriptor.kind}_${item.protocol}_error`,
          ]),
          sources: Object.freeze([
            Object.freeze({
              kind: 'official' as const,
              locator: descriptor.officialSource,
            }),
            Object.freeze({
              kind: 'fixture' as const,
              locator: `test/fixtures/gateways/${descriptor.kind}/${item.protocol}`,
            }),
          ]),
        }),
      ),
    ),
  });
}

export function gatewayModelRef<TProtocol extends GatewayProtocol>(
  providerKind: string,
  modelId: string,
  protocol: TProtocol,
  providerInstanceId = providerKind,
): ModelRef<TProtocol> {
  return Object.freeze({ providerInstanceId, modelId, protocol });
}

export function requireGatewayDescriptor(
  kind: string,
): GatewayProviderDescriptor {
  const descriptor = gatewayProviderDescriptors.find(
    (candidate) => candidate.kind === kind,
  );
  if (!descriptor) throw new Error(`unknown gateway provider: ${kind}`);
  return descriptor;
}

function appendPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:')
    throw new Error('provider baseUrl must use HTTPS');
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      'provider baseUrl cannot contain credentials, query, or fragment',
    );
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  return url.href;
}

function requireIdentifier(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (!/^[A-Za-z0-9_-]+$/.test(normalized))
    throw new Error(`${name} is invalid`);
  return normalized;
}

function validateHeaders(
  headers: Readonly<Record<string, string>> | undefined,
) {
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.toLowerCase();
    if (
      normalized === 'authorization' ||
      normalized === 'x-api-key' ||
      normalized === 'cf-aig-authorization' ||
      normalized === 'host' ||
      normalized === 'content-length'
    )
      throw new Error(`provider header is protected: ${normalized}`);
    if (/token|secret|password|api[-_]?key/i.test(value))
      throw new Error(`provider header value is secret-shaped: ${normalized}`);
  }
}
