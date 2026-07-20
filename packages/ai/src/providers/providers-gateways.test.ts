import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { createAi, secret } from '../index.js';
import { createAllowlistNetworkPolicy } from '../transport/network-policy.js';
import { createFixtureTransportDriver } from '../transport/fixture-driver.js';
import {
  gatewayProviderDescriptors,
  createGatewayProvider,
  resolveGitHubCopilotOrigin,
} from './_shared/multi-protocol.js';

const expected = [
  [
    'cloudflare-ai-gateway',
    ['anthropic-messages', 'openai-chat-completions', 'openai-responses'],
  ],
  ['fireworks', ['anthropic-messages', 'openai-chat-completions']],
  [
    'github-copilot',
    ['anthropic-messages', 'openai-chat-completions', 'openai-responses'],
  ],
  ['kimi-coding', ['anthropic-messages']],
  ['minimax', ['anthropic-messages']],
  ['minimax-cn', ['anthropic-messages']],
  [
    'opencode',
    [
      'anthropic-messages',
      'google-generative-ai',
      'openai-chat-completions',
      'openai-responses',
    ],
  ],
  ['opencode-go', ['anthropic-messages', 'openai-chat-completions']],
  ['openrouter', ['openai-chat-completions']],
  ['vercel-ai-gateway', ['anthropic-messages']],
] as const;

