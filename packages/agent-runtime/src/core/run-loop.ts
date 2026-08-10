import {
  parseToolArguments,
  toAssistantMessage,
  validateToolArguments,
  type AiResponseStream,
  type AiRuntime,
  type AssistantResponse,
  type Message,
  type ModelHandle,
  type RequestCredentialOverride,
  type StreamOptionsInput,
  type ToolCallContent,
  type ToolResultMessage,
  type UserMessage,
} from '@duoduo/ai';

import type {
  AgentEvent,
  AgentFailure,
  AgentEventStream,
  AgentInput,
  AgentRunResult,
  AgentTool,
} from './types.js';
import type {
  AgentToolAuthorizationResult,
  AgentToolExecutionCoordinator,
} from './tool-execution.js';
import { invokePreparedAgentTool } from './prepared-tool-invocation.js';

type UnsequencedAgentEvent = AgentEvent extends infer TEvent
  ? TEvent extends AgentEvent
    ? Omit<TEvent, 'sequence'>
    : never
  : never;

export interface AgentCheckpointFrame {
  readonly kind:
    | 'model_completed'
    | 'approval_waiting'
    | 'approval_resolved'
    | 'tool_result_appended'
    | 'run_terminal';
  readonly transcript: readonly Message[];
  readonly turnIndex: number;
  readonly executionPosition: 'model' | 'approval' | 'tool' | 'terminal';
  readonly nextTurnIndex?: number;
  readonly result?: AgentRunResult;
}

export interface AgentRunLoopResume {
  readonly initialSequence: number;
  readonly nextTurnIndex: number;
  readonly reenterTurn: boolean;
  readonly modelAttempt: number;
  readonly appendPrompt?: boolean;
}

