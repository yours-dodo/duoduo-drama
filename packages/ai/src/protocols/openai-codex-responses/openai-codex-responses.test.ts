import { describe, expect, it } from 'vitest';
import type { ChatRequest, ProtocolContentEvent } from '../../core/events.js';
import type { ModelDefinition } from '../../core/models.js';
import type { RequestTransport } from '../../transport/types.js';
import { createOpenAiCodexResponsesAdapter } from './index.js';

const encoder = new TextEncoder();

function model(): ModelDefinition<'openai-codex-responses'> {
  return {
    id: 'gpt-5-codex',
    upstreamModelId: 'gpt-5-codex',
    name: 'Codex',
    providerInstanceId: 'openai-codex:acct_123',
    protocol: 'openai-codex-responses',
    protocolProfileId: 'codex-default',
    capabilities: {
      input: ['text'],
      streaming: true,
      reasoning: true,
      toolCalling: true,
      parallelToolCalls: true,
      deferredTools: false,
      thinkingLevels: ['none', 'low', 'medium', 'high'],
    },
    limits: { contextTokens: 128_000, maxOutputTokens: 16_384 },
  };
}

function request(
  transport: RequestTransport,
  protocolOptions: Readonly<Record<string, unknown>>,
): ChatRequest<'openai-codex-responses'> {
  const signal = new AbortController().signal;
  return {
    model: model(),
    context: {
      messages: [
        {
          role: 'assistant',
          responseId: 'resp_previous',
          content: [{ type: 'text', text: 'earlier' }],
        },
        { role: 'user', content: [{ type: 'text', text: 'continue' }] },
      ],
    },
    options: {
      signal,
      maxOutputTokens: 128,
      stop: [],
      timeoutMs: 10_000,
      retry: false,
      sessionId: 'session_123',
      protocolOptions,
    },
    signal,
    transport,
    session: {
      id: 'session_123',
      identity: 'identity',
      acquire: async () => ({ resource: undefined, release: async () => {} }),
    },
  };
}

function sse(...events: readonly unknown[]) {
  return (async function* () {
    for (const event of events)
      yield encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  })();
}

describe('OpenAI Codex Responses protocol', () => {
  it('binds the Codex request profile, response id replay, and account affinity', async () => {
    let seen: Parameters<RequestTransport['send']>[0] | undefined;
    const transport: RequestTransport = {
      send: async (input) => {
        seen = input;
        return {
          status: 200,
          headers: {},
          body: sse(
            {
              type: 'response.created',
              response: { id: 'resp_new', model: 'gpt-5-codex' },
            },
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: { id: 'msg_1', type: 'message', role: 'assistant' },
            },
            {
              type: 'response.content_part.added',
              item_id: 'msg_1',
              output_index: 0,
              content_index: 0,
              part: { type: 'output_text', text: '' },
            },
            {
              type: 'response.output_text.delta',
              item_id: 'msg_1',
              output_index: 0,
              content_index: 0,
              delta: 'done',
            },
            {
              type: 'response.output_text.done',
              item_id: 'msg_1',
              output_index: 0,
              content_index: 0,
              text: 'done',
            },
            {
              type: 'response.completed',
              response: {
                id: 'resp_new',
                model: 'gpt-5-codex',
                usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
              },
            },
          ),
        };
      },
    };
    const published: ProtocolContentEvent[] = [];
    const terminal = await createOpenAiCodexResponsesAdapter()(
      request(transport, {
        reasoningSummary: 'detailed',
        serviceTier: 'priority',
        textVerbosity: 'low',
        transport: 'sse',
      }),
      { publish: async (event) => void published.push(event) },
    );

    expect(JSON.parse(String(seen?.body))).toMatchObject({
      model: 'gpt-5-codex',
      previous_response_id: 'resp_previous',
      reasoning: { summary: 'detailed' },
      service_tier: 'priority',
      text: { verbosity: 'low' },
    });
    expect(seen?.headers).toMatchObject({
      session_id: 'session_123',
      'chatgpt-account-id': 'acct_123',
      'openai-beta': 'responses=experimental',
    });
    expect(published.map((event) => event.type)).toEqual([
      'text_start',
      'text_delta',
      'text_end',
    ]);
    expect(terminal).toMatchObject({
      status: 'completed',
      responseId: 'resp_new',
      replay: {
        protocolId: 'openai-codex-responses',
        data: { responseId: 'resp_new' },
      },
    });
  });

  it('fails closed when an explicitly requested WebSocket transport is not bound', async () => {
    const terminal = await createOpenAiCodexResponsesAdapter()(
      request(
        {
          send: async () => {
            throw new Error('must not dispatch');
          },
        },
        { transport: 'websocket-cached' },
      ),
      { publish: async () => {} },
    );
    expect(terminal).toMatchObject({
      status: 'failed',
      error: { code: 'CODEX_WEBSOCKET_UNAVAILABLE', retryable: false },
    });
  });
});
