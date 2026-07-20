import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { secret } from '../../auth/secret-value.js';
import { createAi } from '../../index.js';
import { doubaoProvider } from '../../providers/doubao/index.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';
import { arkResponsesContract, arkResponsesReplayCodecs } from './index.js';

const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('ark-key'),
  scheme: 'Bearer',
};

async function fixture(name: string): Promise<Uint8Array[]> {
  return [
    await readFile(
      new URL(`../../../test/fixtures/doubao/text/${name}`, import.meta.url),
    ),
  ];
}

describe('Ark Responses protocol', () => {
  it('exports a fixed v3 contract without caller extension fields', () => {
    expect(arkResponsesContract).toEqual({
      protocol: 'ark-responses',
      wireVersion: 'ark-v3',
      thinkingField: 'thinking.type',
      supportsPreviousResponseId: true,
      supportsFunctionTools: true,
      terminalOwner: 'runtime',
    });
    expect(arkResponsesReplayCodecs).toEqual([
      { id: 'ark-response-id', version: 1 },
    ]);
  });

  it('binds endpoint IDs only in the body and maps Ark reasoning events', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://ark.cn-beijing.volces.com/api/v3/responses',
        headers: {
          authorization: 'Bearer ark-key',
          'content-type': 'application/json',
        },
        jsonBody: {
          model: 'ep-20260720',
          input: [
            {
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Earlier' }],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: 'Continue' }],
            },
          ],
          max_output_tokens: 128,
          stream: true,
          tools: [
            {
              type: 'function',
              name: 'lookup',
              description: 'Lookup an item',
              parameters: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
              },
            },
          ],
          previous_response_id: 'resp_previous',
          thinking: { type: 'enabled' },
        },
      },
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyChunks: await fixture('ark-thinking-tool.sse'),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://ark.cn-beijing.volces.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(
      doubaoProvider({
        additionalModels: [
          {
            id: 'endpoint-thinking',
            name: 'Endpoint Thinking',
            upstream: { type: 'endpoint', endpointId: 'ep-20260720' },
            protocol: 'ark-responses',
            protocolProfileId: 'doubao-ark-responses-v3',
            requestDefaults: { reasoning: 'medium' },
          },
        ],
      }),
    );
    const model = await ai.models.require(
      {
        providerInstanceId: 'doubao',
        modelId: 'endpoint-thinking',
        protocol: 'ark-responses',
      },
      {},
      { credentialOverride },
    );
    const response = await ai.complete(
      model,
      {
        messages: [
          {
            role: 'assistant',
            responseId: 'resp_previous',
            content: [{ type: 'text', text: 'Earlier' }],
          },
          { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
        ],
        tools: [
          {
            name: 'lookup',
            description: 'Lookup an item',
            inputSchema: {
              type: 'object',
              properties: { id: { type: 'string' } },
              required: ['id'],
            },
          },
        ],
      },
      { credentialOverride, maxOutputTokens: 128 },
    );
    expect(response).toMatchObject({
      status: 'completed',
      finishReason: 'tool_calls',
      responseId: 'resp_ark_1',
      content: [
        { type: 'reasoning', text: '先检查。' },
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'lookup',
          status: 'complete',
          arguments: { id: '42' },
        },
      ],
      replay: {
        scope: 'same-model',
        protocolId: 'ark-responses',
        codecId: 'ark-response-id',
        data: { responseId: 'resp_ark_1' },
      },
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        reasoningTokens: 2,
        totalTokens: 18,
      },
    });
    expect(JSON.stringify(transport.requests())).not.toContain('ep-20260720');
  });

  it('rejects arbitrary Ark options instead of passing built-in tools through', async () => {
    const ai = createAi({
      transport: createFixtureTransportDriver(),
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://ark.cn-beijing.volces.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(
      doubaoProvider({
        additionalModels: [
          {
            id: 'native',
            upstream: { type: 'model', modelId: 'doubao-native' },
            protocol: 'ark-responses',
            protocolProfileId: 'doubao-ark-responses-v3',
          },
        ],
      }),
    );
    const model = await ai.models.require(
      {
        providerInstanceId: 'doubao',
        modelId: 'native',
        protocol: 'ark-responses',
      },
      {},
      { credentialOverride },
    );
    const response = await ai.complete(
      model,
      { messages: [] },
      {
        credentialOverride,
        protocolOptions: { builtin_tools: [{ type: 'web_search' }] },
      },
    );
    expect(response).toMatchObject({
      status: 'failed',
      error: { code: 'ARK_PROTOCOL_OPTIONS_UNSUPPORTED' },
    });
  });
});
