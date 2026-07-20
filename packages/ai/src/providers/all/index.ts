import { createAmazonBedrockProvider } from '../amazon-bedrock/index.js';
import { antLingProvider } from '../ant-ling/index.js';
import { createAnthropicProvider } from '../anthropic/index.js';
import { createAzureOpenAiResponsesProvider } from '../azure-openai-responses/index.js';
import { cerebrasProvider } from '../cerebras/index.js';
import { cloudflareAiGatewayProvider } from '../cloudflare-ai-gateway/index.js';
import { cloudflareWorkersAiProvider } from '../cloudflare-workers-ai/index.js';
import { deepseekProvider } from '../deepseek/index.js';
import { doubaoProvider } from '../doubao/index.js';
import { fireworksProvider } from '../fireworks/index.js';
import { githubCopilotProvider } from '../github-copilot/index.js';
import { createGoogleProvider } from '../google/index.js';
import { createGoogleVertexProvider } from '../google-vertex/index.js';
import { groqProvider } from '../groq/index.js';
import { huggingfaceProvider } from '../huggingface/index.js';
import { kimiCodingProvider } from '../kimi-coding/index.js';
import { klingProvider } from '../kling/index.js';
import { minimaxProvider } from '../minimax/index.js';
import { minimaxCnProvider } from '../minimax-cn/index.js';
import { mistralProvider } from '../mistral/index.js';
import { moonshotAiProvider } from '../moonshotai/index.js';
import { moonshotAiCnProvider } from '../moonshotai-cn/index.js';
import { nvidiaProvider } from '../nvidia/index.js';
import { createOpenAiProvider } from '../openai/index.js';
import { openAiCodexProvider } from '../openai-codex/index.js';
import { openCodeProvider } from '../opencode/index.js';
import { openCodeGoProvider } from '../opencode-go/index.js';
import { openRouterProvider } from '../openrouter/index.js';
import { qwenProvider } from '../qwen/index.js';
import { radiusProvider } from '../radius/index.js';
import { selfHostedGenerationProvider } from '../self-hosted-generation/index.js';
import { togetherProvider } from '../together/index.js';
import { vercelAiGatewayProvider } from '../vercel-ai-gateway/index.js';
import { xAiProvider } from '../xai/index.js';
import { xiaomiProvider } from '../xiaomi/index.js';
import { xiaomiTokenPlanAmsProvider } from '../xiaomi-token-plan-ams/index.js';
import { xiaomiTokenPlanCnProvider } from '../xiaomi-token-plan-cn/index.js';
import { xiaomiTokenPlanSgpProvider } from '../xiaomi-token-plan-sgp/index.js';
import { zaiProvider } from '../zai/index.js';
import { zaiCodingCnProvider } from '../zai-coding-cn/index.js';
import type { Provider } from '../../runtime/registry.js';

type FirstOption<T> = T extends (options?: infer TOptions) => unknown
  ? TOptions
  : T extends (options: infer TOptions) => unknown
    ? TOptions
    : never;