describe('multi-protocol gateway provider wave', () => {
  it('freezes every provider × protocol, auth, endpoint, and manifest row', () => {
    expect(
      gatewayProviderDescriptors.map((descriptor) => [
        descriptor.kind,
        descriptor.bindings.map((binding) => binding.protocol),
      ]),
    ).toEqual(expected);

    for (const descriptor of gatewayProviderDescriptors) {
      const provider = createGatewayProvider(descriptor, {
        ...(descriptor.kind === 'cloudflare-ai-gateway'
          ? { accountId: 'account', gatewayId: 'gateway' }
          : {}),
      });
      expect(provider.contractManifest?.bindings).toHaveLength(
        descriptor.bindings.length,
      );
      expect(provider.chat?.models.map((model) => model.protocol)).toEqual(
        descriptor.bindings.map((binding) => binding.protocol),
      );
      expect(provider.auth?.policyFingerprint).toContain(
        descriptor.environmentVariable,
      );
    }
  });

  it('keeps OpenRouter and Vercel routing as typed profiles', () => {
    const openRouter = createGatewayProvider(
      gatewayProviderDescriptors.find(({ kind }) => kind === 'openrouter')!,
      {
        openRouterRouting: { only: ['anthropic'], allow_fallbacks: false },
      },
    );
    const vercel = createGatewayProvider(
      gatewayProviderDescriptors.find(
        ({ kind }) => kind === 'vercel-ai-gateway',
      )!,
      { vercelGatewayRouting: { only: ['anthropic'], order: ['anthropic'] } },
    );
    expect(openRouter.identity?.routing).toBe(
      '{"only":["anthropic"],"allow_fallbacks":false}',
    );
    expect(vercel.identity?.routing).toBe(
      '{"only":["anthropic"],"order":["anthropic"]}',
    );
  });

  it('resolves and validates GitHub Copilot proxy and enterprise origins', () => {
    expect(
      resolveGitHubCopilotOrigin({
        copilotToken: 'tid=1;proxy-ep=proxy.enterprise.example;exp=1',
      }),
    ).toBe('https://api.enterprise.example');
    expect(
      resolveGitHubCopilotOrigin({ enterpriseDomain: 'github.example.com' }),
    ).toBe('https://copilot-api.github.example.com');
    expect(resolveGitHubCopilotOrigin({})).toBe(
      'https://api.individual.githubcopilot.com',
    );
    expect(() =>
      resolveGitHubCopilotOrigin({
        copilotToken: 'tid=1;proxy-ep=https://evil.example/path;exp=1',
      }),
    ).toThrowError(/proxy endpoint hint is invalid/);
    expect(() =>
      resolveGitHubCopilotOrigin({ enterpriseDomain: 'evil.example:8443' }),
    ).toThrowError(/enterprise domain is invalid/);
    expect(String(secret('proxy-ep=proxy.secret.example'))).toBe('[REDACTED]');
  });

  it('binds a stored GitHub endpoint fact to the request origin without exposing the token', async () => {
    const descriptor = gatewayProviderDescriptors.find(
      ({ kind }) => kind === 'github-copilot',
    )!;
    const provider = createGatewayProvider(descriptor, { oauth: false });
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      status: 200,
      bodyChunks: [
        new TextEncoder().encode(
          'data: {"id":"chatcmpl_copilot","model":"gpt-4.1","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\ndata: [DONE]\n\n',
        ),
      ],
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://api.enterprise.example'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(provider);
    const credentialOverride = {
      type: 'bearer_token' as const,
      secret: secret('copilot-secret-canary'),
      bindingFacts: { endpointOrigin: 'https://api.enterprise.example' },
    };
    const model = await ai.models.require(
      {
        providerInstanceId: provider.id,
        modelId: descriptor.defaultModelId,
        protocol: 'openai-chat-completions',
      },
      {},
      { credentialOverride },
    );
    const response = await ai.complete(
      model,
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        ],
      },
      { credentialOverride, protocolOptions: { thinkingEnabled: false } },
    );
    expect(response.status).toBe('completed');
    expect(transport.requests()).toEqual([
      expect.objectContaining({
        origin: 'https://api.enterprise.example',
        pathname: '/chat/completions',
      }),
    ]);
    expect(JSON.stringify(transport.requests())).not.toContain(
      'copilot-secret-canary',
    );
  });

  it('rejects malformed GitHub endpoint facts before transport use', async () => {
    const descriptor = gatewayProviderDescriptors.find(
      ({ kind }) => kind === 'github-copilot',
    )!;
    const provider = createGatewayProvider(descriptor, { oauth: false });
    const transport = createFixtureTransportDriver();
    transport.enqueue({ status: 200, bodyChunks: [] });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://api.individual.githubcopilot.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(provider);
    const credentialOverride = {
      type: 'bearer_token' as const,
      secret: secret('copilot-redacted-value'),
      bindingFacts: { endpointOrigin: 'https://api.enterprise.example/path' },
    };
    const model = await ai.models.require(
      {
        providerInstanceId: provider.id,
        modelId: descriptor.defaultModelId,
        protocol: 'openai-chat-completions',
      },
      {},
      { credentialOverride },
    );
    const response = await ai.complete(
      model,
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        ],
      },
      { credentialOverride, protocolOptions: { thinkingEnabled: false } },
    );
    expect(response).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_REQUEST_TARGET' },
    });
    expect(transport.pendingCount()).toBe(1);
    expect(transport.requests()).toEqual([]);
  });

  it('loads every checked-in gateway contract fixture', async () => {
    for (const descriptor of gatewayProviderDescriptors) {
      for (const binding of descriptor.bindings) {
        const root = new URL(
          `../../test/fixtures/gateways/${descriptor.kind}/${binding.protocol}/`,
          import.meta.url,
        );
        const request = JSON.parse(
          await readFile(new URL('request.json', root), 'utf8'),
        ) as { provider: string; protocol: string };
        const stream = await readFile(new URL('stream.sse', root), 'utf8');
        const error = JSON.parse(
          await readFile(new URL('error.json', root), 'utf8'),
        ) as { provider: string; protocol: string };
        expect(request).toMatchObject({
          provider: descriptor.kind,
          protocol: binding.protocol,
        });
        expect(error).toMatchObject({
          provider: descriptor.kind,
          protocol: binding.protocol,
        });
        expect(stream.length).toBeGreaterThan(0);
        expect(
          `${JSON.stringify(request)}${stream}${JSON.stringify(error)}`,
        ).not.toMatch(/sk-|secret-canary|github-token/);
      }
    }
  });
});
