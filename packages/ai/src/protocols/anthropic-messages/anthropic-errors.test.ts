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
const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('anthropic-error-key'),
  scheme: '',
};

async function completeFixture(input: {
  status?: number;
  chunks?: readonly Uint8Array[];
  signal?: AbortSignal;
  chunkDelayMs?: number;
}) {
  const transport = createFixtureTransportDriver();
  transport.enqueue({
    status: input.status ?? 200,
    headers: { 'content-type': 'text/event-stream' },
    bodyChunks: input.chunks ?? [],
    chunkDelayMs: input.chunkDelayMs,
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
    { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
    { credentialOverride, maxOutputTokens: 32, signal: input.signal },
  );
}

function sse(event: Record<string, unknown>): Uint8Array {
  return encoder.encode(
    `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

describe('Anthropic Messages failures', () => {
  it.each([
    [401, 'ANTHROPIC_AUTH_FAILED', 'auth', false],
    [429, 'ANTHROPIC_RATE_LIMITED', 'rate_limit', true],
    [500, 'ANTHROPIC_PROVIDER_ERROR', 'provider', true],
    [400, 'ANTHROPIC_INVALID_REQUEST', 'invalid_request', false],
  ] as const)(
    'maps HTTP %s without parsing a provider body',
    async (status, code, category, retryable) => {
      await expect(completeFixture({ status })).resolves.toMatchObject({
        status: 'failed',
        error: { code, category, retryable },
      });
    },
  );

  it('maps stream error events and incomplete streams', async () => {
    await expect(
      completeFixture({
        chunks: await fixture('overloaded-error.sse'),
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      error: {
        code: 'ANTHROPIC_PROVIDER_ERROR',
        category: 'provider',
        retryable: true,
      },
    });

    await expect(
      completeFixture({
        chunks: [
          sse({
            type: 'message_start',
            message: { id: 'msg_incomplete', usage: { input_tokens: 1 } },
          }),
        ],
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'ANTHROPIC_STREAM_INCOMPLETE' },
    });
  });

  it('returns a cancelled terminal when aborted during streaming', async () => {
    const controller = new AbortController();
    const pending = completeFixture({
      signal: controller.signal,
      chunkDelayMs: 25,
      chunks: [
        sse({
          type: 'message_start',
          message: { id: 'msg_abort', usage: { input_tokens: 1 } },
        }),
        sse({ type: 'message_stop' }),
      ],
    });
    setTimeout(() => controller.abort(), 5);

    await expect(pending).resolves.toMatchObject({
      status: 'cancelled',
      error: { code: 'REQUEST_CANCELLED', category: 'cancelled' },
    });
  });
});
