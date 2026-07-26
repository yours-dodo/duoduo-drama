import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import { createAwsAmbientAuth } from '../../auth/ambient/aws.js';
import { secret } from '../../auth/secret-value.js';
import { createAi } from '../../index.js';
import { createAmazonBedrockProvider } from '../../providers/amazon-bedrock/index.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';

async function fixture(): Promise<Uint8Array[]> {
  return [
    await readFile(
      new URL(
        '../../../test/fixtures/bedrock-converse-stream/reasoning-tool.jsonl',
        import.meta.url,
      ),
    ),
  ];
}

describe('Bedrock Converse Stream protocol', () => {
  it('maps bearer auth, reasoning, tools, cache points, metadata, and usage', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://bedrock-runtime.eu-central-1.amazonaws.com/model/eu.anthropic.claude-3-7-sonnet-20250219-v1%3A0/converse-stream',
        headers: { authorization: 'Bearer bedrock-token' },
        jsonBody: {
          messages: [
            {
              role: 'user',
              content: [{ text: 'weather?' }],
            },
          ],
          system: [
            { text: 'Be concise.' },
            { cachePoint: { type: 'default', ttl: '1h' } },
          ],
          inferenceConfig: { maxTokens: 512 },
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: 'weather',
                  description: 'Get weather',
                  inputSchema: {
                    json: {
                      type: 'object',
                      properties: { city: { type: 'string' } },
                    },
                  },
                },
              },
            ],
          },
          additionalModelRequestFields: {
            thinking: { type: 'enabled', budget_tokens: 1024 },
          },
          requestMetadata: { tenant: 'test' },
        },
      },
      status: 200,
      bodyChunks: await fixture(),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://bedrock-runtime.eu-central-1.amazonaws.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(
      createAmazonBedrockProvider({
        authMode: 'bearer',
        models: [{ id: 'eu.anthropic.claude-3-7-sonnet-20250219-v1:0' }],
      }),
    );
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('bedrock-token'),
      scheme: 'Bearer',
    };
    const model = await ai.models.require(
      {
        providerInstanceId: 'amazon-bedrock',
        modelId: 'eu.anthropic.claude-3-7-sonnet-20250219-v1:0',
      },
      {},
      { credentialOverride },
    );

    const response = await ai.complete(
      model,
      {
        systemPrompt: 'Be concise.',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
        ],
        tools: [
          {
            name: 'weather',
            description: 'Get weather',
            inputSchema: {
              type: 'object',
              properties: { city: { type: 'string' } },
            },
          },
        ],
      },
      {
        credentialOverride,
        maxOutputTokens: 512,
        cacheRetention: 'long',
        protocolOptions: {
          thinkingBudget: 1024,
          requestMetadata: { tenant: 'test' },
        },
      },
    );

    expect(response).toMatchObject({
      status: 'completed',
      finishReason: 'tool_calls',
      content: [
        {
          type: 'reasoning',
          text: 'think',
          replay: {
            protocolId: 'bedrock-converse-stream',
            codecId: 'bedrock-reasoning-signature',
            data: { signature: 'signed-reasoning' },
          },
        },
        { type: 'text', text: 'Calling tool' },
        {
          type: 'tool_call',
          id: 'tool-1',
          name: 'weather',
          arguments: { city: 'Paris' },
        },
      ],
      usage: {
        inputTokens: 20,
        outputTokens: 8,
        cacheReadTokens: 4,
        cacheWriteTokens: 2,
        totalTokens: 28,
      },
      diagnostics: [{ code: 'BEDROCK_LATENCY_MS', message: '42' }],
    });
  });

  it('replays same-model reasoning signatures and maps tool results', async () => {
    const modelId = 'anthropic.claude-3-7-sonnet-20250219-v1:0';
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        jsonBody: {
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  reasoningContent: {
                    reasoningText: {
                      text: 'prior thought',
                      signature: 'prior-signature',
                    },
                  },
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  toolResult: {
                    toolUseId: 'tool-1',
                    status: 'success',
                    content: [{ text: 'sunny' }],
                  },
                },
              ],
            },
          ],
          inferenceConfig: { maxTokens: 64 },
        },
      },
      status: 200,
      bodyChunks: await fixture(),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://bedrock-runtime.us-east-1.amazonaws.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(
      createAmazonBedrockProvider({
        authMode: 'bearer',
        models: [{ id: modelId }],
      }),
    );
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('bedrock-token'),
      scheme: 'Bearer',
    };
    const model = await ai.models.require(
      { providerInstanceId: 'amazon-bedrock', modelId },
      {},
      { credentialOverride },
    );

    await expect(
      ai.complete(
        model,
        {
          messages: [
            {
              role: 'assistant',
              model: {
                providerInstanceId: 'amazon-bedrock',
                modelId,
                protocol: 'bedrock-converse-stream',
              },
              status: 'completed',
              finishReason: 'tool_calls',
              partial: false,
              content: [
                {
                  type: 'reasoning',
                  text: 'prior thought',
                  replay: {
                    version: 1,
                    scope: 'same-model',
                    source: {
                      providerInstanceId: 'amazon-bedrock',
                      modelId,
                      protocol: 'bedrock-converse-stream',
                    },
                    protocolId: 'bedrock-converse-stream',
                    codecId: 'bedrock-reasoning-signature',
                    codecVersion: 1,
                    data: { signature: 'prior-signature' },
                  },
                },
              ],
            },
            {
              role: 'tool_result',
              toolCallId: 'tool-1',
              toolName: 'weather',
              isError: false,
              content: [{ type: 'text', text: 'sunny' }],
            },
          ],
        },
        { credentialOverride, maxOutputTokens: 64 },
      ),
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it.each([
    [401, 'BEDROCK_AUTH_FAILED'],
    [429, 'BEDROCK_RATE_LIMITED'],
    [500, 'BEDROCK_SERVER_ERROR'],
  ] as const)('maps HTTP %s failures to %s', async (status, code) => {
    const response = await completeBearerFixture({ status, bodyChunks: [] });
    expect(response).toMatchObject({ status: 'failed', error: { code } });
  });

  it('fails an incomplete stream without messageStop', async () => {
    const response = await completeBearerFixture({
      status: 200,
      bodyChunks: [
        new TextEncoder().encode(
          '{"type":"messageStart","role":"assistant"}\n',
        ),
      ],
    });
    expect(response).toMatchObject({
      status: 'failed',
      error: { code: 'BEDROCK_STREAM_INCOMPLETE' },
    });
  });

  it('returns cancellation when the response stream is aborted', async () => {
    const controller = new AbortController();
    const completion = completeBearerFixture(
      { status: 200, bodyChunks: await fixture(), chunkDelayMs: 30 },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 1);

    await expect(completion).resolves.toMatchObject({
      status: 'cancelled',
      finishReason: 'cancelled',
    });
  });

  it('signs the final AWS ambient request with the resolved region/profile', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({ status: 200, bodyChunks: await fixture() });
    const sign = vi.fn(async () => ({
      authorization: secret('aws-signature'),
      'x-amz-date': '20260719T000000Z',
    }));
    const ambientAuth = createAwsAmbientAuth({
      region: 'us-west-2',
      profile: 'production',
      principal: 'arn:aws:iam::123456789012:role/runtime',
      signer: { sign },
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://bedrock-runtime.us-west-2.amazonaws.com'],
      }),
      ambientAuthPolicy: { allow: () => true },
    });
    ai.providers.register(
      createAmazonBedrockProvider({
        authMode: 'aws',
        region: 'us-west-2',
        profile: 'production',
        ambientAuth,
      }),
    );
    const model = await ai.models.require(
      {
        providerInstanceId: 'amazon-bedrock',
        modelId: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
      },
      {},
    );

    await expect(ai.complete(model, { messages: [] })).resolves.toMatchObject({
      status: 'completed',
    });
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'us-west-2',
        profile: 'production',
        url: expect.objectContaining({
          pathname:
            '/model/anthropic.claude-3-7-sonnet-20250219-v1%3A0/converse-stream',
        }),
      }),
    );
  });
});

async function completeBearerFixture(
  response: Parameters<
    ReturnType<typeof createFixtureTransportDriver>['enqueue']
  >[0],
  signal?: AbortSignal,
) {
  const transport = createFixtureTransportDriver();
  transport.enqueue(response);
  const ai = createAi({
    transport,
    networkPolicy: createAllowlistNetworkPolicy({
      origins: ['https://bedrock-runtime.us-east-1.amazonaws.com'],
    }),
    credentialOverridePolicy: { allow: () => true },
  });
  ai.providers.register(createAmazonBedrockProvider({ authMode: 'bearer' }));
  const credentialOverride = {
    type: 'api_key' as const,
    secret: secret('bedrock-token'),
    scheme: 'Bearer',
  };
  const model = await ai.models.require(
    {
      providerInstanceId: 'amazon-bedrock',
      modelId: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
    },
    {},
    { credentialOverride },
  );
  return ai.complete(model, { messages: [] }, { credentialOverride, signal });
}