export async function runAgentLoop<TScopeHandle>(input: {
  readonly ai: AiRuntime<TScopeHandle>;
  readonly model: ModelHandle;
  readonly prompt: AgentInput;
  readonly systemPrompt?: string;
  readonly transcript: readonly Message[];
  readonly tools?: readonly AgentTool[];
  readonly maxTurns?: number;
  readonly signal?: AbortSignal;
  readonly streamOptions?: Omit<
    StreamOptionsInput,
    'signal' | 'credentialOverride'
  >;
  readonly credentialOverride?: RequestCredentialOverride;
  readonly emit?: (event: AgentEvent) => void | Promise<void>;
  readonly checkpoint?: (frame: AgentCheckpointFrame) => Promise<void>;
  readonly toolExecutionCoordinator: AgentToolExecutionCoordinator;
  readonly resume?: AgentRunLoopResume;
  readonly modelAttemptId?: (input: {
    readonly turn: number;
    readonly attempt: number;
  }) => string;
}): Promise<AgentRunResult> {
  assertRunLoopResume(input.resume);
  let sequence = input.resume?.initialSequence ?? 0;
  const transcript: Message[] = [...input.transcript];
  const sequenceEvent = (event: UnsequencedAgentEvent): AgentEvent =>
    ({ ...event, sequence: ++sequence }) as AgentEvent;
  const publish = async (event: AgentEvent): Promise<void> => {
    await input.emit?.(event);
  };
  const emit = async (event: UnsequencedAgentEvent): Promise<void> =>
    publish(sequenceEvent(event));

  if (!input.resume || input.resume.appendPrompt) {
    transcript.push(toUserMessage(input.prompt));
  }
  if (!input.resume) {
    await emit({ type: 'run_start' });
  }
  const tools = new Map(
    (input.tools ?? []).map((tool) => [tool.definition.name, tool] as const),
  );
  const maxTurns = input.maxTurns ?? 20;

  const initialTurnIndex = input.resume?.nextTurnIndex ?? 1;
  for (let turn = initialTurnIndex; ; turn += 1) {
    const reenteringTurn =
      turn === initialTurnIndex && input.resume?.reenterTurn === true;
    if (!reenteringTurn) await emit({ type: 'turn_start', turn });
    const modelAttempt =
      turn === initialTurnIndex && input.resume ? input.resume.modelAttempt : 1;
    const modelAttemptId = input.modelAttemptId?.({
      turn,
      attempt: modelAttempt,
    });
    const modelStream = input.ai.stream(
      input.model,
      {
        systemPrompt: input.systemPrompt,
        messages: transcript,
        tools: input.tools?.map((tool) => tool.definition),
      },
      {
        ...input.streamOptions,
        credentialOverride: input.credentialOverride,
        signal: input.signal,
      },
    );
    const response = await consumeModelStream(modelStream, turn, emit, {
      modelAttemptId,
      modelAttempt,
    });
    transcript.push(toAssistantMessage(response));
    const toolCalls =
      response.status === 'completed'
        ? response.content.filter(
            (part): part is ToolCallContent => part.type === 'tool_call',
          )
        : [];
    const terminalModelResult: AgentRunResult | undefined =
      response.status === 'cancelled'
        ? cancelledResult(response, turn, transcript)
        : response.status !== 'completed'
          ? failedResult(response, turn, transcript)
          : toolCalls.length === 0
            ? Object.freeze({
                status: 'completed',
                turns: turn,
                response,
                transcript: snapshot(transcript),
              })
            : undefined;
    const modelCheckpoint: AgentCheckpointFrame = {
      kind: 'model_completed',
      transcript: snapshot(transcript),
      turnIndex: turn,
      executionPosition:
        response.status === 'completed' && toolCalls.length > 0
          ? 'tool'
          : 'terminal',
      nextTurnIndex:
        response.status === 'completed' && toolCalls.length > 0
          ? turn
          : undefined,
      result: terminalModelResult,
    };
    if (toolCalls.length > 0 && input.toolExecutionCoordinator.propose)
      await input.toolExecutionCoordinator.propose({
        calls: toolCalls,
        turn,
        checkpoint: modelCheckpoint,
      });
    else await input.checkpoint?.(modelCheckpoint);

    if (response.status !== 'completed') {
      await emit({ type: 'turn_end', turn });
      return endRun(terminalModelResult!, emit, input.checkpoint);
    }

    if (toolCalls.length === 0) {
      await emit({ type: 'turn_end', turn });
      return endRun(terminalModelResult!, emit, input.checkpoint);
    }

    for (let index = 0; index < toolCalls.length; index += 1) {
      const call = toolCalls[index];
      if (!call) continue;
      const executed = await executeTool({
        call,
        tool: tools.get(call.name),
        signal: input.signal ?? new AbortController().signal,
        turn,
        transcript,
        emit,
        sequenceEvent,
        publish,
        coordinator: input.toolExecutionCoordinator,
      });
      transcript.push(executed.result);
      const toolCheckpoint: AgentCheckpointFrame = {
        kind: 'tool_result_appended',
        transcript: snapshot(transcript),
        turnIndex: turn,
        executionPosition:
          executed.runFailure || input.signal?.aborted || turn >= maxTurns
            ? 'terminal'
            : index + 1 < toolCalls.length
              ? 'tool'
              : 'model',
        nextTurnIndex:
          executed.runFailure || input.signal?.aborted || turn >= maxTurns
            ? undefined
            : index + 1 < toolCalls.length
              ? turn
              : turn + 1,
      };
      const terminal = executed.execution
        ? (executed.terminal ??
          toolTerminalStatus(
            executed.result,
            executed.tool?.execution.sideEffect,
            input.signal?.aborted ?? false,
          ))
        : undefined;
      const approvalEvent = executed.approvalResolution
        ? sequenceApprovalResolutionEvent(
            sequenceEvent,
            turn,
            executed.approvalResolution,
          )
        : undefined;
      const endEvent = sequenceEvent({
        type: 'tool_execution_end',
        turn,
        toolCallId: call.id,
        toolExecutionId: executed.execution?.toolExecutionId,
        attempt: executed.execution?.attempt,
        status: terminal?.status,
        effectOutcome: terminal?.effectOutcome,
        result: executed.result,
      });
      if (
        executed.approvalResolution &&
        approvalEvent &&
        input.toolExecutionCoordinator.consumeRejectedApproval
      ) {
        await input.toolExecutionCoordinator.consumeRejectedApproval({
          authorization: executed.approvalResolution,
          approvalEvent,
          endEvent: endEvent as Extract<
            AgentEvent,
            { type: 'tool_execution_end' }
          >,
          checkpoint: toolCheckpoint,
          result: executed.result,
        });
      } else if (
        executed.rejectionReason &&
        input.toolExecutionCoordinator.reject
      ) {
        await input.toolExecutionCoordinator.reject({
          toolCallId: call.id,
          event: endEvent as Extract<
            AgentEvent,
            { type: 'tool_execution_end' }
          >,
          checkpoint: toolCheckpoint,
          reasonCode: executed.rejectionReason,
          result: executed.result,
        });
      } else if (executed.execution && input.toolExecutionCoordinator.finish) {
        await input.toolExecutionCoordinator.finish({
          execution: executed.execution,
          event: endEvent as Extract<
            AgentEvent,
            { type: 'tool_execution_end' }
          >,
          checkpoint: toolCheckpoint,
          ...terminal!,
          result: executed.result,
        });
      } else {
        await publish(endEvent);
        await input.checkpoint?.(toolCheckpoint);
      }
      if (executed.runFailure) {
        await emit({ type: 'turn_end', turn });
        return endRun(
          Object.freeze({
            status: 'failed',
            turns: turn,
            error: executed.runFailure,
            transcript: snapshot(transcript),
          }),
          emit,
          input.checkpoint,
        );
      }
      if (input.signal?.aborted) {
        for (const remainingCall of toolCalls.slice(index + 1)) {
          const cancelled = errorToolResult(
            remainingCall,
            'Tool execution skipped because the run was cancelled',
          );
          await emit({
            type: 'tool_execution_start',
            turn,
            toolCallId: remainingCall.id,
            toolName: remainingCall.name,
          });
          await emit({
            type: 'tool_execution_end',
            turn,
            toolCallId: remainingCall.id,
            result: cancelled,
          });
          transcript.push(cancelled);
          await input.checkpoint?.({
            kind: 'tool_result_appended',
            transcript: snapshot(transcript),
            turnIndex: turn,
            executionPosition: 'terminal',
          });
        }
        await emit({ type: 'turn_end', turn });
        return endRun(
          cancelledBySignalResult(turn, transcript),
          emit,
          input.checkpoint,
        );
      }
    }
    await emit({ type: 'turn_end', turn });
    if (turn >= maxTurns)
      return endRun(maxTurnsResult(turn, transcript), emit, input.checkpoint);
  }
}

