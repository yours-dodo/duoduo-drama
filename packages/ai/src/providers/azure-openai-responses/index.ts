import type { EnvironmentSource } from '../../auth/ambient.js';
import { AiRuntimeError } from '../../core/errors.js';
import type { ModelDefinition, ModelPricing } from '../../core/models.js';
import { runAzureOpenAiResponses } from '../../protocols/azure-openai-responses/adapter.js';
import type { Provider } from '../../runtime/registry.js';

export interface AzureOpenAiModelInput {
  readonly id: string;
  readonly deploymentName?: string;
  readonly name?: string;
  readonly contextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: boolean;
  readonly pricing?: ModelPricing;
}

export interface AzureOpenAiProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string | URL;
  readonly resourceName?: string;
  readonly apiVersion?: string;
  readonly deploymentName?: string;
  readonly deploymentMap?: Readonly<Record<string, string>> | string;
  readonly environment?: EnvironmentSource;
  readonly models?: readonly AzureOpenAiModelInput[];
}

export interface ResolvedAzureOpenAiConfiguration {
  readonly baseUrl: string;
  readonly apiVersion: string;
  readonly deploymentName: string;
}

export function resolveAzureOpenAiConfiguration(input: {
  readonly modelId: string;
  readonly options: AzureOpenAiProviderOptions;
  readonly environment?: EnvironmentSource;
}): ResolvedAzureOpenAiConfiguration {
  const environment = input.environment ?? input.options.environment;
  const explicitBaseUrl = stringValue(input.options.baseUrl);
  const environmentBaseUrl = trim(environment?.get('AZURE_OPENAI_BASE_URL'));
  const resourceName =
    trim(input.options.resourceName) ??
    trim(environment?.get('AZURE_OPENAI_RESOURCE_NAME'));
  const baseUrl =
    explicitBaseUrl ??
    environmentBaseUrl ??
    (resourceName ? resourceBaseUrl(resourceName) : undefined);
  if (!baseUrl)
    throw new AiRuntimeError(
      'AZURE_OPENAI_ENDPOINT_UNCONFIGURED',
      'invalid_request',
      'Azure OpenAI requires an explicit base URL or resource name',
    );
  const apiVersion =
    trim(input.options.apiVersion) ??
    trim(environment?.get('AZURE_OPENAI_API_VERSION')) ??
    'v1';
  const explicitMap = parseDeploymentMap(input.options.deploymentMap);
  const environmentMap = parseDeploymentMap(
    environment?.get('AZURE_OPENAI_DEPLOYMENT_NAME_MAP'),
  );
  const deploymentName =
    trim(input.options.deploymentName) ??
    trim(environment?.get('AZURE_OPENAI_DEPLOYMENT_NAME')) ??
    explicitMap.get(input.modelId) ??
    environmentMap.get(input.modelId) ??
    input.modelId;
  return Object.freeze({
    baseUrl: normalizeBaseUrl(baseUrl),
    apiVersion,
    deploymentName,
  });
}

