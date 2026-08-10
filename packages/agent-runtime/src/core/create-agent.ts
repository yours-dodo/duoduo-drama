import type { Message } from '@duoduo/ai';

import { createAgentRuntime } from '../ai/runtime.js';
import { AgentError } from './errors.js';
import { createAgentEventStream, runAgentLoop } from './run-loop.js';
import {
  assertAgentToolExecutionDeclaration,
  createEphemeralToolExecutionCoordinator,
} from './tool-execution.js';
import type {
  Agent,
  AgentInput,
  AgentRunResult,
  AgentRunOptions,
  CreateAgentOptions,
} from './types.js';

export async function createAgent<TScopeHandle>(
  options: CreateAgentOptions<TScopeHandle>,
): Promise<Agent> {
  try {
    const tools = Object.freeze([...(options.tools ?? [])]);
    const toolNames = new Set<string>();
    for (const tool of tools) {
      const name = tool.definition.name;
      if (name.trim() === '' || toolNames.has(name))
        throw new TypeError('Tool names must be non-empty and unique');
      assertAgentToolExecutionDeclaration(tool);
      toolNames.add(name);
    }
    const maxTurns = options.maxTurns ?? 20;
    if (!Number.isInteger(maxTurns) || maxTurns < 1)
      throw new TypeError('maxTurns must be a positive integer');
    const maxBufferedEvents = options.eventBuffer?.maxEvents ?? 1_024;
    if (!Number.isInteger(maxBufferedEvents) || maxBufferedEvents < 1)
      throw new TypeError('eventBuffer.maxEvents must be a positive integer');
    const { ai, model } = await createAgentRuntime(options);
    const toolExecutionCoordinator = createEphemeralToolExecutionCoordinator();
    const transcript: Message[] = [];
    let running = false;
    let activeAbortController: AbortController | undefined;
    let activeRunPromise: Promise<AgentRunResult> | undefined;
    let disposed = false;
    let disposePromise: Promise<void> | undefined;

    const assertNotDisposed = () => {
      if (disposed)
        throw new AgentError('AGENT_DISPOSED', 'Agent has been disposed');
    };

    const startRun = (
      input: AgentInput,
      runOptions?: AgentRunOptions,
      emit?: Parameters<typeof runAgentLoop>[0]['emit'],
      suppliedAbortController?: AbortController,
    ) => {
      assertNotDisposed();
      if (running)
        throw new AgentError(
          'AGENT_ALREADY_RUNNING',
          'Agent is already running',
        );
      running = true;
      const runAbortController =
        suppliedAbortController ?? new AbortController();
      activeAbortController = runAbortController;
      const signal = runOptions?.signal
        ? AbortSignal.any([runOptions.signal, runAbortController.signal])
        : runAbortController.signal;

      const runPromise = runAgentLoop({
        ai,
        model,
        prompt: input,
        systemPrompt: options.systemPrompt,
        transcript,
        tools,
        maxTurns,
        signal,
        streamOptions: options.streamOptions,
        credentialOverride: options.model.readOptions?.credentialOverride,
        toolExecutionCoordinator,
        emit,
      })
        .then((result) => {
          transcript.splice(0, transcript.length, ...result.transcript);
          return result;
        })
        .finally(() => {
          if (activeAbortController === runAbortController)
            activeAbortController = undefined;
          running = false;
          if (activeRunPromise === runPromise) activeRunPromise = undefined;
        });
      activeRunPromise = runPromise;
      return runPromise;
    };

    const dispose = () => {
      if (disposePromise) return disposePromise;
      disposed = true;
      activeAbortController?.abort('Agent disposed');
      const pendingRun = activeRunPromise;
      disposePromise = (async () => {
        await pendingRun?.catch(() => undefined);
        await ai.dispose();
      })();
      return disposePromise;
    };

    return Object.freeze({
      get transcript() {
        return Object.freeze([...transcript]);
      },
      get isRunning() {
        return running;
      },
      run: (input: AgentInput, runOptions?: AgentRunOptions) =>
        startRun(input, runOptions),
      stream: (input: AgentInput, runOptions?: AgentRunOptions) => {
        const streamAbortController = new AbortController();
        return createAgentEventStream(
          (emit) => startRun(input, runOptions, emit, streamAbortController),
          (reason) => streamAbortController.abort(reason),
          maxBufferedEvents,
        );
      },
      abort: (reason?: string) => activeAbortController?.abort(reason),
      reset: () => {
        assertNotDisposed();
        if (running)
          throw new AgentError(
            'AGENT_RESET_WHILE_RUNNING',
            'Cannot reset Agent while it is running',
          );
        transcript.splice(0);
      },
      dispose,
    });
  } catch (cause) {
    throw new AgentError(
      'AGENT_INITIALIZATION_FAILED',
      'Failed to initialize Agent',
      { cause },
    );
  }
}