export interface ProviderFactoryOptionsMap {
  'amazon-bedrock': FirstOption<typeof createAmazonBedrockProvider>;
  'ant-ling': FirstOption<typeof antLingProvider>;
  anthropic: FirstOption<typeof createAnthropicProvider>;
  'azure-openai-responses': FirstOption<
    typeof createAzureOpenAiResponsesProvider
  >;
  cerebras: FirstOption<typeof cerebrasProvider>;
  'cloudflare-ai-gateway': FirstOption<typeof cloudflareAiGatewayProvider>;
  'cloudflare-workers-ai': FirstOption<typeof cloudflareWorkersAiProvider>;
  deepseek: FirstOption<typeof deepseekProvider>;
  doubao: FirstOption<typeof doubaoProvider>;
  fireworks: FirstOption<typeof fireworksProvider>;
  'github-copilot': FirstOption<typeof githubCopilotProvider>;
  google: FirstOption<typeof createGoogleProvider>;
  'google-vertex': FirstOption<typeof createGoogleVertexProvider>;
  groq: FirstOption<typeof groqProvider>;
  huggingface: FirstOption<typeof huggingfaceProvider>;
  'kimi-coding': FirstOption<typeof kimiCodingProvider>;
  kling: FirstOption<typeof klingProvider>;
  minimax: FirstOption<typeof minimaxProvider>;
  'minimax-cn': FirstOption<typeof minimaxCnProvider>;
  mistral: FirstOption<typeof mistralProvider>;
  moonshotai: FirstOption<typeof moonshotAiProvider>;
  'moonshotai-cn': FirstOption<typeof moonshotAiCnProvider>;
  nvidia: FirstOption<typeof nvidiaProvider>;
  openai: FirstOption<typeof createOpenAiProvider>;
  'openai-codex': FirstOption<typeof openAiCodexProvider>;
  opencode: FirstOption<typeof openCodeProvider>;
  'opencode-go': FirstOption<typeof openCodeGoProvider>;
  openrouter: FirstOption<typeof openRouterProvider>;
  qwen: FirstOption<typeof qwenProvider>;
  radius: FirstOption<typeof radiusProvider>;
  'self-hosted-generation': FirstOption<typeof selfHostedGenerationProvider>;
  together: FirstOption<typeof togetherProvider>;
  'vercel-ai-gateway': FirstOption<typeof vercelAiGatewayProvider>;
  xai: FirstOption<typeof xAiProvider>;
  xiaomi: FirstOption<typeof xiaomiProvider>;
  'xiaomi-token-plan-ams': FirstOption<typeof xiaomiTokenPlanAmsProvider>;
  'xiaomi-token-plan-cn': FirstOption<typeof xiaomiTokenPlanCnProvider>;
  'xiaomi-token-plan-sgp': FirstOption<typeof xiaomiTokenPlanSgpProvider>;
  zai: FirstOption<typeof zaiProvider>;
  'zai-coding-cn': FirstOption<typeof zaiCodingCnProvider>;
}

export type BuiltinProviderKind = keyof ProviderFactoryOptionsMap;
export type BuiltinProvidersOptions = Readonly<{
  [K in BuiltinProviderKind]?: ProviderFactoryOptionsMap[K];
}>;

export interface BuiltinProvidersResult {
  readonly providers: readonly Provider[];
  readonly unconfigured: readonly Readonly<{
    kind: BuiltinProviderKind;
    missingOptions: readonly string[];
  }>[];
}

export const builtinProviderKinds = Object.freeze([
  'amazon-bedrock',
  'ant-ling',
  'anthropic',
  'azure-openai-responses',
  'cerebras',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
  'deepseek',
  'doubao',
  'fireworks',
  'github-copilot',
  'google',
  'google-vertex',
  'groq',
  'huggingface',
  'kimi-coding',
  'kling',
  'minimax',
  'minimax-cn',
  'mistral',
  'moonshotai',
  'moonshotai-cn',
  'nvidia',
  'openai',
  'openai-codex',
  'opencode',
  'opencode-go',
  'openrouter',
  'qwen',
  'radius',
  'self-hosted-generation',
  'together',
  'vercel-ai-gateway',
  'xai',
  'xiaomi',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp',
  'zai',
  'zai-coding-cn',
] as const satisfies readonly BuiltinProviderKind[]);

const requiredOptions: Readonly<
  Partial<Record<BuiltinProviderKind, readonly string[]>>
> = Object.freeze({
  'azure-openai-responses': Object.freeze([
    'baseUrl|resourceName',
    'deploymentName|deploymentMap',
  ]),
  'cloudflare-ai-gateway': Object.freeze(['accountId', 'gatewayId']),
  'cloudflare-workers-ai': Object.freeze(['accountId']),
  qwen: Object.freeze(['region']),
  'self-hosted-generation': Object.freeze(['gateway', 'gatewayBaseUrl']),
});

export function getBuiltinInventory(kind: BuiltinProviderKind): Readonly<{
  kind: BuiltinProviderKind;
  requiredNonSecretOptions: readonly string[];
}> {
  return Object.freeze({
    kind,
    requiredNonSecretOptions: requiredOptions[kind] ?? Object.freeze([]),
  });
}

