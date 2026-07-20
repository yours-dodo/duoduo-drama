import { createHash } from 'node:crypto';
import type { JsonValue } from '../../core/content.js';
import type {
  ModelDefinition,
  ModelPricing,
  ModelRef,
} from '../../core/models.js';
import type { AuthFlowContext } from '../../auth/oauth.js';
import {
  createRadiusOAuthFlow,
  type RadiusOAuthFlowOptions,
} from '../../auth/oauth/radius/index.js';
import { createPiMessagesAdapter } from '../../protocols/pi-messages/index.js';
import type { Provider } from '../../runtime/registry.js';

export const DEFAULT_RADIUS_GATEWAY = 'https://radius.pi.dev';

export interface RadiusModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly contextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: boolean;
  readonly input?: readonly ('text' | 'image')[];
  readonly pricing?: ModelPricing;
}

export interface RadiusProviderOptions {
  readonly id?: string;
  readonly name?: string;
  readonly gateway?: string;
  readonly baseUrl?: string;
  readonly models?: readonly RadiusModelInput[];
  readonly oauth?: RadiusOAuthFlowOptions | false;
}

export interface RadiusGatewayConfig {
  readonly baseUrl: string;
  readonly models: readonly RadiusModelInput[];
  readonly cacheMaxAgeMs?: number;
}

export function radiusProvider(options: RadiusProviderOptions = {}): Provider {
  const id = options.id ?? 'radius';
  const gateway = normalizeRadiusGatewayUrl(
    options.gateway ?? DEFAULT_RADIUS_GATEWAY,
  );
  const staticBaseUrl = options.baseUrl
    ? validateRadiusServiceBaseUrl(options.baseUrl, gateway)
    : gateway;
  const endpoint = new URL('messages', `${staticBaseUrl}/`).href;
  const models = options.models ?? [];
  return {
    id,
    kind: 'radius',
    name: options.name ?? 'Radius',
    identity: Object.freeze({ gateway, endpoint }),
    ...(options.oauth === false
      ? {
          auth: {
            policyFingerprint: `radius:${new URL(gateway).origin}:api-key-v1`,
          },
        }
      : {
          auth: {
            policyFingerprint: `radius:${new URL(gateway).origin}:oauth-v1`,
            oauth: createRadiusOAuthFlow({ gateway, ...options.oauth }),
          },
        }),
    contractManifest: {
      schemaVersion: 1,
      providerKind: 'radius',
      bindings: [
        {
          capability: 'chat',
          protocol: 'pi-messages',
          profileIds: ['radius-default'],
          authSchemes: ['api-key', 'oauth'],
          endpointBranchIds: ['gateway-config'],
          requestFixtureIds: ['radius-messages'],
          streamFixtureIds: ['radius-stream'],
          errorFixtureIds: ['radius-config-error'],
          sources: [{ kind: 'pi', locator: 'providers/radius.ts' }],
        },
      ],
    },
    chat: {
      models: Object.freeze(models.map((model) => makeModel(id, model))),
      transport: {
        endpoint,
        endpointForCredential: (_model, facts) => {
          const baseUrl =
            typeof facts?.radiusBaseUrl === 'string'
              ? facts.radiusBaseUrl
              : staticBaseUrl;
          return new URL(
            'messages',
            `${validateRadiusServiceBaseUrl(baseUrl, gateway)}/`,
          ).href;
        },
        derivedOriginPolicy: {
          id: 'radius-config-base-url',
          version: 1,
          configuration: Object.freeze({
            gatewayOrigin: new URL(gateway).origin,
          }),
          resolve: (facts) => {
            const baseUrl =
              typeof facts?.radiusBaseUrl === 'string'
                ? facts.radiusBaseUrl
                : staticBaseUrl;
            return Object.freeze([
              new URL(validateRadiusServiceBaseUrl(baseUrl, gateway)).origin,
            ]);
          },
        },
        headers: Object.freeze({
          'content-type': 'application/json',
          accept: 'text/event-stream',
        }),
        credential: { headerName: 'authorization', defaultScheme: 'Bearer' },
        retrySafety: { mode: 'before-dispatch-only' },
      },
      runChat: createPiMessagesAdapter(),
    },
  };
}

export const createRadiusProvider = radiusProvider;

export function radiusModelRef(
  modelId: string,
  providerInstanceId = 'radius',
): ModelRef<'pi-messages'> {
  return Object.freeze({
    providerInstanceId,
    modelId,
    protocol: 'pi-messages',
  });
}