export function createAgentEventStream(
  start: (emit: (event: AgentEvent) => void) => Promise<AgentRunResult>,
  abort: (reason?: string) => void,
  maxEvents: number,
): AgentEventStream {
  const queue = new EventQueue<AgentEvent>(maxEvents);
  let overflowed = false;
  let lastSequence = 0;
  const resultPromise = start((event) => {
    lastSequence = event.sequence;
    if (overflowed) return;
    if (!queue.push(event)) {
      overflowed = true;
      abort('Agent event buffer overflow');
    }
  })
    .then((result) => {
      if (!overflowed) return result;
      const overflowResult: AgentRunResult = Object.freeze({
        status: 'failed',
        turns: result.turns,
        error: Object.freeze({
          code: 'AGENT_EVENT_BUFFER_OVERFLOW',
          category: 'stream',
          message: 'Agent event buffer overflowed',
          retryable: false,
        }),
        transcript: result.transcript,
      });
      queue.replaceWithTerminal({
        type: 'run_end',
        sequence: lastSequence,
        result: overflowResult,
      });
      return overflowResult;
    })
    .finally(() => queue.end());

  return Object.freeze({
    [Symbol.asyncIterator]: () => queue.iterator(),
    result: () => resultPromise,
    abort,
  });
}

async function consumeModelStream(
  stream: AiResponseStream,
  turn: number,
  emit: (event: UnsequencedAgentEvent) => Promise<void>,
  correlation: {
    readonly modelAttemptId?: string;
    readonly modelAttempt: number;
  },
): Promise<AssistantResponse> {
  const attempt = correlation.modelAttemptId
    ? {
        modelAttemptId: correlation.modelAttemptId,
        modelAttempt: correlation.modelAttempt,
      }
    : {};
  for await (const event of stream) {
    if (event.type === 'response_start') {
      await emit({
        type: 'model_start',
        turn,
        requestId: event.requestId,
        ...attempt,
      });
    } else if (event.type === 'text_delta') {
      await emit({
        type: 'text_delta',
        turn,
        itemId: event.itemId,
        contentIndex: event.contentIndex,
        delta: event.delta,
        ...attempt,
      });
    } else if (event.type === 'reasoning_delta') {
      await emit({
        type: 'reasoning_delta',
        turn,
        itemId: event.itemId,
        contentIndex: event.contentIndex,
        delta: event.delta,
        ...attempt,
      });
    } else if (event.type === 'tool_call_delta') {
      await emit({
        type: 'tool_call_delta',
        turn,
        itemId: event.itemId,
        contentIndex: event.contentIndex,
        argumentsDelta: event.argumentsDelta,
        nameDelta: event.nameDelta,
        ...attempt,
      });
    } else if (
      event.type === 'response_end' ||
      event.type === 'response_error'
    ) {
      await emit({
        type: 'model_end',
        turn,
        response: event.response,
        ...attempt,
      });
    }
  }

  return stream.result();
}

