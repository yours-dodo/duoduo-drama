import type { JsonValue } from '../../core/content.js';
import type {
  ModelCapabilities,
  ModelDefinition,
  ModelLimits,
  ModelPricing,
  ModelRef,
} from '../../core/models.js';
import {
  createOpenAiChatCompletionsAdapter,
  type OpenAiChatCompatibility,
} from '../../protocols/openai-chat-completions/adapter.js';
import type {
  Provider,
  ProviderContractManifest,
} from '../../runtime/registry.js';

export interface CompatibleModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly publisher?: string;
  readonly family?: string;
  readonly capabilities?: Partial<ModelCapabilities>;
  readonly limits?: Partial<ModelLimits>;
  readonly pricing?: ModelPricing;
}

export interface CompatibleProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly accountId?: string;
  readonly models?: readonly CompatibleModelInput[];
  readonly compatibility?: OpenAiChatCompatibility;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface CompatibleProviderDescriptor {
  readonly kind: string;
  readonly name: string;
  readonly publisher: string;
  readonly environmentVariable: string;
  readonly defaultModelId: string;
  readonly compatibility: OpenAiChatCompatibility;
  readonly expectedThinkingBody: Readonly<Record<string, JsonValue>>;
  readonly endpoint: (options?: { readonly accountId?: string }) => string;
  readonly manifest: ProviderContractManifest;
}

interface DescriptorInput {
  readonly kind: string;
  readonly name: string;
  readonly publisher?: string;
  readonly environmentVariable: string;
  readonly baseUrl: string;
  readonly defaultModelId: string;
  readonly compatibility: OpenAiChatCompatibility;
  readonly officialSource: string;
  readonly endpoint?: (options?: { readonly accountId?: string }) => string;
}

function defineDescriptor(
  input: DescriptorInput,
): CompatibleProviderDescriptor {
  const endpoint =
    input.endpoint ?? (() => appendChatCompletions(input.baseUrl));
  const fixturePrefix = input.kind.replaceAll('-', '_');
  return Object.freeze({
    kind: input.kind,
    name: input.name,
    publisher: input.publisher ?? input.name,
    environmentVariable: input.environmentVariable,
    defaultModelId: input.defaultModelId,
    compatibility: Object.freeze({ ...input.compatibility }),
    expectedThinkingBody: Object.freeze(
      expectedThinkingBody(input.compatibility),
    ),
    endpoint,
    manifest: Object.freeze({
      schemaVersion: 1 as const,
      providerKind: input.kind,
      bindings: Object.freeze([
        Object.freeze({
          capability: 'chat' as const,
          protocol: 'openai-chat-completions',
          profileIds: Object.freeze([`${input.kind}-default`]),
          authSchemes: Object.freeze(['api_key']),
          endpointBranchIds: Object.freeze([
            'default',
            ...(input.kind === 'cloudflare-workers-ai'
              ? ['account-id']
              : ['explicit-base-url']),
          ]),
          requestFixtureIds: Object.freeze([`${fixturePrefix}_request`]),
          streamFixtureIds: Object.freeze([`${fixturePrefix}_stream`]),
          errorFixtureIds: Object.freeze([`${fixturePrefix}_error`]),
          sources: Object.freeze([
            Object.freeze({
              kind: 'official' as const,
              locator: input.officialSource,
            }),
            Object.freeze({
              kind: 'fixture' as const,
              locator: `test/fixtures/openai-chat-completions/${input.kind}`,
            }),
          ]),
        }),
      ]),
    }),
  });
}