export async function builtinProviders(
  options: BuiltinProvidersOptions = {},
): Promise<BuiltinProvidersResult> {
  const providers: Provider[] = [];
  const unconfigured: Array<{
    kind: BuiltinProviderKind;
    missingOptions: readonly string[];
  }> = [];
  for (const kind of builtinProviderKinds) {
    const supplied = options[kind];
    const missingOptions = missingRequiredOptions(
      supplied,
      requiredOptions[kind] ?? [],
    );
    if (missingOptions.length > 0) {
      unconfigured.push(Object.freeze({ kind, missingOptions }));
      continue;
    }
    providers.push(await createBuiltinProvider(kind, supplied));
  }
  return Object.freeze({
    providers: Object.freeze(providers),
    unconfigured: Object.freeze(unconfigured),
  });
}

function missingRequiredOptions(
  supplied: unknown,
  requirements: readonly string[],
): readonly string[] {
  if (requirements.length === 0) return Object.freeze([]);
  if (!isRecord(supplied)) return Object.freeze([...requirements]);
  return Object.freeze(
    requirements.filter((requirement) =>
      requirement
        .split('|')
        .every((name) => !hasConfiguredValue(supplied[name])),
    ),
  );
}

function hasConfiguredValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

async function createBuiltinProvider(
  kind: BuiltinProviderKind,
  supplied: unknown,
): Promise<Provider> {
  const options = (supplied ?? {}) as never;
  switch (kind) {
    case 'amazon-bedrock':
      return createAmazonBedrockProvider(options);
    case 'ant-ling':
      return antLingProvider(options);
    case 'anthropic':
      return createAnthropicProvider(options);
    case 'azure-openai-responses':
      return createAzureOpenAiResponsesProvider(options);
    case 'cerebras':
      return cerebrasProvider(options);
    case 'cloudflare-ai-gateway':
      return cloudflareAiGatewayProvider(options);
    case 'cloudflare-workers-ai':
      return cloudflareWorkersAiProvider(options);
    case 'deepseek':
      return deepseekProvider(options);
    case 'doubao':
      return doubaoProvider(options);
    case 'fireworks':
      return fireworksProvider(options);
    case 'github-copilot':
      return githubCopilotProvider(options);
    case 'google':
      return createGoogleProvider(options);
    case 'google-vertex':
      return createGoogleVertexProvider(options);
    case 'groq':
      return groqProvider(options);
    case 'huggingface':
      return huggingfaceProvider(options);
    case 'kimi-coding':
      return kimiCodingProvider(options);
    case 'kling':
      return klingProvider(options);
    case 'minimax':
      return minimaxProvider(options);
    case 'minimax-cn':
      return minimaxCnProvider(options);
    case 'mistral':
      return mistralProvider(options);
    case 'moonshotai':
      return moonshotAiProvider(options);
    case 'moonshotai-cn':
      return moonshotAiCnProvider(options);
    case 'nvidia':
      return nvidiaProvider(options);
    case 'openai':
      return createOpenAiProvider(options);
    case 'openai-codex':
      return openAiCodexProvider(options);
    case 'opencode':
      return openCodeProvider(options);
    case 'opencode-go':
      return openCodeGoProvider(options);
    case 'openrouter':
      return openRouterProvider(options);
    case 'qwen':
      return qwenProvider(options);
    case 'radius':
      return radiusProvider(options);
    case 'self-hosted-generation':
      return selfHostedGenerationProvider(options);
    case 'together':
      return togetherProvider(options);
    case 'vercel-ai-gateway':
      return vercelAiGatewayProvider(options);
    case 'xai':
      return xAiProvider(options);
    case 'xiaomi':
      return xiaomiProvider(options);
    case 'xiaomi-token-plan-ams':
      return xiaomiTokenPlanAmsProvider(options);
    case 'xiaomi-token-plan-cn':
      return xiaomiTokenPlanCnProvider(options);
    case 'xiaomi-token-plan-sgp':
      return xiaomiTokenPlanSgpProvider(options);
    case 'zai':
      return zaiProvider(options);
    case 'zai-coding-cn':
      return zaiCodingCnProvider(options);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
