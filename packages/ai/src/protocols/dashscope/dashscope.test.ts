import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { secret } from '../../auth/secret-value.js';
import { createAi } from '../../index.js';
import { qwenProvider } from '../../providers/qwen/index.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';
import { dashScopeContract, dashScopeReplayCodecs } from './index.js';

async function fixture(path: string): Promise<Uint8Array[]> {
  const data = await readFile(
    new URL(`../../../test/fixtures/qwen/${path}`, import.meta.url),
  );
  return [Buffer.concat([data, Buffer.from('\n')])];
}

const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('dashscope-key'),
  scheme: 'Bearer',
};

describe('DashScope native protocol', () => {
  it('exports the native contract and replay inventory', () => {
    expect(dashScopeContract).toEqual({
      protocol: 'dashscope',
      route: 'curated-native-route',
      streaming: true,
      terminalOwner: 'runtime',
    });
    expect(dashScopeReplayCodecs).toEqual([
      { id: 'dashscope-request-id', version: 1 },
    ]);
  });

  it('maps text, tools, thinking, usage, and ignores caller route injection', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
        headers: {
          authorization: 'Bearer dashscope-key',
          'content-type': 'application/json',
          'x-dashscope-sse': 'enable',
        },
        jsonBody: {
          model: 'qwen-plus',
          input: {
            messages: [
              { role: 'system', content: 'Be concise.' },
              { role: 'user', content: 'Weather?' },
            ],
          },
          parameters: {
            result_format: 'message',
            incremental_output: true,
            max_tokens: 256,
            enable_thinking: true,
            temperature: 0.7,
            top_p: 0.8,
            tools: [
              {
                type: 'function',
                function: {
                  name: 'weather',
                  description: 'Get weather',
                  parameters: {
                    type: 'object',
                    properties: { city: { type: 'string' } },
                    required: ['city'],
                  },
                },
              },
            ],
            tool_choice: 'required',
          },
        },
      },
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyChunks: await fixture('text/native-thinking-tool.sse'),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://dashscope.aliyuncs.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(
      qwenProvider({ region: 'cn-beijing', protocolPreference: 'dashscope' }),
    );
    const model = await ai.models.require(
      {
        providerInstanceId: 'qwen',
        modelId: 'qwen-plus',
        protocol: 'dashscope',
      },
      {},
      { credentialOverride },
    );
    const response = await ai.complete(
      model,
      {
        systemPrompt: 'Be concise.',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Weather?' }] },
        ],
        tools: [
          {
            name: 'weather',
            description: 'Get weather',
            inputSchema: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        ],
      },
      {
        credentialOverride,
        maxOutputTokens: 256,
        temperature: 0.7,
        topP: 0.8,
        toolChoice: 'required',
        protocolOptions: {
          enableThinking: true,
          route: '/services/aigc/evil',
        },
      },
    );
    expect(response).toMatchObject({
      status: 'completed',
      finishReason: 'tool_calls',
      responseId: 'req-qwen',
      content: [
        { type: 'reasoning', text: 'plan' },
        { type: 'text', text: 'Answer done' },
        {
          type: 'tool_call',
          id: 'call_weather',
          name: 'weather',
          status: 'complete',
          arguments: { city: 'Paris' },
        },
      ],
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      replay: {
        protocolId: 'dashscope',
        codecId: 'dashscope-request-id',
        data: { requestId: 'req-qwen' },
      },
    });
  });

  it('honors request protocol tool choice ahead of common defaults', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
        jsonBody: {
          model: 'qwen-plus',
          input: { messages: [{ role: 'user', content: 'Weather?' }] },
          parameters: {
            result_format: 'message',
            incremental_output: true,
            max_tokens: 64,
            tools: [
              {
                type: 'function',
                function: {
                  name: 'weather',
                  parameters: { type: 'object' },
                },
              },
            ],
            tool_choice: 'none',
          },
        },
      },
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyChunks: await fixture('text/native-thinking-tool.sse'),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://dashscope.aliyuncs.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(
      qwenProvider({ region: 'cn-beijing', protocolPreference: 'dashscope' }),
    );
    const model = await ai.models.require(
      {
        providerInstanceId: 'qwen',
        modelId: 'qwen-plus',
        protocol: 'dashscope',
      },
      {},
      { credentialOverride },
    );

    const response = await ai.complete(
      model,
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Weather?' }] },
        ],
        tools: [
          {
            name: 'weather',
            inputSchema: { type: 'object' },
          },
        ],
      },
      {
        credentialOverride,
        maxOutputTokens: 64,
        protocolOptions: { toolChoice: 'none' },
      },
    );

    expect(response.status).toBe('completed');
    await ai.dispose();
  });

  it('maps multimodal input and array output on the curated native route', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        jsonBody: {
          model: 'qwen-vl-max',
          input: {
            messages: [
              {
                role: 'user',
                content: [
                  { image: 'https://assets.example/cat.png' },
                  { text: 'Describe it.' },
                ],
              },
            ],
          },
          parameters: {
            result_format: 'message',
            incremental_output: true,
            max_tokens: 128,
          },
        },
      },
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyChunks: await fixture('multimodal/native-multimodal.sse'),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://dashscope.aliyuncs.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(qwenProvider({ region: 'cn-beijing' }));
    const model = await ai.models.require(
      {
        providerInstanceId: 'qwen',
        modelId: 'qwen-vl-max',
        protocol: 'dashscope',
      },
      {},
      { credentialOverride },
    );
    const response = await ai.complete(
      model,
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                mediaType: 'image/png',
                source: { type: 'url', url: 'https://assets.example/cat.png' },
              },
              { type: 'text', text: 'Describe it.' },
            ],
          },
        ],
      },
      { credentialOverride, maxOutputTokens: 128 },
    );
    expect(response).toMatchObject({
      status: 'completed',
      finishReason: 'stop',
      responseId: 'req-qwen-vl',
      content: [{ type: 'text', text: 'A cat' }],
      usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11 },
    });
  });

  it('normalizes provider errors and aborts', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      status: 400,
      headers: { 'content-type': 'application/json' },
      bodyChunks: await fixture('errors/invalid-request.json'),
    });
    transport.enqueue({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyChunks: [new TextEncoder().encode('data: {}\n\n')],
      chunkDelayMs: 50,
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://dashscope.aliyuncs.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(
      qwenProvider({ region: 'cn-beijing', protocolPreference: 'dashscope' }),
    );
    const model = await ai.models.require(
      {
        providerInstanceId: 'qwen',
        modelId: 'qwen-plus',
        protocol: 'dashscope',
      },
      {},
      { credentialOverride },
    );
    await expect(
      ai.complete(model, { messages: [] }, { credentialOverride }),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'DASHSCOPE_HTTP_400', category: 'invalid_request' },
    });

    const controller = new AbortController();
    const pending = ai.complete(
      model,
      { messages: [] },
      { credentialOverride, signal: controller.signal },
    );
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      status: 'cancelled',
      error: { category: 'cancelled' },
    });
  });
});
