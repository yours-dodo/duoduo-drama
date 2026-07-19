import { describe, expect, it } from 'vitest';
import { createAi } from '../index.js';
import { createFauxProvider, fauxFailure, fauxToolResponse } from './faux.js';
import { AiRuntimeError } from '../core/errors.js';

describe('Faux provider', () => {
  it('retains FIFO scripts and aggregates tool calls', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'call-1',
          name: 'lookup',
          rawArguments: '{"q":"x"}',
        }),
      ],
    });
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const response = await ai.complete(model, { messages: [] });
    expect(response.finishReason).toBe('tool_calls');
    expect(response.content).toEqual([
      {
        type: 'tool_call',
        id: 'call-1',
        name: 'lookup',
        status: 'complete',
        rawArguments: '{"q":"x"}',
        arguments: { q: 'x' },
      },
    ]);
  });

  it('returns a single failed terminal', async () => {
    const error = new AiRuntimeError(
      'FIXTURE_FAILURE',
      'provider',
      'fixture failed',
    );
    const fixture = createFauxProvider({
      initialResponses: [fauxFailure({ error })],
    });
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const stream = ai.stream(model, { messages: [] });
    const events = [];
    for await (const event of stream) events.push(event.type);
    const response = await stream.result();
    expect(events).toEqual(['response_start', 'response_error']);
    expect(response.status).toBe('failed');
  });
});
