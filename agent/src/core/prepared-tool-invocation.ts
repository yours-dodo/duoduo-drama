import type {
  JsonValue,
  Message,
  ToolCallContent,
  ToolResultMessage,
} from '@duoduo/ai';

import { AgentToolExecutionError } from './errors.js';
import type {
  AgentTool,
  AgentToolEffectOutcome,
  AgentToolExecutionStatus,
  AgentToolUpdate,
} from './types.js';
import type { PreparedAgentToolExecution } from './tool-execution.js';

export interface PreparedToolInvocationTerminal {
  readonly status: Extract<
    AgentToolExecutionStatus,
    'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'unknown'
  >;
  readonly effectOutcome: AgentToolEffectOutcome;
  readonly retryable: boolean;
  readonly errorCode?: string;
}

export async function invokePreparedAgentTool(input: {
  readonly call: ToolCallContent;
  readonly tool: AgentTool;
  readonly arguments: JsonValue;
  readonly execution: PreparedAgentToolExecution;
  readonly runSignal: AbortSignal;
  readonly transcript: readonly Message[];
  readonly update: (update: AgentToolUpdate) => void | Promise<void>;
}): Promise<{
  readonly result: ToolResultMessage;
  readonly terminal: PreparedToolInvocationTerminal;
}> {
  let acceptsUpdates = true;
  let updateProcessing = Promise.resolve();
  try {
    const value = await input.tool.execute(input.arguments, {
      signal: input.execution.signal,
      toolCallId: input.call.id,
      toolExecutionId: input.execution.toolExecutionId,
      attempt: input.execution.attempt,
      idempotencyKey: input.execution.idempotencyKey,
      deadline: input.execution.deadline,
      transcript: snapshot(input.transcript),
      update: (update) => {
        if (acceptsUpdates && !input.execution.signal.aborted)
          updateProcessing = updateProcessing.then(() => input.update(update));
      },
    });
    acceptsUpdates = false;
    await updateProcessing;
    if (input.execution.signal.aborted) {
      const result = errorToolResult(input.call, 'Tool execution cancelled');
      return {
        result,
        terminal: classifyToolFailure(
          undefined,
          input.tool.execution.sideEffect,
          input.runSignal.aborted,
          input.execution.timedOut(),
        ),
      };
    }
    if (!value || !Array.isArray(value.content)) {
      const result = errorToolResult(
        input.call,
        'Tool returned an invalid result',
      );
      return {
        result,
        terminal: toolTerminalStatus(
          result,
          input.tool.execution.sideEffect,
          input.runSignal.aborted,
        ),
      };
    }
    const result = Object.freeze({
      role: 'tool_result' as const,
      toolCallId: input.call.id,
      toolName: input.call.name,
      isError: false,
      content: Object.freeze(
        value.content.map((part) => Object.freeze({ ...part })),
      ),
      details: freezeJson(value.details),
    });
    return {
      result,
      terminal: toolTerminalStatus(
        result,
        input.tool.execution.sideEffect,
        input.runSignal.aborted,
      ),
    };
  } catch (cause) {
    acceptsUpdates = false;
    await updateProcessing;
    const result = errorToolResult(
      input.call,
      input.runSignal.aborted
        ? 'Tool execution cancelled'
        : 'Tool execution failed',
    );
    return {
      result,
      terminal: classifyToolFailure(
        cause,
        input.tool.execution.sideEffect,
        input.runSignal.aborted,
        input.execution.timedOut(),
      ),
    };
  } finally {
    input.execution.dispose();
  }
}

function errorToolResult(
  call: ToolCallContent,
  message: string,
): ToolResultMessage {
  return Object.freeze({
    role: 'tool_result' as const,
    toolCallId: call.id,
    toolName: call.name,
    isError: true,
    content: Object.freeze([{ type: 'text' as const, text: message }]),
  });
}

function toolTerminalStatus(
  result: ToolResultMessage,
  sideEffect: AgentTool['execution']['sideEffect'],
  aborted: boolean,
): PreparedToolInvocationTerminal {
  if (!result.isError)
    return {
      status: 'succeeded',
      effectOutcome: sideEffect === 'none' ? 'not_applied' : 'applied',
      retryable: false,
    };
  if (sideEffect !== 'none')
    return { status: 'unknown', effectOutcome: 'unknown', retryable: false };
  return {
    status: aborted ? 'cancelled' : 'failed',
    effectOutcome: 'not_applied',
    retryable: false,
  };
}

function classifyToolFailure(
  cause: unknown,
  sideEffect: AgentTool['execution']['sideEffect'],
  aborted: boolean,
  timedOut: boolean,
): PreparedToolInvocationTerminal {
  if (cause instanceof AgentToolExecutionError) {
    if (cause.effectOutcome === 'unknown')
      return {
        status: 'unknown',
        effectOutcome: 'unknown',
        retryable: false,
        errorCode: cause.code,
      };
    if (cause.effectOutcome === 'applied')
      return {
        status: 'failed',
        effectOutcome: 'applied',
        retryable: cause.retryable,
        errorCode: cause.code,
      };
    return {
      status: cause.kind,
      effectOutcome: 'not_applied',
      retryable: cause.retryable,
      errorCode: cause.code,
    };
  }
  if (sideEffect !== 'none')
    return {
      status: 'unknown',
      effectOutcome: 'unknown',
      retryable: false,
    };
  return {
    status: timedOut ? 'timed_out' : aborted ? 'cancelled' : 'failed',
    effectOutcome: 'not_applied',
    retryable: false,
  };
}

function snapshot<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function freezeJson<T>(value: T): T {
  if (Array.isArray(value))
    return Object.freeze(value.map((item) => freezeJson(item))) as T;
  if (typeof value === 'object' && value !== null) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, freezeJson(item)]),
      ),
    ) as T;
  }
  return value;
}