function assertRunLoopResume(resume: AgentRunLoopResume | undefined): void {
  if (!resume) return;
  if (
    !Number.isSafeInteger(resume.initialSequence) ||
    resume.initialSequence < 0 ||
    !Number.isSafeInteger(resume.nextTurnIndex) ||
    resume.nextTurnIndex < 1 ||
    !Number.isSafeInteger(resume.modelAttempt) ||
    resume.modelAttempt < 1
  )
    throw new TypeError('Agent Run resume cursor is invalid');
}

async function executeTool(input: {
  readonly call: ToolCallContent;
  readonly tool: AgentTool | undefined;
  readonly signal: AbortSignal;
  readonly turn: number;
  readonly transcript: Message[];
  readonly emit: (event: UnsequencedAgentEvent) => Promise<void>;
  readonly sequenceEvent: (event: UnsequencedAgentEvent) => AgentEvent;
  readonly publish: (event: AgentEvent) => Promise<void>;
  readonly coordinator: AgentToolExecutionCoordinator;
}): Promise<ExecutedTool> {
  const tool = input.tool;
  if (!tool) {
    if (!input.coordinator.reject) await emitRejectedToolStart(input);
    return {
      result: errorToolResult(input.call, 'Tool is not available'),
      rejectionReason: 'TOOL_UNAVAILABLE',
    };
  }

  const parsed = parseToolArguments(input.call.rawArguments);
  if (!parsed.ok) {
    if (!input.coordinator.reject) await emitRejectedToolStart(input);
    return {
      result: errorToolResult(input.call, 'Tool arguments are invalid'),
      rejectionReason: 'TOOL_ARGUMENTS_INVALID',
    };
  }
  const validated = validateToolArguments(tool.definition, parsed.value);
  if (!validated.valid) {
    if (!input.coordinator.reject) await emitRejectedToolStart(input);
    return {
      result: errorToolResult(input.call, 'Tool arguments are invalid'),
      rejectionReason: 'TOOL_ARGUMENTS_INVALID',
    };
  }

  if (input.signal.aborted) {
    if (!input.coordinator.reject) await emitRejectedToolStart(input);
    return {
      result: errorToolResult(input.call, 'Tool execution cancelled'),
      rejectionReason: 'TOOL_CANCELLED_BEFORE_INVOCATION',
    };
  }

  const arguments_ = freezeJson(validated.value);
  let authorization = input.coordinator.authorize
    ? await input.coordinator.authorize({
        tool,
        toolCallId: input.call.id,
        turn: input.turn,
        arguments: arguments_,
      })
    : ({ decision: 'allow' } as const);
  if (authorization.decision === 'require_approval') {
    const approvalEvent = input.sequenceEvent({
      type: 'approval_requested',
      turn: input.turn,
      approvalId: authorization.approvalId,
      toolExecutionId: authorization.toolExecutionId,
      policyId: authorization.policyId,
      policyVersion: authorization.policyVersion,
      expiresAt: authorization.expiresAt,
      presentation: authorization.presentation,
    });
    authorization = input.coordinator.requestApproval
      ? await input.coordinator.requestApproval({
          authorization,
          tool,
          toolCallId: input.call.id,
          turn: input.turn,
          event: approvalEvent as Extract<
            AgentEvent,
            { type: 'approval_requested' }
          >,
          checkpoint: {
            kind: 'approval_waiting',
            transcript: snapshot(input.transcript),
            turnIndex: input.turn,
            executionPosition: 'approval',
            nextTurnIndex: input.turn,
          },
          signal: input.signal,
        })
      : {
          decision: 'policy_failed',
          errorCode: 'AGENT_APPROVAL_POLICY_FAILED',
        };
  }
  let approvedExecution:
    Awaited<ReturnType<AgentToolExecutionCoordinator['prepare']>> | undefined;
  if (authorization.decision === 'approved') {
    const decidedEvent = input.sequenceEvent({
      type: 'approval_decided',
      turn: input.turn,
      approvalId: authorization.approvalId,
      toolExecutionId: authorization.toolExecutionId,
      decision: 'approved',
      decidedBy: authorization.decidedBy,
      reasonCode: authorization.reasonCode,
    });
    if (!input.coordinator.consumeApprovedApproval)
      authorization = {
        decision: 'policy_failed',
        errorCode: 'AGENT_APPROVAL_POLICY_FAILED',
      };
    else {
      approvedExecution = await input.coordinator.consumeApprovedApproval({
        authorization,
        tool,
        toolCallId: input.call.id,
        event: decidedEvent as Extract<
          AgentEvent,
          { type: 'approval_decided' }
        >,
        checkpoint: {
          kind: 'approval_resolved',
          transcript: snapshot(input.transcript),
          turnIndex: input.turn,
          executionPosition: 'tool',
          nextTurnIndex: input.turn,
        },
        signal: input.signal,
      });
      authorization = { decision: 'allow' };
    }
  }
  if (
    authorization.decision === 'approval_denied' ||
    authorization.decision === 'approval_expired' ||
    authorization.decision === 'approval_cancelled'
  )
    return {
      result: errorToolResult(
        input.call,
        authorization.decision === 'approval_expired'
          ? 'Tool approval expired'
          : authorization.decision === 'approval_cancelled'
            ? 'Tool execution cancelled'
            : 'Tool execution denied',
      ),
      approvalResolution: authorization,
    };
  if (authorization.decision === 'deny')
    return {
      result: errorToolResult(input.call, 'Tool execution denied'),
      rejectionReason: 'POLICY_DENIED',
    };
  if (authorization.decision === 'policy_failed')
    return {
      result: errorToolResult(input.call, 'Tool approval policy failed'),
      rejectionReason:
        authorization.errorCode === 'AGENT_APPROVAL_PRESENTATION_INVALID'
          ? 'PRESENTATION_INVALID'
          : 'POLICY_FAILED',
      runFailure: approvalPolicyFailure(authorization.errorCode),
    };

  const prepared =
    approvedExecution ??
    (await input.coordinator.prepare({
      tool,
      toolCallId: input.call.id,
      signal: input.signal,
    }));
  const startEvent = input.sequenceEvent({
    type: 'tool_execution_start',
    turn: input.turn,
    toolCallId: input.call.id,
    toolName: input.call.name,
    toolExecutionId: prepared.toolExecutionId,
    attempt: prepared.attempt,
  });
  try {
    if (input.coordinator.start)
      await input.coordinator.start({
        execution: prepared,
        event: startEvent as Extract<
          AgentEvent,
          { type: 'tool_execution_start' }
        >,
      });
    else await input.publish(startEvent);
  } catch (cause) {
    prepared.dispose();
    throw cause;
  }
  const invocation = await invokePreparedAgentTool({
    call: input.call,
    tool,
    arguments: arguments_,
    execution: prepared,
    runSignal: input.signal,
    transcript: input.transcript,
    update: (update) =>
      input.emit({
        type: 'tool_execution_update',
        turn: input.turn,
        toolCallId: input.call.id,
        toolExecutionId: prepared.toolExecutionId,
        attempt: prepared.attempt,
        update,
      }),
  });
  return {
    result: invocation.result,
    execution: prepared,
    tool,
    terminal: invocation.terminal,
  };
}

