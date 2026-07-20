import { describe, expect, it } from 'vitest';
import type { ChatRequest, ProtocolContentEvent } from '../../core/events.js';
import type { ModelDefinition } from '../../core/models.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';
import type { RequestTransport } from '../../transport/types.js';
import {
  createOpenAiChatCompletionsAdapter,
  openAiChatCompletionsContract,
  openAiChatCompletionsReplayCodecs,
  type OpenAiChatThinkingFormat,
} from './index.js';

const encoder = new TextEncoder();

function model(): ModelDefinition<'openai-chat-completions'> {
  return {
    id: 'fixture-model',
    upstreamModelId: 'upstream-model',
    name: 'Fixture',
    providerInstanceId: 'fixture',
    protocol: 'openai-chat-completions',
    protocolProfileId: 'fixture-profile',
    capabilities: {
      input: ['text', 'image'],
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
  protocolOptions: Readonly<Record<string, unknown>> = {},
): ChatRequest<'openai-chat-completions'> {
  const signal = new AbortController().signal;
  return {
    model: model(),
    context: {
      systemPrompt: 'be precise',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: [
        {
          name: 'lookup',
          description: 'look something up',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    },
    options: {
      signal,
      maxOutputTokens: 512,
      stop: [],
      timeoutMs: 10_000,
      retry: false,
      protocolOptions,
    },
    signal,
    transport,
    session: {
      id: 'fixture-session',
      identity: 'fixture-identity',
      acquire: async () => ({
        resource: undefined,
        release: async () => {},
      }),
    },
  };
}

function fixtureTransport(
  events: readonly unknown[],
  inspect: (body: Record<string, unknown>) => void,
  status = 200,
): RequestTransport {
  return {
    send: async (input) => {
      inspect(JSON.parse(String(input.body)) as Record<string, unknown>);
      return {
        status,
        headers: {},
        body: (async function* () {
          for (const event of events)
            yield encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
          yield encoder.encode('data: [DONE]\n\n');
        })(),
      };
    },
  };
}

describe('OpenAI Chat Completions protocol', () => {
  it('exports its stable contract and reasoning replay codec', () => {
    expect(openAiChatCompletionsContract).toEqual({
      protocol: 'openai-chat-completions',
      route: 'chat/completions',
      streaming: true,
      terminalOwner: 'runtime',
    });
    expect(openAiChatCompletionsReplayCodecs).toEqual([
      { id: 'openai-chat-reasoning', version: 1 },
    ]);
  });

  it.each<readonly [OpenAiChatThinkingFormat, string]>([
    ['openai', 'reasoning_effort'],
    ['openrouter', 'reasoning'],
    ['deepseek', 'thinking'],
    ['together', 'reasoning'],
    ['zai', 'thinking'],
    ['qwen', 'enable_thinking'],
    ['chat-template', 'chat_template_kwargs'],
    ['qwen-chat-template', 'chat_template_kwargs'],
    ['string-thinking', 'thinking'],
    ['ant-ling', 'thinking'],
  ])('maps %s thinking into %s', async (thinkingFormat, expectedField) => {
    const adapter = createOpenAiChatCompletionsAdapter({
      compatibility: { thinkingFormat },
    });
    const terminal = await adapter(
      request(
        fixtureTransport(
          [
            {
              id: 'chatcmpl_fixture',
              model: 'upstream-result',
              choices: [
                { index: 0, delta: { content: 'ok' }, finish_reason: null },
              ],
            },
            {
              id: 'chatcmpl_fixture',
              model: 'upstream-result',
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 4,
                total_tokens: 14,
                completion_tokens_details: { reasoning_tokens: 2 },
                prompt_tokens_details: { cached_tokens: 3 },
              },
            },
          ],
          (body) => {
            expect(body).toHaveProperty(expectedField);
            expect(body).toMatchObject({
              model: 'upstream-model',
              max_tokens: 512,
              stream: true,
            });
          },
        ),
        { thinkingEnabled: true, reasoningEffort: 'high' },
      ),
      { publish: async () => {} },
    );

    expect(terminal).toMatchObject({
      status: 'completed',
      finishReason: 'stop',
      responseId: 'chatcmpl_fixture',
      responseModelId: 'upstream-result',
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        reasoningTokens: 2,
        cacheReadTokens: 3,
      },
    });
  });

  it('maps strict tools, named tool results, cache control, and session affinity', async () => {
    let seenHeaders: Readonly<Record<string, string>> | undefined;
    const transport: RequestTransport = {
      send: async (input) => {
        seenHeaders = input.headers;
        const body = JSON.parse(String(input.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          messages: [
            {
              role: 'developer',
              content: [
                {
                  type: 'text',
                  text: 'be precise',
                  cache_control: { type: 'ephemeral', ttl: '1h' },
                },
              ],
            },
            { role: 'assistant', content: '' },
            {
              role: 'tool',
              tool_call_id: 'call_lookup',
              name: 'lookup',
              content: 'done',
            },
            { role: 'assistant', content: '' },
          ],
          tools: [
            {
              type: 'function',
              function: expect.objectContaining({
                name: 'lookup',
                strict: true,
              }),
              cache_control: { type: 'ephemeral', ttl: '1h' },
            },
          ],
        });
        return {
          status: 200,
          headers: {},
          body: (async function* () {
            yield encoder.encode(
              'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            );
          })(),
        };
      },
    };
    const base = request(transport, {
      strict: true,
      cacheRetention: 'one_hour',
      thinkingEnabled: false,
    });
    const adapter = createOpenAiChatCompletionsAdapter({
      compatibility: {
        supportsDeveloperRole: true,
        supportsStrictMode: true,
        requiresToolResultName: true,
        requiresAssistantAfterToolResult: true,
        cacheControlFormat: 'anthropic',
        supportsLongCacheRetention: true,
        sendSessionAffinityHeaders: true,
        sessionAffinityFormat: 'openrouter',
      },
    });
    const terminal = await adapter(
      {
        ...base,
        context: {
          systemPrompt: 'be precise',
          messages: [
            {
              role: 'assistant',
              model: {
                providerInstanceId: 'fixture',
                modelId: 'fixture-model',
                protocol: 'openai-chat-completions',
              },
              status: 'completed',
              finishReason: 'tool_calls',
              partial: false,
              content: [],
            },
            {
              role: 'tool_result',
              toolCallId: 'call_lookup',
              toolName: 'lookup',
              isError: false,
              content: [{ type: 'text', text: 'done' }],
            },
          ],
          tools: base.context.tools,
        },
        options: { ...base.options, sessionId: 'session-fixture' },
      },
      { publish: async () => {} },
    );
    expect(terminal).toMatchObject({ status: 'completed' });
    expect(seenHeaders).toEqual({
      'x-openrouter-session': 'session-fixture',
    });
  });

  it('parses interleaved reasoning, text, and parallel tool JSON', async () => {
    const published: ProtocolContentEvent[] = [];
    const adapter = createOpenAiChatCompletionsAdapter({
      compatibility: { thinkingFormat: 'deepseek', zaiToolStream: true },
    });
    const terminal = await adapter(
      request(
        fixtureTransport(
          [
            {
              id: 'chatcmpl_tools',
              choices: [
                {
                  index: 0,
                  delta: {
                    reasoning_content: 'think',
                    content: 'answer',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_a',
                        function: { name: 'look', arguments: '{"q":' },
                      },
                      {
                        index: 1,
                        id: 'call_b',
                        function: { name: 'find', arguments: '{"x":1}' },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [{ index: 0, function: { arguments: '"a"}' } }],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            },
          ],
          () => {},
        ),
      ),
      {
        publish: async (event) => void published.push(event),
      } satisfies ProtocolEventSink,
    );

    expect(published.map((event) => event.type)).toEqual([
      'reasoning_start',
      'reasoning_delta',
      'text_start',
      'text_delta',
      'tool_call_start',
      'tool_call_delta',
      'tool_call_start',
      'tool_call_delta',
      'tool_call_delta',
      'reasoning_end',
      'text_end',
      'tool_call_end',
      'tool_call_end',
    ]);
    expect(published.at(-2)).toMatchObject({
      toolCall: { id: 'call_a', name: 'look', arguments: { q: 'a' } },
    });
    expect(terminal).toMatchObject({
      status: 'completed',
      finishReason: 'tool_calls',
    });
  });

  it('returns a typed provider error without leaking response content', async () => {
    const adapter = createOpenAiChatCompletionsAdapter();
    const terminal = await adapter(
      request(
        fixtureTransport(
          [{ error: { message: 'upstream secret canary', code: 'bad_key' } }],
          () => {},
          401,
        ),
      ),
      { publish: async () => {} },
    );
    expect(terminal).toMatchObject({
      status: 'failed',
      error: { code: 'OPENAI_CHAT_HTTP_401', category: 'auth' },
    });
    expect(JSON.stringify(terminal)).not.toContain('secret canary');
  });
});
