import { describe, expect, it } from 'vitest';
import { createAi } from '../index.js';
import { AiRuntimeError } from '../core/errors.js';
import {
  collectResponseStream,
  createFauxProvider,
  fauxTextResponse,
} from '../testing.js';

describe('createAi', () => {
  it('disposes the transport once', async () => {
    let disposeCalls = 0;
    const ai = createAi({
      transport: {
        send: async () => {
          throw new Error('unexpected transport call');
        },
        dispose: async () => {
          disposeCalls += 1;
        },
      },
    });

    await Promise.all([ai.dispose(), ai.dispose()]);
    await ai.dispose();

    expect(disposeCalls).toBe(1);
    expect(() => ai.providers.list()).toThrowError(
      expect.objectContaining({ code: 'RUNTIME_DISPOSED' }),
    );
  });

  it('rejects invalid disposal options without closing the runtime', async () => {
    const ai = createAi();

    await expect(ai.dispose({ timeoutMs: 0 })).rejects.toMatchObject({
      code: 'RUNTIME_DISPOSE_OPTIONS_INVALID',
    });
    expect(ai.providers.list()).toEqual([]);

    await ai.dispose();
  });

  it('aborts admitted work when graceful disposal times out', async () => {
    let markProviderStarted!: () => void;
    let providerAborted = false;
    let transportDisposed = false;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const fixture = createFauxProvider();
    const provider = {
      ...fixture.provider,
      chat: {
        ...fixture.provider.chat!,
        runChat: async (request: { readonly signal: AbortSignal }) => {
          markProviderStarted();
          await new Promise<void>((resolve) => {
            const fallback = setTimeout(resolve, 100);
            request.signal.addEventListener(
              'abort',
              () => {
                providerAborted = true;
                clearTimeout(fallback);
                resolve();
              },
              { once: true },
            );
          });
          return request.signal.aborted
            ? {
                status: 'cancelled' as const,
                error: new AiRuntimeError(
                  'REQUEST_CANCELLED',
                  'cancelled',
                  'request cancelled',
                ) as AiRuntimeError & { category: 'cancelled' },
              }
            : {
                status: 'completed' as const,
                finishReason: 'stop' as const,
              };
        },
      },
    };
    const ai = createAi({
      transport: {
        send: async () => {
          throw new Error('unexpected transport call');
        },
        dispose: async () => {
          transportDisposed = true;
        },
      },
    });
    ai.providers.register(provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const result = ai.complete(model, { messages: [] });
    await providerStarted;

    await ai.dispose({ timeoutMs: 5 });

    expect(providerAborted).toBe(true);
    expect(transportDisposed).toBe(true);
    await expect(result).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('does not hang when an aborted provider ignores its signal', async () => {
    let markProviderStarted!: () => void;
    let transportDisposed = false;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const fixture = createFauxProvider();
    const ai = createAi({
      transport: {
        send: async () => {
          throw new Error('unexpected transport call');
        },
        dispose: async () => {
          transportDisposed = true;
        },
      },
    });
    ai.providers.register({
      ...fixture.provider,
      chat: {
        ...fixture.provider.chat!,
        runChat: async (): Promise<never> => {
          markProviderStarted();
          return new Promise<never>(() => undefined);
        },
      },
    });
    const result = ai.complete(await ai.models.require(fixture.modelRef, {}), {
      messages: [],
    });
    await providerStarted;

    await ai.dispose({ timeoutMs: 5 });

    expect(transportDisposed).toBe(true);
    await expect(result).resolves.toMatchObject({ status: 'cancelled' });
  }, 500);

  it('keeps resources while a timed-out disposal reports an error', async () => {
    let finishProvider!: () => void;
    let markProviderStarted!: () => void;
    let transportDisposed = false;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const providerCanFinish = new Promise<void>((resolve) => {
      finishProvider = resolve;
    });
    const fixture = createFauxProvider();
    const ai = createAi({
      transport: {
        send: async () => {
          throw new Error('unexpected transport call');
        },
        dispose: async () => {
          transportDisposed = true;
        },
      },
    });
    ai.providers.register({
      ...fixture.provider,
      chat: {
        ...fixture.provider.chat!,
        runChat: async () => {
          markProviderStarted();
          await providerCanFinish;
          return {
            status: 'completed' as const,
            finishReason: 'stop' as const,
          };
        },
      },
    });
    const result = ai.complete(await ai.models.require(fixture.modelRef, {}), {
      messages: [],
    });
    await providerStarted;

    await expect(
      ai.dispose({ timeoutMs: 5, onTimeout: 'error' }),
    ).rejects.toMatchObject({ code: 'RUNTIME_DISPOSE_TIMEOUT' });
    expect(transportDisposed).toBe(false);
    await expect(ai.models.list({})).rejects.toMatchObject({
      code: 'RUNTIME_DRAINING',
    });

    finishProvider();
    await expect(result).resolves.toMatchObject({ status: 'completed' });
    await ai.dispose();
    expect(transportDisposed).toBe(true);
  });

  it('drains an admitted chat before disposing resources and rejects new work', async () => {
    let releaseProvider!: () => void;
    let markProviderStarted!: () => void;
    let providerStarts = 0;
    let transportDisposed = false;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const providerCanFinish = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const fixture = createFauxProvider();
    const provider = {
      ...fixture.provider,
      chat: {
        ...fixture.provider.chat!,
        runChat: async () => {
          providerStarts += 1;
          markProviderStarted();
          await providerCanFinish;
          return {
            status: 'completed' as const,
            finishReason: 'stop' as const,
          };
        },
      },
    };
    const ai = createAi({
      transport: {
        send: async () => {
          throw new Error('unexpected transport call');
        },
        dispose: async () => {
          transportDisposed = true;
        },
      },
    });
    ai.providers.register(provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const result = ai.complete(model, { messages: [] });
    await providerStarted;
    const dormant = ai.stream(model, { messages: [] });

    const disposal = ai.dispose();
    await Promise.resolve();

    expect(transportDisposed).toBe(false);
    expect(() => ai.providers.register(provider)).toThrowError(
      expect.objectContaining({ code: 'RUNTIME_DRAINING' }),
    );
    await expect(ai.models.list({})).rejects.toMatchObject({
      code: 'RUNTIME_DRAINING',
    });
    await expect(ai.inventory.models.list()).rejects.toMatchObject({
      code: 'RUNTIME_DRAINING',
    });
    await expect(ai.auth.status('faux', {})).rejects.toMatchObject({
      code: 'RUNTIME_DRAINING',
    });
    await expect(
      ai.sessions.cleanup('faux', {}, 'session-1'),
    ).rejects.toMatchObject({ code: 'RUNTIME_DRAINING' });
    await expect(ai.images.models.list({})).rejects.toMatchObject({
      code: 'RUNTIME_DRAINING',
    });
    await expect(ai.videos.models.list({})).rejects.toMatchObject({
      code: 'RUNTIME_DRAINING',
    });
    expect(() => ai.stream(model, { messages: [] })).toThrowError(
      expect.objectContaining({ code: 'RUNTIME_DRAINING' }),
    );
    await expect(dormant.result()).rejects.toMatchObject({
      code: 'RUNTIME_DRAINING',
    });
    expect(providerStarts).toBe(1);

    releaseProvider();
    await expect(result).resolves.toMatchObject({ status: 'completed' });
    await disposal;
    expect(transportDisposed).toBe(true);
  });

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

  it('uses the runtime max output default within the model limit', async () => {
    const fixture = createFauxProvider();
    const ai = createAi({ commonDefaults: { maxOutputTokens: 123 } });
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});

    await ai.complete(model, { messages: [] });

    expect(fixture.controller.calls()[0]?.options.maxOutputTokens).toBe(123);
  });

  it('normalizes explicit legacy protocol options before common defaults', async () => {
    const fixture = createFauxProvider();
    const model = fixture.provider.chat!.models[0]!;
    const ai = createAi();
    ai.providers.register({
      ...fixture.provider,
      chat: {
        ...fixture.provider.chat!,
        models: [
          {
            ...model,
            capabilities: {
              ...model.capabilities,
              reasoning: true,
              thinkingLevels: ['none', 'high'] as const,
            },
          },
        ],
      },
    });
    const handle = await ai.models.require(fixture.modelRef, {});

    await ai.complete(
      handle,
      { messages: [] },
      {
        protocolOptions: {
          toolChoice: 'none',
          thinkingEnabled: true,
          reasoningEffort: 'high',
        },
      },
    );

    expect(fixture.controller.calls()[0]?.options).toMatchObject({
      toolChoice: 'none',
      reasoning: 'high',
    });
    await ai.dispose();
  });

  it('resolves common text options through the public runtime boundary', async () => {
    const fixture = createFauxProvider();
    const model = fixture.provider.chat!.models[0]!;
    const provider = {
      ...fixture.provider,
      chat: {
        ...fixture.provider.chat!,
        models: [
          {
            ...model,
            capabilities: {
              ...model.capabilities,
              reasoning: true,
              thinkingLevels: ['low'] as const,
            },
            requestDefaults: {
              temperature: 0.1,
              topP: 0.2,
              toolChoice: 'none' as const,
              reasoning: 'none' as const,
              cacheRetention: 'none' as const,
            },
          },
        ],
      },
    };
    const contextPolicy = {
      unsupportedImage: 'placeholder',
      crossProviderReasoning: 'drop',
      failedTurn: 'preserve-readable',
      incompleteToolCall: 'as-text',
      deferredTools: 'require-deferred',
      tokenBudget: 'truncate-oldest-safe-turns',
    } as const;
    const ai = createAi({
      commonDefaults: {
        temperature: 0.3,
        topP: 0.4,
        toolChoice: 'required',
        reasoning: 'low',
        cacheRetention: 'long',
        contextPolicy,
      },
    });
    ai.providers.register(provider);
    const handle = await ai.models.require(fixture.modelRef, {});

    await ai.complete(
      handle,
      {
        messages: [],
        tools: [{ name: 'lookup', inputSchema: { type: 'object' } }],
      },
      { temperature: 0.5 },
    );

    expect(fixture.controller.calls()[0]?.options).toMatchObject({
      temperature: 0.5,
      topP: 0.4,
      toolChoice: 'required',
      reasoning: 'low',
      cacheRetention: 'long',
      contextPolicy,
    });
  });

  it('supplies the documented common text defaults', async () => {
    const fixture = createFauxProvider();
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});

    await ai.complete(model, { messages: [] });

    expect(fixture.controller.calls()[0]?.options).toMatchObject({
      maxOutputTokens: 4_096,
      stop: [],
      toolChoice: 'auto',
      reasoning: 'none',
      cacheRetention: 'short',
      timeoutMs: 120_000,
      retry: {
        maxAttempts: 3,
        baseDelayMs: 250,
        maxDelayMs: 5_000,
        jitterRatio: 0.2,
        retryOn: ['network', 'rate_limit', 'timeout', 'provider_5xx'],
      },
      contextPolicy: {
        unsupportedImage: 'reject',
        crossProviderReasoning: 'as-text',
        failedTurn: 'drop',
        incompleteToolCall: 'drop',
        deferredTools: 'eager-fallback',
        tokenBudget: 'reject',
      },
    });
  });

  it('applies the common context policy before invoking the provider', async () => {
    const fixture = createFauxProvider();
    const ai = createAi({
      commonDefaults: {
        contextPolicy: {
          unsupportedImage: 'placeholder',
          crossProviderReasoning: 'as-text',
          failedTurn: 'drop',
          incompleteToolCall: 'as-text',
          deferredTools: 'eager-fallback',
          tokenBudget: 'reject',
        },
      },
    });
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});

    await ai.complete(model, {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              mediaType: 'image/png',
              source: { type: 'base64', data: 'aW1hZ2U=' },
            },
          ],
        },
        {
          role: 'assistant',
          model: { providerInstanceId: 'other', modelId: 'other' },
          status: 'completed',
          finishReason: 'stop',
          partial: false,
          content: [
            { type: 'reasoning', text: 'portable thought' },
            {
              type: 'tool_call',
              id: 'call-1',
              name: 'lookup',
              status: 'incomplete',
              rawArguments: '{"city":',
            },
          ],
        },
        {
          role: 'assistant',
          model: fixture.modelRef,
          status: 'failed',
          finishReason: 'error',
          partial: true,
          content: [{ type: 'text', text: 'failed turn' }],
        },
      ],
      tools: [
        {
          name: 'lookup',
          deferred: true,
          inputSchema: { type: 'object' },
        },
      ],
    });

    expect(fixture.controller.calls()[0]?.context).toMatchObject({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: '[unsupported image omitted]' }],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'portable thought' },
            { type: 'text', text: 'lookup({"city":)' },
          ],
        },
      ],
      tools: [
        {
          name: 'lookup',
          deferred: false,
        },
      ],
    });
  });

  it('rejects context over the model budget before invoking the provider', async () => {
    const fixture = createFauxProvider();
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const collected = await collectResponseStream(
      ai.stream(model, {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'x'.repeat(40_000) }],
          },
        ],
      }),
    );

    expect(collected.response).toMatchObject({
      status: 'failed',
      error: { code: 'CONTEXT_OVERFLOW' },
    });
    expect(fixture.controller.callCount()).toBe(0);
  });

  it.each([
    {
      name: 'zero max output tokens',
      options: { maxOutputTokens: 0 },
      code: 'MAX_OUTPUT_TOKENS_INVALID',
    },
    {
      name: 'max output tokens above the model limit',
      options: { maxOutputTokens: 4_097 },
      code: 'MAX_OUTPUT_TOKENS_INVALID',
    },
    {
      name: 'timeout below one second',
      options: { timeoutMs: 999 },
      code: 'TIMEOUT_INVALID',
    },
    {
      name: 'timeout above fifteen minutes',
      options: { timeoutMs: 900_001 },
      code: 'TIMEOUT_INVALID',
    },
    {
      name: 'more than sixteen stop sequences',
      options: { stop: Array.from({ length: 17 }, (_, index) => `${index}`) },
      code: 'STOP_INVALID',
    },
    {
      name: 'a stop sequence above 256 UTF-8 bytes',
      options: { stop: ['界'.repeat(86)] },
      code: 'STOP_INVALID',
    },
  ])(
    'rejects $name before invoking the provider',
    async ({ options, code }) => {
      const fixture = createFauxProvider();
      const ai = createAi();
      ai.providers.register(fixture.provider);
      const model = await ai.models.require(fixture.modelRef, {});

      expect(() => ai.stream(model, { messages: [] }, options)).toThrowError(
        expect.objectContaining({ code }),
      );
      expect(fixture.controller.callCount()).toBe(0);
    },
  );

  it.each([
    {
      name: 'temperature below zero',
      options: { temperature: -0.01 },
      code: 'TEMPERATURE_INVALID',
    },
    {
      name: 'temperature above two',
      options: { temperature: 2.01 },
      code: 'TEMPERATURE_INVALID',
    },
    {
      name: 'topP below zero',
      options: { topP: -0.01 },
      code: 'TOP_P_INVALID',
    },
    {
      name: 'topP above one',
      options: { topP: 1.01 },
      code: 'TOP_P_INVALID',
    },
    {
      name: 'unknown cache retention',
      options: { cacheRetention: 'forever' },
      code: 'CACHE_RETENTION_INVALID',
    },
    {
      name: 'retry attempts above five',
      options: {
        retry: {
          maxAttempts: 6,
          baseDelayMs: 250,
          maxDelayMs: 5_000,
          jitterRatio: 0.2,
          retryOn: ['network'],
        },
      },
      code: 'RETRY_INVALID',
    },
    {
      name: 'retry delay above thirty seconds',
      options: {
        retry: {
          maxAttempts: 3,
          baseDelayMs: 250,
          maxDelayMs: 30_001,
          jitterRatio: 0.2,
          retryOn: ['network'],
        },
      },
      code: 'RETRY_INVALID',
    },
  ] as const)(
    'rejects $name at the public runtime boundary',
    async ({ options, code }) => {
      const fixture = createFauxProvider();
      const ai = createAi();
      ai.providers.register(fixture.provider);
      const model = await ai.models.require(fixture.modelRef, {});

      expect(() =>
        ai.stream(model, { messages: [] }, options as never),
      ).toThrowError(expect.objectContaining({ code }));
      expect(fixture.controller.callCount()).toBe(0);
    },
  );

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

  it('does not expose the provider error thrown during cancellation', async () => {
    const canary = 'chat-cancellation-secret-canary';
    const fixture = createFauxProvider();
    const throwingProvider = {
      ...fixture.provider,
      chat: {
        ...fixture.provider.chat!,
        runChat: async (request: {
          readonly signal: AbortSignal;
        }): Promise<never> => {
          if (!request.signal.aborted)
            await new Promise<void>((resolve) =>
              request.signal.addEventListener('abort', () => resolve(), {
                once: true,
              }),
            );
          throw new Error(canary);
        },
      },
    };
    const ai = createAi();
    ai.providers.register(throwingProvider);
    const model = await ai.models.require(fixture.modelRef, {});
    const stream = ai.stream(model, { messages: [] });
    const iterator = stream[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.type).toBe('response_start');

    stream.abort(canary);

    while (!(await iterator.next()).done) {
      // Drain the public event stream before awaiting its terminal result.
    }
    const response = await stream.result();
    expect(response).toMatchObject({
      status: 'cancelled',
      finishReason: 'cancelled',
      error: {
        code: 'REQUEST_CANCELLED',
        category: 'cancelled',
        message: 'request cancelled',
      },
    });
    expect(response.error?.message).not.toContain(canary);
  });

  it('normalizes a provider terminal error before publishing it', async () => {
    const canary = 'chat-terminal-secret-canary';
    const fixture = createFauxProvider({
      initialResponses: [
        {
          chunks: [],
          terminal: {
            status: 'failed',
            diagnostics: [{ code: 'UPSTREAM_DIAGNOSTIC', message: canary }],
            error: new AiRuntimeError(
              'UPSTREAM_FAILED',
              'provider',
              canary,
              true,
              { raw: canary },
            ),
          },
        },
      ],
    });
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const collected = await collectResponseStream(
      ai.stream(model, { messages: [] }),
    );

    expect(collected.response).toMatchObject({
      status: 'failed',
      error: {
        code: 'UPSTREAM_FAILED',
        category: 'provider',
        retryable: true,
        message: 'AI provider request failed',
      },
      diagnostics: [{ code: 'UPSTREAM_DIAGNOSTIC' }],
    });
    expect(collected.response.diagnostics).toEqual([
      { code: 'UPSTREAM_DIAGNOSTIC' },
    ]);
    expect(collected.response.error?.details).toBeUndefined();
    expect(collected.response.error?.message).not.toContain(canary);
    expect(collected.events.at(-1)).toMatchObject({
      type: 'response_error',
      response: {
        error: {
          code: 'UPSTREAM_FAILED',
          message: 'AI provider request failed',
        },
      },
    });
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
