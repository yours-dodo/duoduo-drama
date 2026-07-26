import { describe, expect, it } from 'vitest';

import { createAi, secret } from '../../index.js';
import { createAnthropicProvider } from '../../providers/anthropic/index.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';

const encoder = new TextEncoder();

function anthropicSse(
  ...events: readonly Readonly<{ type: string; [key: string]: unknown }>[]
): Uint8Array[] {
  return events.map((event) =>
    encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
  );
}

describe('Anthropic Messages tracer', () => {
  it('streams system and user text through the bound Messages transport', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'x-api-key': 'anthropic-secret-canary',
        },
        jsonBody: {
          model: 'claude-sonnet-4-5',
          system: [
            {
              type: 'text',
              text: 'Be concise.',
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Hello' }],
            },
          ],
          max_tokens: 64,
          stream: true,
        },
      },
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyChunks: anthropicSse(
        {
          type: 'message_start',
          message: {
            id: 'msg_123',
            model: 'claude-sonnet-4-5-20260701',
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello from Anthropic' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 5 },
        },
        { type: 'message_stop' },
      ),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://api.anthropic.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    const provider = createAnthropicProvider({
      models: [{ id: 'claude-sonnet-4-5' }],
    });
    ai.providers.register(provider);
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('anthropic-secret-canary'),
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

    const response = await ai.complete(
      model,
      {
        systemPrompt: 'Be concise.',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        ],
      },
      { credentialOverride, maxOutputTokens: 64 },
    );

    expect(response).toMatchObject({
      status: 'completed',
      finishReason: 'stop',
      responseId: 'msg_123',
      responseModel: {
        providerInstanceId: provider.id,
        modelId: 'claude-sonnet-4-5-20260701',
        protocol: 'anthropic-messages',
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      content: [{ type: 'text', text: 'Hello from Anthropic' }],
    });
  });

  it('maps multimodal tool turns and streams signed thinking, tool input, and one-hour cache usage', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'x-api-key': 'anthropic-rich-key',
        },
        jsonBody: {
          model: 'claude-sonnet-4-5',
          system: [
            {
              type: 'text',
              text: 'Inspect the image.',
              cache_control: { type: 'ephemeral', ttl: '1h' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What is here?' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'aW1hZ2U=',
                  },
                },
              ],
            },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'tool_previous',
                  name: 'inspect',
                  input: { region: 'center' },
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'tool_previous',
                  content: [{ type: 'text', text: 'A red door' }],
                  is_error: false,
                },
              ],
            },
          ],
          tools: [
            {
              name: 'inspect',
              description: 'Inspect a region',
              input_schema: {
                type: 'object',
                properties: { region: { type: 'string' } },
                required: ['region'],
              },
              cache_control: { type: 'ephemeral', ttl: '1h' },
            },
          ],
          thinking: { type: 'enabled', budget_tokens: 1024 },
          max_tokens: 2048,
          stream: true,
        },
      },
      status: 200,
      bodyChunks: anthropicSse(
        {
          type: 'message_start',
          message: {
            id: 'msg_rich',
            model: 'claude-sonnet-4-5-20260701',
            usage: {
              input_tokens: 2,
              output_tokens: 0,
              cache_read_input_tokens: 3,
              cache_creation_input_tokens: 4,
              cache_creation: {
                ephemeral_1h_input_tokens: 4,
                ephemeral_5m_input_tokens: 0,
              },
            },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Need a closer look.' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'signed-thinking' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'tool_use',
            id: 'tool_123',
            name: 'inspect',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"region":"left"}',
          },
        },
        { type: 'content_block_stop', index: 1 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 5 },
        },
        { type: 'message_stop' },
      ),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://api.anthropic.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    const provider = createAnthropicProvider({
      models: [{ id: 'claude-sonnet-4-5' }],
    });
    ai.providers.register(provider);
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('anthropic-rich-key'),
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

    const response = await ai.complete(
      model,
      {
        systemPrompt: 'Inspect the image.',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is here?' },
              {
                type: 'image',
                mediaType: 'image/png',
                source: { type: 'base64', data: 'aW1hZ2U=' },
              },
            ],
          },
          {
            role: 'assistant',
            model: {
              providerInstanceId: provider.id,
              modelId: 'claude-sonnet-4-5',
              protocol: 'anthropic-messages',
            },
            status: 'completed',
            finishReason: 'tool_calls',
            partial: false,
            content: [
              {
                type: 'tool_call',
                id: 'tool_previous',
                name: 'inspect',
                status: 'complete',
                rawArguments: '{"region":"center"}',
                arguments: { region: 'center' },
              },
            ],
          },
          {
            role: 'tool_result',
            toolCallId: 'tool_previous',
            toolName: 'inspect',
            isError: false,
            content: [{ type: 'text', text: 'A red door' }],
          },
        ],
        tools: [
          {
            name: 'inspect',
            description: 'Inspect a region',
            inputSchema: {
              type: 'object',
              properties: { region: { type: 'string' } },
              required: ['region'],
            },
          },
        ],
      },
      {
        credentialOverride,
        maxOutputTokens: 2048,
        cacheRetention: 'long',
        protocolOptions: {
          thinking: { type: 'enabled', budgetTokens: 1024 },
        },
      },
    );

    expect(response).toMatchObject({
      status: 'completed',
      finishReason: 'tool_calls',
      responseId: 'msg_rich',
      usage: {
        inputTokens: 2,
        outputTokens: 5,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        cacheWriteTokensByRetention: { one_hour: 4 },
        totalTokens: 14,
      },
      content: [
        {
          type: 'reasoning',
          text: 'Need a closer look.',
          replay: {
            version: 1,
            scope: 'same-model',
            protocolId: 'anthropic-messages',
            codecId: 'anthropic-signature',
            codecVersion: 1,
            data: { signature: 'signed-thinking' },
          },
        },
        {
          type: 'tool_call',
          id: 'tool_123',
          name: 'inspect',
          status: 'complete',
          rawArguments: '{"region":"left"}',
          arguments: { region: 'left' },
        },
      ],
    });
  });

  it('round-trips adaptive thinking with redacted replay data', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'anthropic-version': '2023-06-01',
          authorization: 'Bearer oauth-access-token',
          'content-type': 'application/json',
        },
        jsonBody: {
          model: 'claude-opus-4-1',
          messages: [
            {
              role: 'assistant',
              content: [
                { type: 'redacted_thinking', data: 'redacted-replay-data' },
                { type: 'text', text: 'Prior answer' },
              ],
            },
            {
              role: 'user',
              content: [{ type: 'text', text: 'Continue' }],
            },
          ],
          thinking: { type: 'adaptive' },
          max_tokens: 64,
          stream: true,
        },
      },
      status: 200,
      bodyChunks: anthropicSse(
        {
          type: 'message_start',
          message: {
            id: 'msg_redacted',
            model: 'claude-opus-4-1',
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'redacted_thinking',
            data: 'next-redacted-data',
          },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 1 },
        },
        { type: 'message_stop' },
      ),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://api.anthropic.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    const provider = createAnthropicProvider({
      models: [{ id: 'claude-opus-4-1' }],
    });
    ai.providers.register(provider);
    const credentialOverride = {
      type: 'bearer_token' as const,
      secret: secret('oauth-access-token'),
      scheme: 'Bearer',
    };
    const model = await ai.models.require(
      {
        providerInstanceId: provider.id,
        modelId: 'claude-opus-4-1',
        protocol: 'anthropic-messages',
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
            model: {
              providerInstanceId: provider.id,
              modelId: 'claude-opus-4-1',
              protocol: 'anthropic-messages',
            },
            status: 'completed',
            finishReason: 'stop',
            partial: false,
            content: [
              {
                type: 'reasoning',
                replay: {
                  version: 1,
                  scope: 'same-model',
                  protocolId: 'anthropic-messages',
                  codecId: 'anthropic-redacted-thinking',
                  codecVersion: 1,
                  data: { redactedData: 'redacted-replay-data' },
                },
              },
              { type: 'text', text: 'Prior answer' },
            ],
          },
          { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
        ],
      },
      {
        credentialOverride,
        maxOutputTokens: 64,
        protocolOptions: { thinking: { type: 'adaptive' } },
      },
    );

    expect(response).toMatchObject({
      status: 'completed',
      content: [
        {
          type: 'reasoning',
          replay: {
            protocolId: 'anthropic-messages',
            codecId: 'anthropic-redacted-thinking',
            data: { redactedData: 'next-redacted-data' },
          },
        },
      ],
    });
  });
});