export async function discoverRadiusGatewayConfig(
  gateway: string,
  context: Pick<AuthFlowContext, 'transport' | 'networkPolicy' | 'signal'>,
  authorization?: import('../../auth/secret-value.js').SecretValue,
): Promise<RadiusGatewayConfig> {
  const normalizedGateway = normalizeRadiusGatewayUrl(gateway);
  const endpoint = new URL('/v1/config', normalizedGateway);
  await context.networkPolicy.authorize(
    endpoint,
    { purpose: 'discovery' },
    context.signal,
  );
  const response = await context.transport.send({
    method: 'GET',
    url: endpoint,
    headers: authorization
      ? { accept: 'application/json', authorization }
      : { accept: 'application/json' },
    redirect: 'error',
    maxResponseBytes: 1024 * 1024,
    signal: context.signal,
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error(
      `Radius config request failed with HTTP ${response.status}`,
    );
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(response.body));
  } catch {
    throw new Error('Radius config is not valid JSON');
  }
  return parseRadiusGatewayConfig(value, normalizedGateway);
}

export function parseRadiusGatewayConfig(
  value: unknown,
  gateway = DEFAULT_RADIUS_GATEWAY,
): RadiusGatewayConfig {
  if (
    !isObject(value) ||
    typeof value.baseUrl !== 'string' ||
    !Array.isArray(value.models)
  )
    throw new TypeError('Radius config must contain baseUrl and models');
  const baseUrl = validateRadiusServiceBaseUrl(
    value.baseUrl,
    normalizeRadiusGatewayUrl(gateway),
  );
  const models = value.models.map(parseRadiusModel);
  if (models.length === 0)
    throw new TypeError('Radius config models cannot be empty');
  const cacheMaxAgeMs = positiveNumber(
    value.cacheMaxAgeMs ?? value.cache_max_age_ms,
  );
  return Object.freeze({
    baseUrl,
    models: Object.freeze(models),
    ...(cacheMaxAgeMs ? { cacheMaxAgeMs } : {}),
  });
}

export function radiusConfigDigest(config: RadiusGatewayConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

function parseRadiusModel(value: unknown, index: number): RadiusModelInput {
  if (!isObject(value) || typeof value.id !== 'string' || value.id.length === 0)
    throw new TypeError(`Radius model at index ${index} is invalid`);
  const input: readonly ('text' | 'image')[] = Array.isArray(value.input)
    ? value.input.filter(
        (item): item is 'text' | 'image' => item === 'text' || item === 'image',
      )
    : ['text'];
  const normalizedInput: readonly ('text' | 'image')[] =
    input.length > 0 ? input : ['text'];
  const cost = isObject(value.cost) ? value.cost : undefined;
  const pricing = cost
    ? {
        currency: 'USD' as const,
        unit: 'per_million_tokens' as const,
        rates: Object.freeze({
          input: finiteNumber(cost.input),
          output: finiteNumber(cost.output),
          cacheRead: finiteNumber(cost.cacheRead ?? cost.cache_read),
          cacheWrite: finiteNumber(cost.cacheWrite ?? cost.cache_write),
        }),
      }
    : undefined;
  return Object.freeze({
    id: value.id,
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.reasoning === 'boolean'
      ? { reasoning: value.reasoning }
      : {}),
    input: Object.freeze(normalizedInput),
    ...(positiveNumber(
      value.contextTokens ?? value.contextWindow ?? value.context_window,
    )
      ? {
          contextTokens: positiveNumber(
            value.contextTokens ?? value.contextWindow ?? value.context_window,
          )!,
        }
      : {}),
    ...(positiveNumber(
      value.maxOutputTokens ?? value.maxTokens ?? value.max_tokens,
    )
      ? {
          maxOutputTokens: positiveNumber(
            value.maxOutputTokens ?? value.maxTokens ?? value.max_tokens,
          )!,
        }
      : {}),
    ...(pricing ? { pricing } : {}),
  });
}

function makeModel(
  providerInstanceId: string,
  input: RadiusModelInput,
): ModelDefinition<'pi-messages'> {
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: 'Radius',
    protocol: 'pi-messages',
    protocolProfileId: 'radius-default',
    capabilities: Object.freeze({
      input: input.input ?? (['text'] as const),
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

export function normalizeRadiusGatewayUrl(value: string): string {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//iu.test(value)
    ? value
    : `https://${value}`;
  const url = new URL(candidate);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new TypeError('Radius gateway must be a plain HTTPS URL');
  return url.href.replace(/\/+$/u, '');
}

function validateRadiusServiceBaseUrl(value: string, gateway: string): string {
  const url = new URL(value, `${gateway}/`);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new TypeError('Radius service baseUrl must be a plain HTTPS URL');
  const gatewayUrl = new URL(gateway);
  if (
    url.origin !== gatewayUrl.origin &&
    !sameRegistrableDomain(url.hostname, gatewayUrl.hostname)
  )
    throw new TypeError(
      'Radius service baseUrl origin is not allowed by the gateway binding',
    );
  return url.href.replace(/\/+$/u, '');
}

function sameRegistrableDomain(left: string, right: string): boolean {
  const suffix = (value: string) =>
    value.toLowerCase().split('.').slice(-2).join('.');
  return suffix(left) === suffix(right);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
void (undefined as unknown as JsonValue);