export function createAzureOpenAiResponsesProvider(
  options: AzureOpenAiProviderOptions,
): Provider {
  const id = options.id ?? 'azure-openai-responses';
  const models = options.models ?? [{ id: 'gpt-4.1-mini' }];
  const definitions = models.map((model) => {
    const resolved = resolveAzureOpenAiConfiguration({
      modelId: model.id,
      options: {
        ...options,
        ...(model.deploymentName
          ? { deploymentName: model.deploymentName }
          : {}),
      },
    });
    return makeModel(id, model, resolved.deploymentName);
  });
  const endpoints = new Set(
    models.map((model) => {
      const resolved = resolveAzureOpenAiConfiguration({
        modelId: model.id,
        options: {
          ...options,
          ...(model.deploymentName
            ? { deploymentName: model.deploymentName }
            : {}),
        },
      });
      return endpointFor(resolved);
    }),
  );
  if (endpoints.size !== 1)
    throw new AiRuntimeError(
      'AZURE_OPENAI_MODEL_ENDPOINT_CONFLICT',
      'invalid_request',
      'Azure OpenAI models in one provider must resolve to one endpoint',
    );
  const endpoint = [...endpoints][0]!;
  return Object.freeze({
    id,
    kind: 'azure-openai-responses',
    name: 'Azure OpenAI Responses',
    identity: Object.freeze({ endpoint }),
    contractManifest: Object.freeze({
      schemaVersion: 1 as const,
      providerKind: 'azure-openai-responses',
      bindings: Object.freeze([
        Object.freeze({
          capability: 'chat' as const,
          protocol: 'azure-openai-responses',
          profileIds: Object.freeze(['azure-openai-responses-default']),
          authSchemes: Object.freeze(['api_key']),
          endpointBranchIds: Object.freeze([
            'explicit-base-url',
            'environment-base-url',
            'resource-name',
            'explicit-deployment',
            'deployment-map',
            'model-id-fallback',
          ]),
          requestFixtureIds: Object.freeze(['azure_openai_responses_request']),
          streamFixtureIds: Object.freeze(['azure_openai_responses_stream']),
          errorFixtureIds: Object.freeze([
            'azure_openai_endpoint_unconfigured',
            'azure_openai_model_endpoint_conflict',
          ]),
          sources: Object.freeze([
            Object.freeze({
              kind: 'official' as const,
              locator:
                'https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/responses',
            }),
            Object.freeze({
              kind: 'fixture' as const,
              locator: 'src/providers/azure-openai-responses/index.test.ts',
            }),
          ]),
        }),
      ]),
    }),
    chat: Object.freeze({
      models: Object.freeze(definitions),
      transport: Object.freeze({
        endpoint,
        headers: Object.freeze({ 'content-type': 'application/json' }),
        credential: Object.freeze({ headerName: 'api-key', defaultScheme: '' }),
        retrySafety: Object.freeze({
          mode: 'idempotency-key' as const,
          headerName: 'idempotency-key',
          keyVersion: 1,
        }),
      }),
      runChat: runAzureOpenAiResponses,
    }),
  });
}

function endpointFor(configuration: ResolvedAzureOpenAiConfiguration): string {
  const base = new URL(`${configuration.baseUrl.replace(/\/$/, '')}/responses`);
  base.searchParams.set('api-version', configuration.apiVersion);
  return base.href;
}

function resourceBaseUrl(resourceName: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(resourceName))
    throw new AiRuntimeError(
      'AZURE_OPENAI_RESOURCE_NAME_INVALID',
      'invalid_request',
      'Azure OpenAI resource name is invalid',
    );
  return `https://${resourceName}.openai.azure.com/openai/v1`;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AiRuntimeError(
      'AZURE_OPENAI_BASE_URL_INVALID',
      'invalid_request',
      'Azure OpenAI base URL is invalid',
    );
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new AiRuntimeError(
      'AZURE_OPENAI_BASE_URL_INVALID',
      'invalid_request',
      'Azure OpenAI base URL must be an HTTPS URL without credentials or a fragment',
    );
  url.search = '';
  url.pathname = url.pathname.replace(/\/$/, '');
  return url.href.replace(/\/$/, '');
}

function parseDeploymentMap(
  value: Readonly<Record<string, string>> | string | undefined,
): Map<string, string> {
  const result = new Map<string, string>();
  if (value === undefined) return result;
  if (typeof value !== 'string') {
    for (const [modelId, deploymentName] of Object.entries(value)) {
      const model = trim(modelId);
      const deployment = trim(deploymentName);
      if (!model || !deployment) throw invalidDeploymentMap();
      result.set(model, deployment);
    }
    return result;
  }
  for (const rawEntry of value.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const parts = entry.split('=');
    if (parts.length !== 2) throw invalidDeploymentMap();
    const model = trim(parts[0]);
    const deployment = trim(parts[1]);
    if (!model || !deployment) throw invalidDeploymentMap();
    result.set(model, deployment);
  }
  return result;
}

function invalidDeploymentMap(): AiRuntimeError {
  return new AiRuntimeError(
    'AZURE_OPENAI_DEPLOYMENT_MAP_INVALID',
    'invalid_request',
    'Azure OpenAI deployment map is malformed',
  );
}

function stringValue(value: string | URL | undefined): string | undefined {
  return value instanceof URL ? value.href : trim(value);
}

function trim(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function makeModel(
  providerInstanceId: string,
  input: AzureOpenAiModelInput,
  deploymentName: string,
): ModelDefinition<'azure-openai-responses'> {
  return Object.freeze({
    id: input.id,
    upstreamModelId: deploymentName,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: 'OpenAI',
    protocol: 'azure-openai-responses',
    protocolProfileId: 'azure-openai-responses-default',
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
