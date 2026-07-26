import { describe, expect, it } from 'vitest';

import { createAi, secret } from '../../index.js';
import { createOpenAiProvider } from '../../providers/openai/index.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';
import { createFixtureTransportDriver } from '../../testing.js';

const encoder = new TextEncoder();

function sse(...events: readonly unknown[]): Uint8Array[] {
  return events.map((event) =>
    encoder.encode(
      `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`,
    ),
  );
}

describe('OpenAI Responses tracer', () => {
  it('streams text and returns usage, cost, and response identity through a bound transport', async () => {
    const apiKey = 'sk-secret-canary-never-record';
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret(apiKey),
    };
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://api.openai.com/v1/responses',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        jsonBody: {
          model: 'gpt-4.1-mini',
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: 'Hello' }],
            },
          ],
          max_output_tokens: 64,
          stream: true,
        },
      },
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyChunks: sse(
        {
          type: 'response.created',
          sequence_number: 0,
          response: { id: 'resp_123', model: 'gpt-4.1-mini' },
        },
        {
          type: 'response.output_item.added',
          sequence_number: 1,
          output_index: 0,
          item: { id: 'msg_123', type: 'message', role: 'assistant' },
        },
        {
          type: 'response.content_part.added',
          sequence_number: 2,
          item_id: 'msg_123',
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', text: '' },
        },
        {
          type: 'response.output_text.delta',
          sequence_number: 3,
          item_id: 'msg_123',
          output_index: 0,
          content_index: 0,
          delta: 'Hello from OpenAI',
        },
        {
          type: 'response.output_text.done',
          sequence_number: 4,
          item_id: 'msg_123',
          output_index: 0,
          content_index: 0,
          text: 'Hello from OpenAI',
        },
        {
          type: 'response.completed',
          sequence_number: 5,
          response: {
            id: 'resp_123',
            model: 'gpt-4.1-mini-2026-01-01',
            status: 'completed',
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
              output_tokens_details: { reasoning_tokens: 2 },
            },
          },
        },
      ),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://api.openai.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    const provider = createOpenAiProvider({
      models: [
        {
          id: 'gpt-4.1-mini',
          pricing: {
            currency: 'USD',
            unit: 'per_million_tokens',
            rates: { input: 2, output: 8, reasoning: 8 },
          },
        },
      ],
    });
    ai.providers.register(provider);
    const model = await ai.models.require(
      {
        providerInstanceId: provider.id,
        modelId: 'gpt-4.1-mini',
        protocol: 'openai-responses',
      },
      {},
      { credentialOverride },
    );

    const response = await ai.complete(
      model,
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        ],
      },
      { credentialOverride, maxOutputTokens: 64 },
    );

    expect(response).toMatchObject({
      status: 'completed',
      finishReason: 'stop',
      responseId: 'resp_123',
      responseModel: {
        providerInstanceId: provider.id,
        modelId: 'gpt-4.1-mini-2026-01-01',
        protocol: 'openai-responses',
      },
      replay: {
        version: 1,
        scope: 'same-provider',
        protocolId: 'openai-responses',
        codecId: 'openai-response-id',
        codecVersion: 1,
        data: { responseId: 'resp_123' },
      },
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 2,
        totalTokens: 15,
      },
      cost: { currency: 'USD', total: 0.000076, source: 'computed' },
      content: [{ type: 'text', text: 'Hello from OpenAI' }],
    });
    expect(transport.requests()).toEqual([
      {
        method: 'POST',
        origin: 'https://api.openai.com',
        pathname: '/v1/responses',
        headerNames: ['authorization', 'content-type', 'idempotency-key'],
        bodyDigest: expect.any(String),
      },
    ]);
    expect(JSON.stringify(transport.requests())).not.toContain(apiKey);
    expect(JSON.stringify(model)).not.toContain(apiKey);
  });
});

