import {
  createFauxProvider,
  fauxFailure,
  fauxTextResponse,
  fauxToolResponse,
  type FauxResponseScript,
} from '@duoduo/ai/testing';
import { AiRuntimeError } from '@duoduo/ai';
import { describe, expect, it } from 'vitest';

import { createAgent, type AgentTool } from '../index.js';

describe('createAgent', () => {
  it('completes a text turn and retains the transcript', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('hello from faux')],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });

    try {
      const result = await agent.run('hello');

      expect(result).toMatchObject({
        status: 'completed',
        turns: 1,
        response: {
          status: 'completed',
          content: [{ type: 'text', text: 'hello from faux' }],
        },
      });
      expect(agent.transcript).toMatchObject([
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'text', text: 'hello from faux' }],
        },
      ]);
    } finally {
      await agent.dispose();
    }
  });

  it('streams ordered Agent lifecycle and model events', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('streamed text')],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });

    try {
      const stream = agent.stream('hello');
      const events = [];

      for await (const event of stream) events.push(event);

      const result = await stream.result();
      expect(events.map((event) => event.type)).toEqual([
        'run_start',
        'turn_start',
        'model_start',
        'text_delta',
        'model_end',
        'turn_end',
        'run_end',
      ]);
      expect(events.map((event) => event.sequence)).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
      expect(events.find((event) => event.type === 'text_delta')).toMatchObject(
        { delta: 'streamed text' },
      );
      expect(events.at(-1)).toMatchObject({ type: 'run_end', result });
    } finally {
      await agent.dispose();
    }
  });

  it('executes a tool and continues to the next model turn', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'weather-1',
          name: 'weather',
          rawArguments: '{"city":"Shanghai"}',
        }),
        fauxTextResponse('sunny'),
      ],
    });
    const receivedArguments: unknown[] = [];
    let receivedExecutionContext:
      | {
          toolExecutionId: string;
          attempt: number;
          idempotencyKey?: string;
          deadline: string;
        }
      | undefined;
    const weatherTool: AgentTool = {
      definition: {
        name: 'weather',
        inputSchema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
          additionalProperties: false,
        },
      },
      execution: {
        sideEffect: 'external',
        idempotency: 'keyed',
        timeoutMs: 30_000,
      },
      execute: async (arguments_, context) => {
        receivedArguments.push(arguments_);
        receivedExecutionContext = {
          toolExecutionId: context.toolExecutionId,
          attempt: context.attempt,
          idempotencyKey: context.idempotencyKey,
          deadline: context.deadline,
        };
        context.update({ details: { phase: 'fetching' } });
        return { content: [{ type: 'text', text: 'sunny and 28C' }] };
      },
    };
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [weatherTool],
    });

    try {
      const stream = agent.stream('weather?');
      const events = [];
      for await (const event of stream) events.push(event);
      const result = await stream.result();

      expect(result).toMatchObject({ status: 'completed', turns: 2 });
      expect(receivedArguments).toEqual([{ city: 'Shanghai' }]);
      expect(receivedExecutionContext).toEqual({
        toolExecutionId: expect.any(String),
        attempt: 1,
        idempotencyKey: expect.any(String),
        deadline: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
      expect(events.map((event) => event.type)).toContain(
        'tool_execution_start',
      );
      expect(events.map((event) => event.type)).toContain(
        'tool_execution_update',
      );
      expect(events.map((event) => event.type)).toContain('tool_execution_end');
      expect(
        fixture.controller.calls()[1]?.context.messages.at(-1),
      ).toMatchObject({
        role: 'tool_result',
        toolCallId: 'weather-1',
        toolName: 'weather',
        isError: false,
        content: [{ type: 'text', text: 'sunny and 28C' }],
      });
    } finally {
      await agent.dispose();
    }
  });

  it('returns an error result to the model for an unknown tool', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'missing-1',
          name: 'missing',
          rawArguments: '{}',
        }),
        fauxTextResponse('recovered'),
      ],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });

    try {
      const result = await agent.run('use missing tool');

      expect(result).toMatchObject({ status: 'completed', turns: 2 });
      expect(result.transcript[2]).toMatchObject({
        role: 'tool_result',
        toolCallId: 'missing-1',
        toolName: 'missing',
        isError: true,
      });
    } finally {
      await agent.dispose();
    }
  });

  it('returns an error result to the model for invalid tool arguments', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'weather-invalid',
          name: 'weather',
          rawArguments: '{}',
        }),
        fauxTextResponse('recovered'),
      ],
    });
    let executed = false;
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [
        {
          definition: {
            name: 'weather',
            inputSchema: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
          execution: {
            sideEffect: 'none',
            idempotency: 'none',
            timeoutMs: 30_000,
          },
          execute: async () => {
            executed = true;
            return { content: [{ type: 'text', text: 'unused' }] };
          },
        },
      ],
    });

    try {
      const result = await agent.run('weather?');

      expect(result).toMatchObject({ status: 'completed', turns: 2 });
      expect(executed).toBe(false);
      expect(result.transcript[2]).toMatchObject({
        role: 'tool_result',
        toolCallId: 'weather-invalid',
        isError: true,
      });
    } finally {
      await agent.dispose();
    }
  });

  it('sanitizes exceptions thrown by tools and lets the model recover', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'explode-1',
          name: 'explode',
          rawArguments: '{}',
        }),
        fauxTextResponse('recovered'),
      ],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [
        {
          definition: {
            name: 'explode',
            inputSchema: { type: 'object' },
          },
          execution: {
            sideEffect: 'none',
            idempotency: 'none',
            timeoutMs: 30_000,
          },
          execute: async () => {
            throw new Error('secret-tool-exception-canary');
          },
        },
      ],
    });

    try {
      const result = await agent.run('explode');

      expect(result).toMatchObject({ status: 'completed', turns: 2 });
      expect(result.transcript[2]).toMatchObject({
        role: 'tool_result',
        toolCallId: 'explode-1',
        isError: true,
      });
      expect(JSON.stringify(result)).not.toContain(
        'secret-tool-exception-canary',
      );
    } finally {
      await agent.dispose();
    }
  });

  it('fails with AGENT_MAX_TURNS before starting another model turn', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'loop-1',
          name: 'loop',
          rawArguments: '{}',
        }),
      ],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      maxTurns: 1,
      tools: [
        {
          definition: { name: 'loop', inputSchema: { type: 'object' } },
          execution: {
            sideEffect: 'none',
            idempotency: 'none',
            timeoutMs: 30_000,
          },
          execute: async () => ({
            content: [{ type: 'text', text: 'again' }],
          }),
        },
      ],
    });

    try {
      const result = await agent.run('loop');

      expect(result).toMatchObject({
        status: 'failed',
        turns: 1,
        error: { code: 'AGENT_MAX_TURNS', category: 'limit' },
      });
      expect(fixture.controller.callCount()).toBe(1);
    } finally {
      await agent.dispose();
    }
  });

  it('returns a stable model failure and retains the partial assistant message', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxFailure({
          error: new AiRuntimeError(
            'FAUX_PROVIDER_DOWN',
            'provider',
            'provider unavailable',
            true,
          ),
          afterChunks: [
            {
              event: {
                type: 'text_start',
                itemId: 'partial-0',
                contentIndex: 0,
              },
            },
            {
              event: {
                type: 'text_delta',
                itemId: 'partial-0',
                contentIndex: 0,
                delta: 'partial answer',
              },
            },
            {
              event: {
                type: 'text_end',
                itemId: 'partial-0',
                contentIndex: 0,
              },
            },
          ],
        }),
      ],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });

    try {
      const result = await agent.run('hello');

      expect(result).toMatchObject({
        status: 'failed',
        turns: 1,
        error: {
          code: 'AGENT_MODEL_FAILED',
          category: 'model',
          retryable: true,
        },
        transcript: [
          { role: 'user' },
          {
            role: 'assistant',
            status: 'failed',
            partial: true,
            content: [{ type: 'text', text: 'partial answer' }],
          },
        ],
      });
    } finally {
      await agent.dispose();
    }
  });

  it('disposes the runtime when eager model resolution fails', async () => {
    const fixture = createFauxProvider();
    let disposed = false;

    await expect(
      createAgent({
        aiOptions: {
          transport: {
            send: async () => {
              throw new Error('transport should not be used');
            },
            dispose: async () => {
              disposed = true;
            },
          },
        },
        providers: [fixture.provider],
        model: {
          ref: { ...fixture.modelRef, modelId: 'missing-model' },
          scope: {},
        },
      }),
    ).rejects.toMatchObject({
      name: 'AgentError',
      code: 'AGENT_INITIALIZATION_FAILED',
      message: 'Failed to initialize Agent',
    });
    expect(disposed).toBe(true);
  });

  it('rejects a second run while the Agent is active', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxTextResponse('first', { paceMs: 20 }),
        fauxTextResponse('unexpected second', { paceMs: 20 }),
      ],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });

    try {
      const firstRun = agent.run('first');

      expect(() => agent.run('second')).toThrowError(
        expect.objectContaining({
          name: 'AgentError',
          code: 'AGENT_ALREADY_RUNNING',
        }),
      );
      await expect(firstRun).resolves.toMatchObject({ status: 'completed' });
      expect(fixture.controller.callCount()).toBe(1);
    } finally {
      await agent.dispose();
    }
  });

  it('retains consecutive runs until reset clears the transcript', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxTextResponse('first answer'),
        fauxTextResponse('second answer'),
      ],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });

    try {
      await agent.run('first');
      await agent.run('second');

      expect(agent.transcript.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
      expect(fixture.controller.calls()[1]?.context.messages).toHaveLength(3);

      agent.reset();
      expect(agent.transcript).toEqual([]);
    } finally {
      await agent.dispose();
    }
  });

  it('cancels an active run through the caller AbortSignal', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('too late', { paceMs: 20 })],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });
    const controller = new AbortController();

    try {
      const pending = agent.run('hello', { signal: controller.signal });
      controller.abort('stop');

      await expect(pending).resolves.toMatchObject({
        status: 'cancelled',
        error: { code: 'AGENT_CANCELLED', category: 'cancelled' },
      });
      expect(agent.isRunning).toBe(false);
    } finally {
      await agent.dispose();
    }
  });

  it('cancels an active run through agent.abort()', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('too late', { paceMs: 20 })],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });

    try {
      const pending = agent.run('hello');
      agent.abort('stop');

      await expect(pending).resolves.toMatchObject({
        status: 'cancelled',
        error: { code: 'AGENT_CANCELLED' },
      });
    } finally {
      await agent.dispose();
    }
  });

  it('cancels its run through stream.abort()', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('too late', { paceMs: 20 })],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });

    try {
      const stream = agent.stream('hello');
      stream.abort('stop');

      await expect(stream.result()).resolves.toMatchObject({
        status: 'cancelled',
        error: { code: 'AGENT_CANCELLED' },
      });
    } finally {
      await agent.dispose();
    }
  });

  it('closes the active tool call when cancellation happens during execution', async () => {
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'slow-1',
          name: 'slow',
          rawArguments: '{}',
        }),
      ],
    });
    let signalToolStarted: (() => void) | undefined;
    const toolStarted = new Promise<void>((resolve) => {
      signalToolStarted = resolve;
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [
        {
          definition: { name: 'slow', inputSchema: { type: 'object' } },
          execution: {
            sideEffect: 'none',
            idempotency: 'none',
            timeoutMs: 30_000,
          },
          execute: async (_arguments, context) => {
            signalToolStarted?.();
            await new Promise<void>((_resolve, reject) => {
              context.signal.addEventListener(
                'abort',
                () => reject(new Error('tool aborted')),
                { once: true },
              );
            });
            return { content: [] };
          },
        },
      ],
    });

    try {
      const pending = agent.run('start tool');
      await toolStarted;
      agent.abort('stop');
      const result = await pending;

      expect(result).toMatchObject({
        status: 'cancelled',
        turns: 1,
        error: { code: 'AGENT_CANCELLED' },
      });
      expect(result.transcript[2]).toMatchObject({
        role: 'tool_result',
        toolCallId: 'slow-1',
        isError: true,
      });
      expect(fixture.controller.callCount()).toBe(1);
    } finally {
      await agent.dispose();
    }
  });

  it('closes remaining tool calls without executing them after cancellation', async () => {
    const calls = [
      { id: 'slow-first', name: 'slow' },
      { id: 'must-skip', name: 'skip' },
    ] as const;
    const response: FauxResponseScript = {
      chunks: calls.flatMap((call, contentIndex) => [
        {
          event: {
            type: 'tool_call_start' as const,
            itemId: call.id,
            contentIndex,
            toolCallId: call.id,
            name: call.name,
          },
        },
        {
          event: {
            type: 'tool_call_delta' as const,
            itemId: call.id,
            contentIndex,
            argumentsDelta: '{}',
          },
        },
        {
          event: {
            type: 'tool_call_end' as const,
            itemId: call.id,
            contentIndex,
            toolCall: {
              type: 'tool_call' as const,
              id: call.id,
              name: call.name,
              status: 'complete' as const,
              rawArguments: '{}',
              arguments: {},
            },
          },
        },
      ]),
      terminal: { status: 'completed', finishReason: 'tool_calls' },
    };
    const fixture = createFauxProvider({ initialResponses: [response] });
    let signalToolStarted: (() => void) | undefined;
    const toolStarted = new Promise<void>((resolve) => {
      signalToolStarted = resolve;
    });
    let skippedToolExecuted = false;
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      tools: [
        {
          definition: { name: 'slow', inputSchema: { type: 'object' } },
          execution: {
            sideEffect: 'none',
            idempotency: 'none',
            timeoutMs: 30_000,
          },
          execute: async (_arguments, context) => {
            signalToolStarted?.();
            await new Promise<void>((_resolve, reject) => {
              context.signal.addEventListener(
                'abort',
                () => reject(new Error('tool aborted')),
                { once: true },
              );
            });
            return { content: [] };
          },
        },
        {
          definition: { name: 'skip', inputSchema: { type: 'object' } },
          execution: {
            sideEffect: 'none',
            idempotency: 'none',
            timeoutMs: 30_000,
          },
          execute: async () => {
            skippedToolExecuted = true;
            return { content: [] };
          },
        },
      ],
    });

    try {
      const pending = agent.run('start tools');
      await toolStarted;
      agent.abort('stop');
      const result = await pending;
      const toolResults = result.transcript.filter(
        (message) => message.role === 'tool_result',
      );

      expect(result.status).toBe('cancelled');
      expect(toolResults).toMatchObject([
        { toolCallId: 'slow-first', isError: true },
        { toolCallId: 'must-skip', isError: true },
      ]);
      expect(skippedToolExecuted).toBe(false);
    } finally {
      await agent.dispose();
    }
  });

  it('aborts active work on dispose and rejects later use', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('too late', { paceMs: 20 })],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });

    const pending = agent.run('hello');
    const disposal = agent.dispose();

    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    await expect(disposal).resolves.toBeUndefined();
    await expect(agent.dispose()).resolves.toBeUndefined();
    expect(() => agent.run('later')).toThrowError(
      expect.objectContaining({ code: 'AGENT_DISPOSED' }),
    );
    expect(() => agent.stream('later')).toThrowError(
      expect.objectContaining({ code: 'AGENT_DISPOSED' }),
    );
    expect(() => agent.reset()).toThrowError(
      expect.objectContaining({ code: 'AGENT_DISPOSED' }),
    );
  });

  it('bounds an unconsumed event stream and preserves its terminal event', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('overflow', { paceMs: 5 })],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      eventBuffer: { maxEvents: 1 },
    });

    try {
      const stream = agent.stream('hello');
      const result = await stream.result();
      const events = [];
      for await (const event of stream) events.push(event);

      expect(result).toMatchObject({
        status: 'failed',
        error: {
          code: 'AGENT_EVENT_BUFFER_OVERFLOW',
          category: 'stream',
        },
      });
      expect(events).toEqual([
        expect.objectContaining({ type: 'run_end', result }),
      ]);
    } finally {
      await agent.dispose();
    }
  });

  it('rejects duplicate tool names during initialization', async () => {
    const fixture = createFauxProvider();
    const duplicateTool: AgentTool = {
      definition: { name: 'duplicate', inputSchema: { type: 'object' } },
      execution: {
        sideEffect: 'none',
        idempotency: 'none',
        timeoutMs: 30_000,
      },
      execute: async () => ({ content: [] }),
    };

    await expect(
      createAgent({
        providers: [fixture.provider],
        model: { ref: fixture.modelRef, scope: {} },
        tools: [duplicateTool, duplicateTool],
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_INITIALIZATION_FAILED',
      message: 'Failed to initialize Agent',
    });
  });

  it('rejects a tool without an execution declaration', async () => {
    const fixture = createFauxProvider();
    const undeclaredTool = {
      definition: { name: 'undeclared', inputSchema: { type: 'object' } },
      execute: async () => ({ content: [] }),
    } as unknown as AgentTool;

    await expect(
      createAgent({
        providers: [fixture.provider],
        model: { ref: fixture.modelRef, scope: {} },
        tools: [undeclaredTool],
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_INITIALIZATION_FAILED',
      message: 'Failed to initialize Agent',
    });
  });

  it('accepts a full UserMessage without retaining mutable caller data', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('received')],
    });
    const details = { source: 'upload' };
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });

    try {
      await agent.run({
        role: 'user',
        content: [{ type: 'text', text: 'rich input' }],
        details,
        timestamp: 42,
      });
      details.source = 'changed later';

      expect(agent.transcript[0]).toMatchObject({
        role: 'user',
        content: [{ type: 'text', text: 'rich input' }],
        details: { source: 'upload' },
        timestamp: 42,
      });
    } finally {
      await agent.dispose();
    }
  });

  it('rejects reset while a run is active', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('answer', { paceMs: 20 })],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
    });

    try {
      const pending = agent.run('hello');
      expect(agent.isRunning).toBe(true);
      expect(() => agent.reset()).toThrowError(
        expect.objectContaining({ code: 'AGENT_RESET_WHILE_RUNNING' }),
      );
      await pending;
    } finally {
      await agent.dispose();
    }
  });

  it('applies configured stream options to every model turn', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('configured')],
    });
    const agent = await createAgent({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      streamOptions: { maxOutputTokens: 321, temperature: 0.25 },
    });

    try {
      await agent.run('hello');

      expect(fixture.controller.calls()[0]?.options).toMatchObject({
        maxOutputTokens: 321,
        temperature: 0.25,
      });
    } finally {
      await agent.dispose();
    }
  });

  it('keeps run and stream terminal transcript behavior equivalent', async () => {
    const runFixture = createFauxProvider({
      id: 'faux-run',
      initialResponses: [fauxTextResponse('same answer')],
    });
    const streamFixture = createFauxProvider({
      id: 'faux-stream',
      initialResponses: [fauxTextResponse('same answer')],
    });
    const runAgent = await createAgent({
      providers: [runFixture.provider],
      model: { ref: runFixture.modelRef, scope: {} },
    });
    const streamAgent = await createAgent({
      providers: [streamFixture.provider],
      model: { ref: streamFixture.modelRef, scope: {} },
    });

    try {
      const runResult = await runAgent.run('same prompt');
      const stream = streamAgent.stream('same prompt');
      for await (const event of stream) {
        // Drain the public event stream before comparing its terminal state.
        void event;
      }
      const streamResult = await stream.result();
      const visibleTranscript = (result: typeof runResult) =>
        result.transcript.map(({ role, content }) => ({ role, content }));

      expect(streamResult.status).toBe(runResult.status);
      expect(streamResult.turns).toBe(runResult.turns);
      expect(visibleTranscript(streamResult)).toEqual(
        visibleTranscript(runResult),
      );
    } finally {
      await Promise.all([runAgent.dispose(), streamAgent.dispose()]);
    }
  });
});
