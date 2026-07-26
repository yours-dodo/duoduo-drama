import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  gatewayProviderDescriptors,
  createGatewayProvider,
} from './_shared/multi-protocol.js';

const expected = [
  [
    'cloudflare-ai-gateway',
    ['anthropic-messages', 'openai-chat-completions', 'openai-responses'],
  ],
  ['fireworks', ['anthropic-messages', 'openai-chat-completions']],
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