export const compatibleProviderDescriptors = Object.freeze([
  defineDescriptor({
    kind: 'ant-ling',
    name: 'Ant Ling',
    environmentVariable: 'ANT_LING_API_KEY',
    baseUrl: 'https://api.ant-ling.com/v1',
    defaultModelId: 'ling-1t',
    compatibility: { thinkingFormat: 'ant-ling' },
    officialSource: 'https://www.ant-ling.com/docs/api',
  }),
  defineDescriptor({
    kind: 'cerebras',
    name: 'Cerebras',
    environmentVariable: 'CEREBRAS_API_KEY',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModelId: 'llama-3.3-70b',
    compatibility: { thinkingFormat: 'openai' },
    officialSource: 'https://inference-docs.cerebras.ai',
  }),
  defineDescriptor({
    kind: 'cloudflare-workers-ai',
    name: 'Cloudflare Workers AI',
    publisher: 'Cloudflare',
    environmentVariable: 'CLOUDFLARE_API_KEY',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts',
    defaultModelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    compatibility: { thinkingFormat: 'string-thinking' },
    officialSource: 'https://developers.cloudflare.com/workers-ai',
    endpoint: (options) => {
      const accountId = options?.accountId?.trim();
      if (!accountId)
        throw new Error('Cloudflare Workers AI accountId is required');
      if (!/^[A-Za-z0-9_-]+$/.test(accountId))
        throw new Error('Cloudflare Workers AI accountId is invalid');
      return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
    },
  }),
  defineDescriptor({
    kind: 'deepseek',
    name: 'DeepSeek',
    environmentVariable: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    defaultModelId: 'deepseek-chat',
    compatibility: {
      thinkingFormat: 'deepseek',
      requiresReasoningContentOnAssistantMessages: true,
    },
    officialSource: 'https://api-docs.deepseek.com',
  }),
  defineDescriptor({
    kind: 'groq',
    name: 'Groq',
    environmentVariable: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModelId: 'llama-3.3-70b-versatile',
    compatibility: { thinkingFormat: 'openai' },
    officialSource: 'https://console.groq.com/docs',
  }),
  defineDescriptor({
    kind: 'huggingface',
    name: 'Hugging Face',
    environmentVariable: 'HF_TOKEN',
    baseUrl: 'https://router.huggingface.co/v1',
    defaultModelId: 'meta-llama/Llama-3.3-70B-Instruct',
    compatibility: { thinkingFormat: 'chat-template' },
    officialSource: 'https://huggingface.co/docs/inference-providers',
  }),
  defineDescriptor({
    kind: 'moonshotai',
    name: 'Moonshot AI',
    publisher: 'Moonshot AI',
    environmentVariable: 'MOONSHOT_API_KEY',
    baseUrl: 'https://api.moonshot.ai/v1',
    defaultModelId: 'kimi-k2.5',
    compatibility: { thinkingFormat: 'openai' },
    officialSource: 'https://platform.moonshot.ai/docs',
  }),
  defineDescriptor({
    kind: 'moonshotai-cn',
    name: 'Moonshot AI China',
    publisher: 'Moonshot AI',
    environmentVariable: 'MOONSHOT_API_KEY',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModelId: 'kimi-k2.5',
    compatibility: { thinkingFormat: 'openai' },
    officialSource: 'https://platform.moonshot.cn/docs',
  }),
  defineDescriptor({
    kind: 'nvidia',
    name: 'NVIDIA NIM',
    publisher: 'NVIDIA',
    environmentVariable: 'NVIDIA_API_KEY',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModelId: 'meta/llama-3.3-70b-instruct',
    compatibility: { thinkingFormat: 'chat-template' },
    officialSource: 'https://docs.api.nvidia.com/nim',
  }),
  defineDescriptor({
    kind: 'together',
    name: 'Together AI',
    publisher: 'Together AI',
    environmentVariable: 'TOGETHER_API_KEY',
    baseUrl: 'https://api.together.ai/v1',
    defaultModelId: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    compatibility: { thinkingFormat: 'together' },
    officialSource: 'https://docs.together.ai',
  }),
  defineDescriptor({
    kind: 'xai',
    name: 'xAI',
    publisher: 'xAI',
    environmentVariable: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai/v1',
    defaultModelId: 'grok-4',
    compatibility: {
      thinkingFormat: 'openai',
      supportsDeveloperRole: true,
      supportsReasoningEffort: true,
    },
    officialSource: 'https://docs.x.ai',
  }),
  defineDescriptor({
    kind: 'xiaomi',
    name: 'Xiaomi MiMo',
    publisher: 'Xiaomi',
    environmentVariable: 'XIAOMI_API_KEY',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    defaultModelId: 'mimo-v2-flash',
    compatibility: { thinkingFormat: 'string-thinking' },
    officialSource: 'https://platform.xiaomimimo.com/docs',
  }),
  defineDescriptor({
    kind: 'xiaomi-token-plan-ams',
    name: 'Xiaomi Token Plan AMS',
    publisher: 'Xiaomi',
    environmentVariable: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
    baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
    defaultModelId: 'mimo-v2-flash',
    compatibility: { thinkingFormat: 'string-thinking' },
    officialSource: 'https://platform.xiaomimimo.com/docs',
  }),
  defineDescriptor({
    kind: 'xiaomi-token-plan-cn',
    name: 'Xiaomi Token Plan CN',
    publisher: 'Xiaomi',
    environmentVariable: 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    defaultModelId: 'mimo-v2-flash',
    compatibility: { thinkingFormat: 'string-thinking' },
    officialSource: 'https://platform.xiaomimimo.com/docs',
  }),
  defineDescriptor({
    kind: 'xiaomi-token-plan-sgp',
    name: 'Xiaomi Token Plan SGP',
    publisher: 'Xiaomi',
    environmentVariable: 'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
    defaultModelId: 'mimo-v2-flash',
    compatibility: { thinkingFormat: 'string-thinking' },
    officialSource: 'https://platform.xiaomimimo.com/docs',
  }),
  defineDescriptor({
    kind: 'zai',
    name: 'Z.AI',
    publisher: 'Zhipu AI',
    environmentVariable: 'ZAI_API_KEY',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    defaultModelId: 'glm-4.5',
    compatibility: { thinkingFormat: 'zai', zaiToolStream: true },
    officialSource: 'https://docs.z.ai',
  }),
  defineDescriptor({
    kind: 'zai-coding-cn',
    name: 'Z.AI Coding China',
    publisher: 'Zhipu AI',
    environmentVariable: 'ZAI_CODING_CN_API_KEY',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    defaultModelId: 'glm-4.5',
    compatibility: { thinkingFormat: 'zai', zaiToolStream: true },
    officialSource: 'https://open.bigmodel.cn/dev/api',
  }),
] satisfies readonly CompatibleProviderDescriptor[]);

