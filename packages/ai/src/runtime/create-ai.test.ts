import { describe, expect, it } from 'vitest';
import { createAi } from '../index.js';
import {
  collectResponseStream,
  createFauxProvider,
  fauxTextResponse,
} from '../testing.js';

describe('createAi', () => {
  it('does not auto-register providers', async () => {
    const ai = createAi();
    expect(ai.providers.list()).toEqual([]);
    await expect(
      ai.models.find({ providerInstanceId: 'faux', modelId: 'faux-text' }, {}),
    ).resolves.toBeUndefined();
  });

  it('starts the Faux call lazily on observation or result', async () => {
    const fixture = createFauxProvider();
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const stream = ai.stream(model, { messages: [] });
    expect(fixture.controller.callCount()).toBe(0);
    const result = stream.result();
    await result;
    expect(fixture.controller.callCount()).toBe(1);
  });

  it('does not start when an iterator is acquired but not advanced', async () => {
    const fixture = createFauxProvider();
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const stream = ai.stream(model, { messages: [] });
    const iterator = stream[Symbol.asyncIterator]();

    expect(fixture.controller.callCount()).toBe(0);
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'response_start' },
    });
    expect(fixture.controller.callCount()).toBe(1);
    await iterator.return?.();
    await stream.result();
  });

  it('fails invalid context without invoking the provider', async () => {
    const fixture = createFauxProvider();
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const duplicateTool = {
      name: 'lookup',
      inputSchema: { type: 'object' },
    } as const;
    const collected = await collectResponseStream(
      ai.stream(model, {
        messages: [],
        tools: [duplicateTool, duplicateTool],
      }),
    );

    expect(fixture.controller.callCount()).toBe(0);
    expect(collected.events.map((event) => event.type)).toEqual([
      'response_start',
      'response_error',
    ]);
    expect(collected.response).toMatchObject({
      status: 'failed',
      error: { code: 'CONTEXT_INVALID' },
    });
  });

  it('normalizes unexpected provider throws into a failed response', async () => {
    const fixture = createFauxProvider();
    const throwingProvider = {
      ...fixture.provider,
      chat: {
        ...fixture.provider.chat!,
        runChat: async () => {
          throw new Error('upstream secret failure details');
        },
      },
    };
    const ai = createAi();
    ai.providers.register(throwingProvider);
    const model = await ai.models.require(fixture.modelRef, {});
    const collected = await collectResponseStream(
      ai.stream(model, { messages: [] }),
    );

    expect(collected.events.map((event) => event.type)).toEqual([
      'response_start',
      'response_error',
    ]);
    expect(collected.response).toMatchObject({
      status: 'failed',
      finishReason: 'error',
      error: {
        code: 'INTERNAL_ERROR',
        category: 'internal',
        message: 'AI provider failed internally',
      },
    });
    expect(collected.response.error?.message).not.toContain('secret');
  });

  it('resolves a model and streams a completed response', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('hello')],
    });
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const stream = ai.stream(model, { messages: [] });
    const events = [];
    for await (const event of stream) events.push(event);
    const response = await stream.result();
    expect(events.map((event) => event.type)).toEqual([
      'response_start',
      'text_start',
      'text_delta',
      'text_end',
      'response_end',
    ]);
    expect(response.status).toBe('completed');
    expect(response.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(fixture.controller.callCount()).toBe(1);
  });

  it('supports result-first drain and closes later observation', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('drained')],
    });
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const stream = ai.stream(model, { messages: [] });
    const response = await stream.result();
    expect(response.status).toBe('completed');
    expect(() => stream[Symbol.asyncIterator]()).toThrowError(
      'stream observation is closed',
    );
  });

  it('rejects a second iterator', async () => {
    const fixture = createFauxProvider();
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const stream = ai.stream(model, { messages: [] });
    stream[Symbol.asyncIterator]();
    expect(() => stream[Symbol.asyncIterator]()).toThrowError(
      'a stream can only have one iterator',
    );
    stream.abort();
    await stream.result();
  });
});
