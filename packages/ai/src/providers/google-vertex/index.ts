import type { AmbientAuth, EnvironmentSource } from '../../auth/ambient.js';
import { resolveGoogleAdcConfiguration } from '../../auth/ambient/google-adc.js';
import type { ModelDefinition, ModelPricing } from '../../core/models.js';
import { runGoogleVertex } from '../../protocols/google-vertex/adapter.js';
import type { Provider } from '../../runtime/registry.js';

export type GoogleVertexAuthMode = 'auto' | 'api-key' | 'adc';

export interface GoogleVertexModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly contextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: boolean;
  readonly pricing?: ModelPricing;
}

export interface CreateGoogleVertexProviderOptions {
  readonly id?: string;
  readonly authMode?: GoogleVertexAuthMode;
  readonly project?: string;
  readonly location?: string;
  readonly baseUrl?: string;
  readonly environment?: EnvironmentSource;
  readonly ambientAuth?: AmbientAuth;
  readonly models?: readonly GoogleVertexModelInput[];
}

export function createGoogleVertexProvider(
  options: CreateGoogleVertexProviderOptions = {},
): Provider {
  const id = options.id ?? 'google-vertex';
  const authMode = resolveAuthMode(options.authMode, options.ambientAuth);
  const adc =
    authMode === 'adc'
      ? resolveGoogleAdcConfiguration({
          project: options.project,
          location: options.location,
          environment: options.environment,
        })
      : undefined;
  if (authMode === 'adc' && !options.ambientAuth)
    throw new TypeError('Google Vertex ADC ambientAuth is required');
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ??
      (adc
        ? `https://${adc.location}-aiplatform.googleapis.com/v1`
        : 'https://aiplatform.googleapis.com/v1'),
  );
  const models = options.models ?? [{ id: 'gemini-2.5-flash' }];
  const identity = {
    authMode,
    baseUrl,
    vertexai: 'true',
    apiVersion: 'v1',
    ...(adc ? { project: adc.project, location: adc.location } : {}),
  };
  return {
    id,
    kind: 'google-vertex',
    name: 'Google Vertex AI',
    identity,
    ...(authMode === 'adc'
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
          adc
            ? `${baseUrl}/projects/${encodeURIComponent(adc.project)}/locations/${encodeURIComponent(adc.location)}/publishers/google/models/${encodeURIComponent(model.upstreamModelId)}:streamGenerateContent?alt=sse`
            : `${baseUrl}/publishers/google/models/${encodeURIComponent(model.upstreamModelId)}:streamGenerateContent?alt=sse`,
        headers: { 'content-type': 'application/json' },
        credential:
          authMode === 'adc'
            ? { headerName: 'authorization' }
            : { headerName: 'x-goog-api-key', defaultScheme: '' },
      },
      runChat: runGoogleVertex,
    },
  };
}

function resolveAuthMode(
  requested: GoogleVertexAuthMode | undefined,
  ambientAuth: AmbientAuth | undefined,
): Exclude<GoogleVertexAuthMode, 'auto'> {
  if (!requested || requested === 'auto')
    return ambientAuth ? 'adc' : 'api-key';
  return requested;
}

function makeModel(
  providerInstanceId: string,
  input: GoogleVertexModelInput,
): ModelDefinition<'google-vertex'> {
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: 'Google',
    family: 'Gemini',
    protocol: 'google-vertex',
    protocolProfileId: 'google-vertex-default',
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