interface ExecutedTool {
  readonly result: ToolResultMessage;
  readonly execution?: Awaited<
    ReturnType<AgentToolExecutionCoordinator['prepare']>
  >;
  readonly tool?: AgentTool;
  readonly rejectionReason?:
    | 'TOOL_UNAVAILABLE'
    | 'TOOL_ARGUMENTS_INVALID'
    | 'TOOL_CANCELLED_BEFORE_INVOCATION'
    | 'POLICY_DENIED'
    | 'POLICY_FAILED'
    | 'PRESENTATION_INVALID';
  readonly runFailure?: Extract<
    AgentFailure,
    {
      readonly code:
        'AGENT_APPROVAL_POLICY_FAILED' | 'AGENT_APPROVAL_PRESENTATION_INVALID';
    }
  >;
  readonly approvalResolution?: Extract<
    AgentToolAuthorizationResult,
    {
      readonly decision:
        'approval_denied' | 'approval_expired' | 'approval_cancelled';
    }
  >;
  readonly terminal?: ToolTerminalStatus;
}

function sequenceApprovalResolutionEvent(
  sequenceEvent: (event: UnsequencedAgentEvent) => AgentEvent,
  turn: number,
  resolution: NonNullable<ExecutedTool['approvalResolution']>,
): Extract<
  AgentEvent,
  {
    type: 'approval_decided' | 'approval_expired' | 'approval_cancelled';
  }