export function createCompatibleProvider(
  descriptor: CompatibleProviderDescriptor,
  options: CompatibleProviderOptions = {},
): Provider {
  const endpoint = options.baseUrl
    ? appendChatCompletions(validateBaseUrl(options.baseUrl))
    : descriptor.endpoint({ accountId: options.accountId });
  const id = options.id ?? descriptor.kind;
  const compatibility = Object.freeze({
    ...descriptor.compatibility,
    ...options.compatibility,
  });
  const models = options.models ?? [{ id: descriptor.defaultModelId }];
  if (models.length === 0)
    throw new Error(`${descriptor.kind} models cannot be empty`);
  validateHeaders(options.headers);
  return {
    id,
    kind: descriptor.kind,
    name: descriptor.name,
    identity: Object.freeze({
      endpoint,
      environmentVariable: descriptor.environmentVariable,
      compatibility: JSON.stringify(compatibility),
    }),
    auth: {
      policyFingerprint: `${descriptor.kind}:${descriptor.environmentVariable}:${new URL(endpoint).origin}`,
    },
    contractManifest: descriptor.manifest,
    chat: {
      models: Object.freeze(
        models.map((model) => makeModel(id, descriptor, model)),
      ),
      transport: {
        endpoint,
        headers: Object.freeze({
          'content-type': 'application/json',
          ...normalizeHeaders(options.headers),
        }),
        credential: {
          headerName: 'authorization',
          defaultScheme: 'Bearer',
        },
        retrySafety: { mode: 'before-dispatch-only' },
      },
      runChat: createOpenAiChatCompletionsAdapter({ compatibility }),
    },
  };
}

export function compatibleModelRef(
  descriptor: CompatibleProviderDescriptor,
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
): ModelRef<'openai-chat-completions'> {
  return Object.freeze({
    providerInstanceId,
    modelId,
    protocol: 'openai-chat-completions',
  });
}

export function requireCompatibleDescriptor(
  kind: string,
): CompatibleProviderDescriptor {
  const descriptor = compatibleProviderDescriptors.find(
    (item) => item.kind === kind,
  );
  if (!descriptor) throw new Error(`unknown compatible provider: ${kind}`);
  return descriptor;
}

function makeModel(
  providerInstanceId: string,
  descriptor: CompatibleProviderDescriptor,
  input: CompatibleModelInput,
): ModelDefinition<'openai-chat-completions'> {
  const capabilities = input.capabilities ?? {};
  const limits = input.limits ?? {};
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: input.publisher ?? descriptor.publisher,
    ...(input.family ? { family: input.family } : {}),
    protocol: 'openai-chat-completions',
    protocolProfileId: `${descriptor.kind}-default`,
    capabilities: Object.freeze({
      input: capabilities.input ?? (['text', 'image'] as const),
      streaming: capabilities.streaming ?? true,
      reasoning: capabilities.reasoning ?? true,
      toolCalling: capabilities.toolCalling ?? true,
      parallelToolCalls: capabilities.parallelToolCalls ?? true,
      deferredTools: capabilities.deferredTools ?? false,
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

function expectedThinkingBody(
  compatibility: OpenAiChatCompatibility,
): Record<string, JsonValue> {
  switch (compatibility.thinkingFormat) {
    case 'openai':
      return { reasoning_effort: 'none' };
    case 'openrouter':
    case 'together':
      return { reasoning: { enabled: false, effort: 'medium' } };
    case 'deepseek':
    case 'zai':
    case 'ant-ling':
      return { thinking: { type: 'disabled' } };
    case 'qwen':
      return { enable_thinking: false };
    case 'chat-template':
    case 'qwen-chat-template':
      return { chat_template_kwargs: { enable_thinking: false } };
    case 'string-thinking':
      return { thinking: 'disabled' };
    default:
      return {};
  }
}

function appendChatCompletions(input: string): string {
  const url = new URL(input);
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/chat/completions')) return url.href;
  url.pathname = `${path}/chat/completions`;
  return url.href;
}

function validateBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:')
    throw new Error('provider baseUrl must use HTTPS');
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      'provider baseUrl cannot contain credentials, query, or fragment',
    );
  return url.href;
}

function validateHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): void {
  for (const name of Object.keys(headers ?? {})) {
    const normalized = name.toLowerCase();
    if (
      normalized === 'authorization' ||
      normalized === 'proxy-authorization' ||
      normalized === 'x-api-key' ||
      normalized.includes('token') ||
      normalized.includes('secret')
    )
      throw new Error(`provider header is protected: ${normalized}`);
  }
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ]),
  );
}