describe('OpenAI Responses protocol events', () => {
  it('streams reasoning and a complete function call', async () => {
    const fixture = await makeFixture(
      sse(
        {
          type: 'response.output_item.added',
          sequence_number: 0,
          output_index: 0,
          item: { id: 'reasoning_1', type: 'reasoning' },
        },
        {
          type: 'response.reasoning_summary_text.delta',
          sequence_number: 1,
          item_id: 'reasoning_1',
          delta: 'Check the weather first.',
        },
        {
          type: 'response.reasoning_summary_text.done',
          sequence_number: 2,
          item_id: 'reasoning_1',
        },
        {
          type: 'response.output_item.added',
          sequence_number: 3,
          output_index: 1,
          item: {
            id: 'fc_1',
            type: 'function_call',
            call_id: 'call_1',
            name: 'weather',
          },
        },
        {
          type: 'response.function_call_arguments.delta',
          sequence_number: 4,
          item_id: 'fc_1',
          delta: '{"city":"Shang',
        },
        {
          type: 'response.function_call_arguments.delta',
          sequence_number: 5,
          item_id: 'fc_1',
          delta: 'hai"}',
        },
        {
          type: 'response.function_call_arguments.done',
          sequence_number: 6,
          item_id: 'fc_1',
          arguments: '{"city":"Shanghai"}',
        },
        {
          type: 'response.completed',
          sequence_number: 7,
          response: { id: 'resp_tool', model: 'gpt-4.1-mini', usage: {} },
        },
      ),
    );

    const response = await fixture.ai.complete(
      fixture.model,
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Weather?' }] },
        ],
        tools: [
          {
            name: 'weather',
            inputSchema: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        ],
      },
      { credentialOverride: fixture.credentialOverride },
    );

    expect(response).toMatchObject({
      status: 'completed',
      finishReason: 'tool_calls',
      content: [
        { type: 'reasoning', text: 'Check the weather first.' },
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'weather',
          status: 'complete',
          rawArguments: '{"city":"Shanghai"}',
          arguments: { city: 'Shanghai' },
        },
      ],
    });
  });

  it('parses SSE across UTF-8 and frame boundaries', async () => {
    const bytes = encoder.encode(
      `event: response.output_item.added\ndata: ${JSON.stringify({
        type: 'response.output_item.added',
        sequence_number: 0,
        output_index: 0,
        item: { id: 'msg_utf8', type: 'message', role: 'assistant' },
      })}\n\n` +
        `event: response.content_part.added\ndata: ${JSON.stringify({
          type: 'response.content_part.added',
          sequence_number: 1,
          item_id: 'msg_utf8',
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', text: '' },
        })}\n\n` +
        `event: response.output_text.delta\ndata: ${JSON.stringify({
          type: 'response.output_text.delta',
          sequence_number: 2,
          item_id: 'msg_utf8',
          output_index: 0,
          content_index: 0,
          delta: '你好',
        })}\n\n` +
        `event: response.output_text.done\ndata: ${JSON.stringify({
          type: 'response.output_text.done',
          sequence_number: 3,
          item_id: 'msg_utf8',
          output_index: 0,
          content_index: 0,
          text: '你好',
        })}\n\n` +
        `event: response.completed\ndata: ${JSON.stringify({
          type: 'response.completed',
          sequence_number: 4,
          response: { id: 'resp_utf8', model: 'gpt-4.1-mini', usage: {} },
        })}\n\n`,
    );
    const multibyte = bytes.findIndex((value) => value >= 0xe0);
    const chunks = [
      bytes.slice(0, multibyte + 1),
      bytes.slice(multibyte + 1, multibyte + 2),
      bytes.slice(multibyte + 2),
    ];
    const fixture = await makeFixture(chunks);

    const response = await fixture.ai.complete(
      fixture.model,
      { messages: [] },
      { credentialOverride: fixture.credentialOverride },
    );

    expect(response).toMatchObject({
      status: 'completed',
      content: [{ type: 'text', text: '你好' }],
    });
  });
});

