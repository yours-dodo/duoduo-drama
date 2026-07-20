import { describe, expect, it } from 'vitest';
import type { ChatRequest, ProtocolContentEvent } from '../../core/events.js';
import type { ModelDefinition } from '../../core/models.js';
import type { RequestTransport } from '../../transport/types.js';
import { createPiMessagesAdapter } from './index.js';
const encoder = new TextEncoder();
function model(): ModelDefinition<'pi-messages'> {
  return {
    id: 'pi-model',
    upstreamModelId: 'pi-upstream',
    name: 'PI',
    providerInstanceId: 'radius',
    protocol: 'pi-messages',
    protocolProfileId: 'radius-default',
    capabilities: {
      input: ['text'],
      streaming: true,
      reasoning: true,
      toolCalling: true,
      parallelToolCalls: true,
      deferredTools: false,
      thinkingLevels: ['none', 'high'],
    },
    limits: { contextTokens: 1000, maxOutputTokens: 100 },
    pricing: {
      currency: 'USD',
      unit: 'per_million_tokens',
      rates: { input: 1, output: 2 },
    },
  };
}
function makeRequest(
  transport: RequestTransport,
  signal = new AbortController().signal,
): ChatRequest<'pi-messages'> {
  return {
    model: model(),
    context: {
      systemPrompt: 'system',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: [{ name: 'lookup', inputSchema: { type: 'object' } }],
    },
    options: {
      signal,
      maxOutputTokens: 50,
      stop: ['END'],
      timeoutMs: 1000,
      retry: false,
      protocolOptions: { debug: true },
    },
    signal,
    transport,
    session: {
      id: 's',
      identity: 'i',
      acquire: async () => ({ resource: undefined, release: async () => {} }),
    },
  };
}
function stream(events: readonly Record<string, unknown>[]) {
  return (async function* () {
    for (const event of events)
      yield encoder.encode(
        `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`,
      );
  })();
}

describe('PI Messages protocol', () => {
  it('uses the exact envelope and streams text, reasoning, tools, signatures, diagnostics, and usage', async () => {
    let seen: Parameters<RequestTransport['send']>[0] | undefined;
    const transport: RequestTransport = {
      send: async (input) => {
        seen = input;
        return {
          status: 200,
          headers: {},
          body: stream([
            { type: 'start', responseId: 'pi_resp', model: 'pi-result' },
            { type: 'thinking_start', itemId: 'r1', index: 0 },
            { type: 'thinking_delta', itemId: 'r1', delta: 'think' },
            { type: 'thinking_end', itemId: 'r1', signature: 'sig-r' },
            { type: 'text_start', itemId: 't1', index: 1 },
            { type: 'text_delta', itemId: 't1', delta: 'answer' },
            { type: 'text_end', itemId: 't1', signature: { key: 'sig-t' } },
            {
              type: 'toolcall_start',
              itemId: 'tool1',
              index: 2,
              toolCallId: 'call1',
              name: 'lookup',
            },
            { type: 'toolcall_delta', itemId: 'tool1', delta: '{"q":"x"}' },
            { type: 'toolcall_end', itemId: 'tool1', signature: 'sig-tool' },
            {
              type: 'rewrite',
              code: 'PI_REWRITE_TEST',
              message: 'rewritten',
              severity: 'warning',
            },
            {
              type: 'done',
              responseId: 'pi_resp',
              model: 'pi-result',
              finishReason: 'tool_calls',
              usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
            },
          ]),
        };
      },
    };
    const events: ProtocolContentEvent[] = [];
    const terminal = await createPiMessagesAdapter({ contextVersion: 2 })(
      makeRequest(transport),
      { publish: async (event) => void events.push(event) },
    );
    expect(seen?.headers).toMatchObject({ 'x-pi-debug': '1' });
    expect(JSON.parse(String(seen?.body))).toEqual({
      model: 'pi-upstream',
      context: {
        version: 2,
        systemPrompt: 'system',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        ],
        tools: [{ name: 'lookup', inputSchema: { type: 'object' } }],
      },
      options: { maxTokens: 50, stop: ['END'], stream: true, debug: true },
    });
    expect(events.map((event) => event.type)).toEqual([
      'reasoning_start',
      'reasoning_delta',
      'reasoning_end',
      'text_start',
      'text_delta',
      'text_end',
      'tool_call_start',
      'tool_call_delta',
      'tool_call_end',
    ]);
    expect(events.at(-1)).toMatchObject({
      toolCall: {
        id: 'call1',
        name: 'lookup',
        arguments: { q: 'x' },
        replay: { protocolId: 'pi-messages' },
      },
    });
    expect(terminal).toMatchObject({
      status: 'completed',
      finishReason: 'tool_calls',
      responseId: 'pi_resp',
      responseModelId: 'pi-result',
      usage: { totalTokens: 10 },
      diagnostics: [{ code: 'PI_REWRITE_TEST', severity: 'warning' }],
      replay: {
        data: { r1: 'sig-r', t1: { key: 'sig-t' }, tool1: 'sig-tool' },
      },
    });
  });

  it('returns typed provider and cancellation terminals', async () => {
    const providerError = await createPiMessagesAdapter()(
      makeRequest({
        send: async () => ({
          status: 200,
          headers: {},
          body: stream([
            {
              type: 'error',
              code: 'OVERLOADED',
              message: 'busy',
              retryable: true,
            },
          ]),
        }),
      }),
      { publish: async () => {} },
    );
    expect(providerError).toMatchObject({
      status: 'failed',
      error: { code: 'OVERLOADED', retryable: true },
    });
    const controller = new AbortController();
    controller.abort();
    const cancelled = await createPiMessagesAdapter()(
      makeRequest(
        {
          send: async () => {
            throw new DOMException('Aborted', 'AbortError');
          },
        },
        controller.signal,
      ),
      { publish: async () => {} },
    );
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      error: { category: 'cancelled' },
    });
  });
});
