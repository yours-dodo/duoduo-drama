import { createHash } from 'node:crypto';

import type { ModelDefinition, ModelPricing } from '../../core/models.js';
import {
  createAnthropicMessagesAdapter,
  type AnthropicMessagesCompatibility,
} from '../../protocols/anthropic-messages/adapter.js';
import {
  createAnthropicOAuthFlow,
  type CreateAnthropicOAuthFlowOptions,
} from '../../auth/oauth/anthropic/index.js';
import type { Provider } from '../../runtime/registry.js';

export interface AnthropicModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly contextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: boolean;
  readonly pricing?: ModelPricing;
}

export interface CreateAnthropicProviderOptions {
  readonly id?: string;
  readonly endpoint?: string;
  readonly anthropicVersion?: string;
  readonly models?: readonly AnthropicModelInput[];
  readonly compatibility?: AnthropicMessagesCompatibility;
  readonly oauth?: CreateAnthropicOAuthFlowOptions | false;
}

export function createAnthropicProvider(
  options: CreateAnthropicProviderOptions = {},
): Provider {
  const id = options.id ?? 'anthropic';
  const endpoint = options.endpoint ?? 'https://api.anthropic.com/v1/messages';
  const models = options.models ?? [{ id: 'claude-sonnet-4-5' }];
  const runChat = createAnthropicMessagesAdapter({
    compatibility: options.compatibility,
  });
  return {
    id,
    kind: 'anthropic',
    name: 'Anthropic',
    identity: { endpoint, version: options.anthropicVersion ?? '2023-06-01' },
    ...(options.oauth === false
      ? {}
      : {
          auth: {
            policyFingerprint: anthropicOAuthPolicyFingerprint(options.oauth),
            oauth: createAnthropicOAuthFlow(options.oauth),
          },
        }),
    contractManifest: Object.freeze({
      schemaVersion: 1 as const,
      providerKind: 'anthropic',
      bindings: Object.freeze([
        Object.freeze({
          capability: 'chat' as const,
          protocol: 'anthropic-messages',
          profileIds: Object.freeze(['anthropic-messages-default']),
          authSchemes: Object.freeze(['api_key', 'oauth']),
          endpointBranchIds: Object.freeze([
            'messages-default',
            'explicit-endpoint',
          ]),
          requestFixtureIds: Object.freeze(['anthropic_thinking_tool_request']),
          streamFixtureIds: Object.freeze([
            'anthropic_thinking_unsigned_stream',
            'anthropic_cache_one_hour_stream',
          ]),
          errorFixtureIds: Object.freeze(['anthropic_overloaded_error']),
          sources: Object.freeze([
            Object.freeze({
              kind: 'official' as const,
              locator: 'https://docs.anthropic.com/en/api/messages-streaming',
            }),
            Object.freeze({
              kind: 'fixture' as const,
              locator: 'test/fixtures/anthropic',
            }),
          ]),
        }),
      ]),
    }),
    chat: {
      models: models.map((model) => makeModel(id, model)),
      transport: {
        endpoint,
        headers: {
          'anthropic-version': options.anthropicVersion ?? '2023-06-01',
          'content-type': 'application/json',
        },
        credential: {
          headerName: 'x-api-key',
          defaultScheme: '',
          variants: {
            Bearer: { headerName: 'authorization', defaultScheme: 'Bearer' },
          },
        },
      },
      runChat,
    },
  };
}

function makeModel(
  providerInstanceId: string,
  input: AnthropicModelInput,
): ModelDefinition<'anthropic-messages'> {
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: 'Anthropic',
    protocol: 'anthropic-messages',
    protocolProfileId: 'anthropic-messages-default',
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
      contextTokens: input.contextTokens ?? 200_000,
      maxOutputTokens: input.maxOutputTokens ?? 64_000,
    }),
    ...(input.pricing ? { pricing: Object.freeze(input.pricing) } : {}),
  });
}

function anthropicOAuthPolicyFingerprint(
  options: CreateAnthropicOAuthFlowOptions | undefined,
): string {
  const value = options ?? {};
  const canonical = JSON.stringify([
    '@duoduo/ai/anthropic-oauth-policy',
    1,
    value.authorizeEndpoint ?? null,
    value.tokenEndpoint ?? null,
    value.revokeEndpoint ?? null,
    value.redirectUri ?? null,
    value.clientId ?? null,
    value.scopes ? [...value.scopes] : null,
    value.refreshSkewMs ?? null,
  ]);
  return createHash('sha256').update(canonical).digest('base64url');
}