describe('OpenAI Responses normalized failures', () => {
  it.each([
    {
      name: '401 authentication failure',
      status: 401,
      body: { error: { type: 'invalid_api_key' } },
      expected: {
        code: 'OPENAI_AUTH_FAILED',
        category: 'auth',
        retryable: false,
      },
    },
    {
      name: '429 rate limit',
      status: 429,
      body: { error: { type: 'rate_limit_error' } },
      expected: {
        code: 'OPENAI_RATE_LIMITED',
        category: 'rate_limit',
        retryable: true,
      },
    },
    {
      name: 'provider 5xx',
      status: 503,
      body: { error: { type: 'server_error' } },
      expected: {
        code: 'OPENAI_PROVIDER_ERROR',
        category: 'provider',
        retryable: true,
      },
    },
    {
      name: 'context overflow',
      status: 400,
      body: { error: { code: 'context_length_exceeded' } },
      expected: {
        code: 'CONTEXT_OVERFLOW',
        category: 'invalid_request',
        retryable: false,
      },
    },
  ])(
    'normalizes $name without exposing the upstream body',
    async ({ status, body, expected }) => {
      const canary = 'sk-error-body-canary';
      const fixture = await makeFixture(
        [encoder.encode(JSON.stringify({ ...body, canary }))],
        {
          status,
          contentType: 'application/json',
        },
      );

      const response = await fixture.ai.complete(
        fixture.model,
        { messages: [] },
        { credentialOverride: fixture.credentialOverride, retry: false },
      );

      expect(response).toMatchObject({ status: 'failed', error: expected });
      expect(response.error?.message).not.toContain(canary);
    },
  );

  it('rejects malformed SSE as an invalid response', async () => {
    const fixture = await makeFixture([
      encoder.encode('event: response.output_text.delta\ndata: {not-json}\n\n'),
    ]);

    const response = await fixture.ai.complete(
      fixture.model,
      { messages: [] },
      { credentialOverride: fixture.credentialOverride },
    );

    expect(response).toMatchObject({
      status: 'failed',
      error: { code: 'OPENAI_INVALID_SSE', category: 'invalid_response' },
    });
  });

  it('cancels while reading a delayed stream', async () => {
    const controller = new AbortController();
    const fixture = await makeFixture(
      sse({
        type: 'response.created',
        sequence_number: 0,
        response: { id: 'resp_abort', model: 'gpt-4.1-mini' },
      }),
      { chunkDelayMs: 100 },
    );
    const stream = fixture.ai.stream(
      fixture.model,
      { messages: [] },
      {
        credentialOverride: fixture.credentialOverride,
        signal: controller.signal,
      },
    );
    const result = stream.result();
    setTimeout(() => controller.abort(), 10);

    await expect(result).resolves.toMatchObject({
      status: 'cancelled',
      error: { code: 'REQUEST_CANCELLED', category: 'cancelled' },
    });
  });

  it('fails before dispatch when the stream override differs from the model handle', async () => {
    const fixture = await makeFixture(sse());

    const response = await fixture.ai.complete(
      fixture.model,
      { messages: [] },
      {
        credentialOverride: {
          type: 'api_key',
          secret: secret('sk-different-secret'),
        },
      },
    );

    expect(response).toMatchObject({
      status: 'failed',
      error: { code: 'CREDENTIAL_OVERRIDE_MISMATCH', category: 'auth' },
    });
    expect(fixture.transport.requests()).toEqual([]);
  });
});

function makeFixture(
  bodyChunks: readonly Uint8Array[],
  options: {
    status?: number;
    contentType?: string;
    chunkDelayMs?: number;
  } = {},
) {
  const credentialOverride = {
    type: 'api_key' as const,
    secret: secret('sk-fixture-only'),
  };
  const transport = createFixtureTransportDriver();
  transport.enqueue({
    status: options.status ?? 200,
    headers: { 'content-type': options.contentType ?? 'text/event-stream' },
    bodyChunks,
    chunkDelayMs: options.chunkDelayMs,
  });
  const ai = createAi({
    transport,
    networkPolicy: createAllowlistNetworkPolicy({
      origins: ['https://api.openai.com'],
    }),
    credentialOverridePolicy: { allow: () => true },
  });
  const provider = createOpenAiProvider();
  ai.providers.register(provider);
  return ai.models
    .require(
      {
        providerInstanceId: provider.id,
        modelId: 'gpt-4.1-mini',
        protocol: 'openai-responses',
      },
      {},
      { credentialOverride },
    )
    .then((model) => ({ ai, model, transport, credentialOverride }));
}
