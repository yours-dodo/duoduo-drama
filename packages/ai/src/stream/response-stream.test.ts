import { describe, expect, it } from 'vitest';
import { createAi } from '../index.js';
import { AiRuntimeError } from '../core/errors.js';
import {
  assertResponseStart,
  assertSingleTerminal,
  collectResponseStream,
  createFauxProvider,
  fauxFailure,
  fauxToolResponse,
  type FauxResponseScript,
} from '../testing.js';

async function setup(script: FauxResponseScript) {
  const fixture = createFauxProvider({ initialResponses: [script] });
  const ai = createAi();
  ai.providers.register(fixture.provider);
  const model = await ai.models.require(fixture.modelRef, {});
  return { ai, fixture, model };
}

describe('deterministic stream terminals', () => {
  it('preserves interleaved reasoning and text in content-index order', async () => {
    const { ai, model } = await setup({
      chunks: [
        { event: { type: 'reasoning_start', itemId: 'r', contentIndex: 0 } },
        { event: { type: 'text_start', itemId: 't', contentIndex: 1 } },
        {
          event: {
            type: 'reasoning_delta',
            itemId: 'r',
            contentIndex: 0,
            delta: 'think',
          },
        },
        {
          event: {
            type: 'text_delta',
            itemId: 't',
            contentIndex: 1,
            delta: 'answer',
          },
        },
        { event: { type: 'text_end', itemId: 't', contentIndex: 1 } },
        { event: { type: 'reasoning_end', itemId: 'r', contentIndex: 0 } },
      ],
      terminal: { status: 'completed', finishReason: 'stop' },
    });
    const collected = await collectResponseStream(
      ai.stream(model, { messages: [] }),
    );
    expect(collected.response.content).toEqual([
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: 'answer' },
    ]);
    assertResponseStart(collected.events);
    assertSingleTerminal(collected.events);
  });

  it('allows incomplete tool JSON only for a truncating finish reason', async () => {
    const { ai, model } = await setup(
      fauxToolResponse({
        id: 'call-1',
        name: 'lookup',
        rawArguments: '{"q":',
        finishReason: 'length',
      }),
    );
    const response = await ai.complete(model, { messages: [] });
    expect(response).toMatchObject({
      status: 'completed',
      finishReason: 'length',
      partial: false,
      content: [{ type: 'tool_call', status: 'incomplete' }],
    });
  });

  it('turns incomplete normal tool-call completion into one failed terminal', async () => {
    const { ai, model } = await setup(
      fauxToolResponse({
        id: 'call-1',
        name: 'lookup',
        rawArguments: '{"q":',
      }),
    );
    const collected = await collectResponseStream(
      ai.stream(model, { messages: [] }),
    );
    expect(collected.response).toMatchObject({
      status: 'failed',
      finishReason: 'error',
      error: { code: 'PROTOCOL_VIOLATION' },
    });
    assertSingleTerminal(collected.events);
  });

  it('retains open partial output on provider failure', async () => {
    const { ai, model } = await setup(
      fauxFailure({
        error: new AiRuntimeError('FIXTURE_FAILURE', 'provider', 'failed'),
        afterChunks: [
          { event: { type: 'text_start', itemId: 'text-0', contentIndex: 0 } },
          {
            event: {
              type: 'text_delta',
              itemId: 'text-0',
              contentIndex: 0,
              delta: 'partial',
            },
          },
        ],
      }),
    );
    const collected = await collectResponseStream(
      ai.stream(model, { messages: [] }),
    );
    expect(collected.response).toMatchObject({
      status: 'failed',
      partial: true,
      content: [{ type: 'text', text: 'partial' }],
    });
    expect(collected.events.map((event) => event.type)).toEqual([
      'response_start',
      'text_start',
      'text_delta',
      'response_error',
    ]);
    assertSingleTerminal(collected.events);
  });

  it('cancels after visible output, drops later chunks, and preserves partial content', async () => {
    const { ai, fixture, model } = await setup({
      chunks: [
        { event: { type: 'text_start', itemId: 'text-0', contentIndex: 0 } },
        {
          event: {
            type: 'text_delta',
            itemId: 'text-0',
            contentIndex: 0,
            delta: 'partial',
          },
        },
        {
          afterMs: 25,
          event: { type: 'text_end', itemId: 'text-0', contentIndex: 0 },
        },
      ],
      terminal: { status: 'completed', finishReason: 'stop' },
    });
    const stream = ai.stream(model, { messages: [] });
    const events = [];
    for await (const event of stream) {
      events.push(event);
      if (event.type === 'text_delta') stream.abort('test abort');
    }
    const response = await stream.result();
    expect(response).toMatchObject({
      status: 'cancelled',
      finishReason: 'cancelled',
      partial: true,
      content: [{ type: 'text', text: 'partial' }],
    });
    expect(events.map((event) => event.type)).toEqual([
      'response_start',
      'text_start',
      'text_delta',
      'response_error',
    ]);
    expect(fixture.controller.calls()[0]?.aborted).toBe(true);
    assertSingleTerminal(events);
  });

  it('continues producer drain after an iterator returns early', async () => {
    const { ai, fixture, model } = await setup({
      chunks: [
        { event: { type: 'text_start', itemId: 'text-0', contentIndex: 0 } },
        {
          afterMs: 5,
          event: {
            type: 'text_delta',
            itemId: 'text-0',
            contentIndex: 0,
            delta: 'done',
          },
        },
        { event: { type: 'text_end', itemId: 'text-0', contentIndex: 0 } },
      ],
      terminal: { status: 'completed', finishReason: 'stop' },
    });
    const stream = ai.stream(model, { messages: [] });
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'response_start' },
    });
    await iterator.return?.();
    await expect(stream.result()).resolves.toMatchObject({
      status: 'completed',
    });
    expect(fixture.controller.calls()[0]?.aborted).toBe(false);
  });
});
