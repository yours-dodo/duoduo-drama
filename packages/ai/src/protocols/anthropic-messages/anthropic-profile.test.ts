import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { createAi, secret } from '../../index.js';
import { createAnthropicProvider } from '../../providers/anthropic/index.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';

const encoder = new TextEncoder();
const fixtureRoot = new URL(
  '../../../test/fixtures/anthropic/',
  import.meta.url,
);

async function fixture(name: string): Promise<readonly Uint8Array[]> {
  return [
    new Uint8Array(await readFile(new URL(name, fixtureRoot))),
    encoder.encode('\n'),
  ];
}

function stoppedToolStream(input: unknown = {}) {
  const events = [
    {
      type: 'message_start',
      message: { id: 'msg_profile', model: 'claude-profile', usage: {} },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tool_1', name: 'lookup', input },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  ];
  return events.map((event) =>
    encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
  );
}

describe('Anthropic Messages compatibility profile', () => {
  it('forces adaptive thinking and omits unsupported tool cache control', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        jsonBody: {
          model: 'claude-sonnet-4-5',
          system: [
            {
              type: 'text',
              text: 'cached',
              cache_control: { type: 'ephemeral', ttl: '1h' },
            },
          ],
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'use tool' }] },
          ],
          tools: [
            {
              name: 'lookup',
              input_schema: { type: 'object', properties: {} },
            },
          ],
          thinking: { type: 'adaptive' },
          max_tokens: 32,
          stream: true,
        },
      },
      status: 200,
      bodyChunks: stoppedToolStream(),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://api.anthropic.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    const provider = createAnthropicProvider({
      compatibility: {
        forceAdaptiveThinking: true,
        supportsCacheControlOnTools: false,
      },
    });
    ai.providers.register(provider);
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('profile-key'),
      scheme: '',
    };
    const model = await ai.models.require(
      {
        providerInstanceId: provider.id,
        modelId: 'claude-sonnet-4-5',
        protocol: 'anthropic-messages',
      },
      {},
      { credentialOverride },
    );

    await expect(
      ai.complete(
        model,
        {
          systemPrompt: 'cached',
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'use tool' }] },
          ],
          tools: [
            {
              name: 'lookup',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
        {
          credentialOverride,
          maxOutputTokens: 32,
          protocolOptions: { cacheRetention: 'one_hour' },
        },
      ),
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('preserves eager tool input when no JSON deltas follow', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      status: 200,
      bodyChunks: stoppedToolStream({ q: 'hi' }),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://api.anthropic.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    const provider = createAnthropicProvider();
    ai.providers.register(provider);
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('tool-key'),
      scheme: '',
    };
    const model = await ai.models.require(
      {
        providerInstanceId: provider.id,
        modelId: 'claude-sonnet-4-5',
        protocol: 'anthropic-messages',
      },
      {},
      { credentialOverride },
    );

    await expect(
      ai.complete(
        model,
        {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        },
        { credentialOverride, maxOutputTokens: 32 },
      ),
    ).resolves.toMatchObject({
      status: 'completed',
      content: [
        {
          type: 'tool_call',
          rawArguments: '{"q":"hi"}',
          arguments: { q: 'hi' },
          status: 'complete',
        },
      ],
    });
  });
});

function thinkingStream(input: {
  readonly signature?: string;
  readonly usage?: Readonly<Record<string, unknown>>;
}) {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_thinking',
        model: 'claude-sonnet-4-5',
        usage: input.usage ?? { input_tokens: 1, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: 'considering' },
    },
    ...(input.signature
      ? [
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: input.signature },
          },
        ]
      : []),
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  ];
  return events.map((event) =>
    encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
  );
}

async function completeProfileFixture(input: {
  readonly chunks: readonly Uint8Array[];
  readonly compatibility?: Parameters<
    typeof createAnthropicProvider
  >[0]['compatibility'];
}) {
  const transport = createFixtureTransportDriver();
  transport.enqueue({ status: 200, bodyChunks: input.chunks });
  const ai = createAi({
    transport,
    networkPolicy: createAllowlistNetworkPolicy({
      origins: ['https://api.anthropic.com'],
    }),
    credentialOverridePolicy: { allow: () => true },
  });
  const provider = createAnthropicProvider({
    compatibility: input.compatibility,
  });
  ai.providers.register(provider);
  const credentialOverride = {
    type: 'api_key' as const,
    secret: secret('profile-fixture-key'),
    scheme: '',
  };
  const model = await ai.models.require(
    {
      providerInstanceId: provider.id,
      modelId: 'claude-sonnet-4-5',
      protocol: 'anthropic-messages',
    },
    {},
    { credentialOverride },
  );
  return ai.complete(
    model,
    { messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }] },
    { credentialOverride, maxOutputTokens: 32 },
  );
}

describe('Anthropic Messages replay and cache usage compatibility', () => {
  it('rejects unsigned thinking by default and allows it only when configured', async () => {
    await expect(
      completeProfileFixture({
        chunks: await fixture('thinking-unsigned.sse'),
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'ANTHROPIC_INVALID_EVENT' },
    });

    const allowed = await completeProfileFixture({
      chunks: await fixture('thinking-unsigned.sse'),
      compatibility: { allowEmptySignature: true },
    });
    expect(allowed).toMatchObject({
      status: 'completed',
      content: [{ type: 'reasoning', text: 'considering' }],
    });
    expect(allowed.content[0]).not.toHaveProperty('replay');
  });

  it('preserves total-only cache creation without fabricating retention buckets', async () => {
    await expect(
      completeProfileFixture({
        chunks: thinkingStream({
          signature: 'signed',
          usage: {
            input_tokens: 10,
            output_tokens: 0,
            cache_creation_input_tokens: 300,
          },
        }),
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      usage: { cacheWriteTokens: 300 },
    });
    const result = await completeProfileFixture({
      chunks: thinkingStream({
        signature: 'signed',
        usage: {
          input_tokens: 10,
          output_tokens: 0,
          cache_creation_input_tokens: 300,
        },
      }),
    });
    expect(result.usage?.cacheWriteTokensByRetention).toBeUndefined();
  });

  it('keeps one-hour cache writes separate from the standard bucket', async () => {
    const result = await completeProfileFixture({
      chunks: await fixture('cache-one-hour.sse'),
    });

    expect(result).toMatchObject({
      status: 'completed',
      usage: {
        cacheWriteTokens: 200,
        cacheWriteTokensByRetention: { one_hour: 200 },
      },
    });
    expect(result.usage?.cacheWriteTokensByRetention?.standard).toBeUndefined();
  });
});
