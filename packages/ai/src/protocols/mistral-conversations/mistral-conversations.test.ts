import { describe, expect, it } from 'vitest';
import type { ChatRequest, ProtocolContentEvent } from '../../core/events.js';
import type { ModelDefinition } from '../../core/models.js';
import type { RequestTransport } from '../../transport/types.js';
import {
  createMistralConversationsAdapter,
  normalizeMistralToolCallId,
} from './index.js';

const encoder = new TextEncoder();
function model(): ModelDefinition<'mistral-conversations'> {
  return {
    id: 'mistral-large',
    upstreamModelId: 'mistral-large-latest',
    name: 'Mistral',
    providerInstanceId: 'mistral',
    protocol: 'mistral-conversations',
    protocolProfileId: 'mistral-default',
    capabilities: {
      input: ['text'],
      streaming: true,
      reasoning: true,
      toolCalling: true,
      parallelToolCalls: true,
      deferredTools: false,
      thinkingLevels: ['none', 'high'],
    },
    limits: { contextTokens: 128_000, maxOutputTokens: 16_384 },
  };
}
function request(
  transport: RequestTransport,
): ChatRequest<'mistral-conversations'> {
  const signal = new AbortController().signal;
  return {
    model: model(),
    context: {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'use tool' }] },
      ],
      tools: [{ name: 'lookup', inputSchema: { type: 'object' } }],
    },
    options: {
      signal,
      maxOutputTokens: 64,
      stop: [],
      timeoutMs: 10_000,
      retry: false,
      protocolOptions: { promptMode: 'reasoning', reasoningEffort: 'high' },
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

describe('Mistral Conversations protocol', () => {
  it('maps reasoning options and normalizes streamed tool call ids', async () => {
    let body: Record<string, unknown> = {};
    const transport: RequestTransport = {
      send: async (input) => {
        body = JSON.parse(String(input.body)) as Record<string, unknown>;
        return {
          status: 200,
          headers: {},
          body: (async function* () {
            yield encoder.encode(
              `data: ${JSON.stringify({ id: 'chatcmpl_1', model: 'mistral-large-latest', choices: [{ index: 0, delta: { content: 'answer', tool_calls: [{ index: 0, id: 'call.bad/id', function: { name: 'lookup', arguments: '{}' } }] }, finish_reason: null }] })}\n\n`,
            );
            yield encoder.encode(
              `data: ${JSON.stringify({ id: 'chatcmpl_1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\n`,
            );
            yield encoder.encode('data: [DONE]\n\n');
          })(),
        };
      },
    };
    const events: ProtocolContentEvent[] = [];
    const terminal = await createMistralConversationsAdapter()(
      request(transport),
      { publish: async (event) => void events.push(event) },
    );
    expect(body).toMatchObject({
      prompt_mode: 'reasoning',
      reasoning_effort: 'high',
      max_tokens: 64,
    });
    expect(
      events.find((event) => event.type === 'tool_call_start'),
    ).toMatchObject({ toolCallId: 'call_bad_id' });
    expect(terminal).toMatchObject({
      status: 'completed',
      finishReason: 'tool_calls',
      responseId: 'chatcmpl_1',
      usage: { totalTokens: 5 },
      replay: { protocolId: 'mistral-conversations' },
    });
  });

  it('normalizes invalid and empty ids deterministically', () => {
    expect(normalizeMistralToolCallId('a/b:c')).toBe('a_b_c');
    expect(normalizeMistralToolCallId('***')).toBe('___');
    expect(normalizeMistralToolCallId('')).toBe('tool_call');
  });
});