> {
  if (resolution.decision === 'approval_denied')
    return sequenceEvent({
      type: 'approval_decided',
      turn,
      approvalId: resolution.approvalId,
      toolExecutionId: resolution.toolExecutionId,
      decision: 'denied',
      decidedBy: resolution.decidedBy!,
      reasonCode: resolution.reasonCode,
    }) as Extract<AgentEvent, { type: 'approval_decided' }>;
  return sequenceEvent({
    type:
      resolution.decision === 'approval_expired'
        ? 'approval_expired'
        : 'approval_cancelled',
    turn,
    approvalId: resolution.approvalId,
    toolExecutionId: resolution.toolExecutionId,
  }) as Extract<
    AgentEvent,
    { type: 'approval_expired' | 'approval_cancelled' }
  >;
}

async function emitRejectedToolStart(input: {
  readonly call: ToolCallContent;
  readonly turn: number;
  readonly emit: (event: UnsequencedAgentEvent) => Promise<void>;
}): Promise<void> {
  await input.emit({
    type: 'tool_execution_start',
    turn: input.turn,
    toolCallId: input.call.id,
    toolName: input.call.name,
  });
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

function approvalPolicyFailure(
  code: 'AGENT_APPROVAL_POLICY_FAILED' | 'AGENT_APPROVAL_PRESENTATION_INVALID',
): Extract<
  AgentFailure,
  {
    readonly code:
      'AGENT_APPROVAL_POLICY_FAILED' | 'AGENT_APPROVAL_PRESENTATION_INVALID';
  }
> {
  return Object.freeze({
    code,
    category: 'approval',
    message:
      code === 'AGENT_APPROVAL_PRESENTATION_INVALID'
        ? 'Agent approval presentation is invalid'
        : 'Agent approval policy failed',
    retryable: false,
  });
}

interface ToolTerminalStatus {
  readonly status:
    'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'unknown';
  readonly effectOutcome: 'not_applied' | 'applied' | 'unknown';
  readonly retryable: boolean;
  readonly errorCode?: string;
}

function toolTerminalStatus(
  result: ToolResultMessage,
  sideEffect: AgentTool['execution']['sideEffect'] | undefined,
  aborted: boolean,
): ToolTerminalStatus {
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

async function endRun(
  result: AgentRunResult,
  emit: (event: UnsequencedAgentEvent) => Promise<void>,
  checkpoint?: (frame: AgentCheckpointFrame) => Promise<void>,
): Promise<AgentRunResult> {
  await checkpoint?.({
    kind: 'run_terminal',
    transcript: result.transcript,
    turnIndex: result.turns,
    executionPosition: 'terminal',
    result,
  });
  await emit({ type: 'run_end', result });
  return result;
}

function failedResult(
  response: Exclude<AssistantResponse, { status: 'completed' | 'cancelled' }>,
  turns: number,
  transcript: readonly Message[],
): AgentRunResult {
  return Object.freeze({
    status: 'failed',
    turns,
    error: Object.freeze({
      code: 'AGENT_MODEL_FAILED',
      category: 'model',
      message: response.error.message,
      retryable: response.error.retryable,
    }),
    transcript: snapshot(transcript),
  });
}

function cancelledResult(
  response: Extract<AssistantResponse, { status: 'cancelled' }>,
  turns: number,
  transcript: readonly Message[],
): AgentRunResult {
  return Object.freeze({
    status: 'cancelled',
    turns,
    error: Object.freeze({
      code: 'AGENT_CANCELLED',
      category: 'cancelled',
      message: response.error.message,
      retryable: false,
    }),
    transcript: snapshot(transcript),
  });
}

function maxTurnsResult(
  turns: number,
  transcript: readonly Message[],
): AgentRunResult {
  return Object.freeze({
    status: 'failed',
    turns,
    error: Object.freeze({
      code: 'AGENT_MAX_TURNS',
      category: 'limit',
      message: 'Agent reached the maximum number of model turns',
      retryable: false,
    }),
    transcript: snapshot(transcript),
  });
}

function cancelledBySignalResult(
  turns: number,
  transcript: readonly Message[],
): AgentRunResult {
  return Object.freeze({
    status: 'cancelled',
    turns,
    error: Object.freeze({
      code: 'AGENT_CANCELLED',
      category: 'cancelled',
      message: 'Agent run was cancelled',
      retryable: false,
    }),
    transcript: snapshot(transcript),
  });
}

function snapshot<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function toUserMessage(input: AgentInput): UserMessage {
  if (typeof input !== 'string') {
    return Object.freeze({
      ...input,
      content: Object.freeze(
        input.content.map((part) => Object.freeze({ ...part })),
      ),
      details: freezeJson(input.details),
      addedToolNames: input.addedToolNames
        ? Object.freeze([...input.addedToolNames])
        : undefined,
    });
  }

  return Object.freeze({
    role: 'user',
    content: Object.freeze([{ type: 'text' as const, text: input }]),
  });
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

class EventQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;
  private iterated = false;

  constructor(private readonly maxValues: number) {}

  push(value: T): boolean {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value });
      return true;
    }
    if (this.values.length >= this.maxValues) return false;
    this.values.push(value);
    return true;
  }

  replaceWithTerminal(value: T): void {
    this.values.splice(0);
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  end(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0))
      waiter({ done: true, value: undefined });
  }

  iterator(): AsyncIterator<T> {
    if (this.iterated)
      throw new TypeError('Agent event stream supports one consumer');
    this.iterated = true;

    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined)
          return Promise.resolve({ done: false as const, value });
        if (this.ended)
          return Promise.resolve({ done: true as const, value: undefined });
        return new Promise<IteratorResult<T>>((resolve) =>
          this.waiters.push(resolve),
        );
      },
    };
  }
}
