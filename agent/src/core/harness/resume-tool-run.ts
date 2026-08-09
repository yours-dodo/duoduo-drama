import {
  parseToolArguments,
  validateToolArguments,
  type JsonValue,
  type Message,
  type ToolCallContent,
  type ToolResultMessage,
} from '@duoduo/ai';

import { invokePreparedAgentTool } from '../prepared-tool-invocation.js';
import type { PreparedAgentToolExecution } from '../tool-execution.js';
import type { AgentEvent, AgentTool } from '../types.js';
import { hashRuntimeCommit } from './commit-hash.js';
import type { AgentRecoveryPlan } from './recovery-plan.js';
import type {
  AgentRunExecutionLease,
  AgentRunRecoverySnapshot,
  AgentRuntimeCheckpointWrite,
  AgentRuntimeStore,
  AgentToolExecutionSnapshot,
} from './runtime-store.js';
import { toHarnessPayload } from './runtime-event.js';
import type {
  AgentClock,
  AgentHarnessEvent,
  AgentIdGenerator,
  AgentTimer,
} from './types.js';

type ToolRecoveryPlan =
  | Extract<AgentRecoveryPlan, { readonly kind: 'continue_tools' }>
  | Extract<AgentRecoveryPlan, { readonly kind: 'reprepare_tool' }>;

type NextToolRecoveryPlan =
  | Extract<AgentRecoveryPlan, { readonly kind: 'continue_tools' }>
  | Extract<AgentRecoveryPlan, { readonly kind: 'continue_model' }>;

export interface AgentToolRecoveryResult {
  readonly plan: NextToolRecoveryPlan;
  readonly toolExecutionId?: string;
  readonly attempt?: number;
}

export async function resumeAgentToolRun(input: {
  readonly runtimeStore: AgentRuntimeStore;
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly lease: AgentRunExecutionLease;
  readonly plan: ToolRecoveryPlan;
  readonly tools: readonly AgentTool[];
  readonly ids: AgentIdGenerator;
  readonly clock: AgentClock;
  readonly timer: AgentTimer;
  readonly signal?: AbortSignal;
}): Promise<AgentToolRecoveryResult> {
  assertLeaseMatchesSnapshot(input.snapshot, input.lease);
  const run = input.snapshot.task.runs.find(
    (candidate) => candidate.runId === input.snapshot.runId,
  );
  const reconstruction = reconstructAgentToolBoundary(
    input.snapshot,
    input.plan,
  );
  const turn = run?.turns.find(
    (candidate) => candidate.turnIndex === reconstruction.turnIndex,
  );
  if (!run || !turn || turn.status !== 'running')
    throw new TypeError('Agent tool recovery Turn is invalid');
  if (input.signal?.aborted)
    throw new TypeError('Agent tool recovery was cancelled before invocation');

  const candidate = reconstruction.nextExecution;
  if (!candidate)
    return finishRecoveredToolBoundary({
      ...input,
      turnId: turn.turnId,
      turnIndex: reconstruction.turnIndex,
      transcript: input.snapshot.checkpoint.transcript,
      stateVersion: input.snapshot.task.version,
      sequence: input.snapshot.lastEventSequence,
    });
  if (
    input.plan.kind === 'reprepare_tool' &&
    candidate.toolExecutionId !== input.plan.toolExecutionId
  )
    throw new TypeError('Agent tool recovery plan does not match call order');
  if (candidate.status !== 'prepared')
    throw new TypeError(
      `Agent tool recovery cannot resume ${candidate.status} before S06/S07`,
    );
  if (candidate.attempts.some((attempt) => attempt.status === 'running'))
    throw new TypeError('Prepared Agent tool execution has a running Attempt');

  const call = reconstruction.calls[reconstruction.nextIndex];
  if (!call) throw new TypeError('Agent tool recovery call is missing');
  const tool = input.tools.find(
    (candidateTool) => candidateTool.definition.name === call.name,
  );
  if (!tool) throw new TypeError('Agent tool recovery tool is unavailable');
  assertAgentRecoveryExecutionDeclaration(candidate, tool);
  const arguments_ = parseAndValidateArguments(call, tool);

  let stateVersion = input.snapshot.task.version;
  let sequence = input.snapshot.lastEventSequence;
  const lease = {
    leaseToken: input.lease.leaseToken,
    fencingToken: input.lease.fencingToken,
  };
  const refreshedAt = input.clock.now();
  const deadline = addMilliseconds(refreshedAt, tool.execution.timeoutMs);
  stateVersion = (
    await input.runtimeStore.commitTask({
      ...scope(input.snapshot),
      commitId: nextId(input.ids, 'commit'),
      expectedVersion: stateVersion,
      mutations: [],
      toolExecutions: [
        {
          type: 'tool_execution_reprepared',
          toolExecutionId: candidate.toolExecutionId,
          deadline,
          reasonCode: 'RECOVERY_RESUME',
        },
      ],
      lease,
      now: refreshedAt,
    })
  ).version;

  const attempt = candidate.attemptCount + 1;
  const attemptId = nextId(input.ids, 'tool_attempt');
  const startedAt = input.clock.now();
  const startEvent = toHarnessEvent({
    event: {
      type: 'tool_execution_start',
      sequence: ++sequence,
      turn: reconstruction.turnIndex,
      toolCallId: call.id,
      toolName: call.name,
      toolExecutionId: candidate.toolExecutionId,
      attemptId,
      attempt,
    },
    snapshot: input.snapshot,
    turnId: turn.turnId,
    eventId: nextId(input.ids, 'event'),
    occurredAt: startedAt,
  });
  stateVersion = (
    await input.runtimeStore.commitTask({
      ...scope(input.snapshot),
      commitId: nextId(input.ids, 'commit'),
      expectedVersion: stateVersion,
      mutations: [],
      toolExecutions: [
        {
          type: 'tool_execution_started',
          toolExecutionId: candidate.toolExecutionId,
          attemptId,
          attempt,
        },
      ],
      events: [startEvent],
      lease,
      now: startedAt,
    })
  ).version;

  const runSignal = input.signal ?? new AbortController().signal;
  const timeoutController = new AbortController();
  let timedOut = false;
  const cancelTimeout = input.timer.schedule(tool.execution.timeoutMs, () => {
    timedOut = true;
    timeoutController.abort('Agent tool execution timed out');
  });
  const execution: PreparedAgentToolExecution = Object.freeze({
    toolExecutionId: candidate.toolExecutionId,
    attempt,
    idempotencyKey: candidate.idempotencyKey,
    deadline,
    signal: AbortSignal.any([runSignal, timeoutController.signal]),
    timedOut: () => timedOut,
    dispose: cancelTimeout,
  });
  const invocation = await invokePreparedAgentTool({
    call,
    tool,
    arguments: arguments_,
    execution,
    runSignal,
    transcript: input.snapshot.checkpoint.transcript,
    update: async (update) => {
      const occurredAt = input.clock.now();
      const event = toHarnessEvent({
        event: {
          type: 'tool_execution_update',
          sequence: ++sequence,
          turn: reconstruction.turnIndex,
          toolCallId: call.id,
          toolExecutionId: candidate.toolExecutionId,
          attempt,
          update,
        },
        snapshot: input.snapshot,
        turnId: turn.turnId,
        eventId: nextId(input.ids, 'event'),
        occurredAt,
      });
      stateVersion = (
        await input.runtimeStore.commitTask({
          ...scope(input.snapshot),
          commitId: nextId(input.ids, 'commit'),
          expectedVersion: stateVersion,
          mutations: [],
          events: [event],
          lease,
          now: occurredAt,
        })
      ).version;
    },
  });

  const transcript = Object.freeze([
    ...input.snapshot.checkpoint.transcript,
    invocation.result,
  ]);
  const nextExecution = reconstruction.executions[reconstruction.nextIndex + 1];
  const nextPlan: NextToolRecoveryPlan = nextExecution
    ? Object.freeze({
        kind: 'continue_tools',
        turnIndex: reconstruction.turnIndex,
        nextProposalSequence: nextExecution.proposalSequence,
      })
    : Object.freeze({
        kind: 'continue_model',
        nextTurnIndex: reconstruction.turnIndex + 1,
      });
  const finishedAt = input.clock.now();
  const endEvent = toHarnessEvent({
    event: {
      type: 'tool_execution_end',
      sequence: ++sequence,
      turn: reconstruction.turnIndex,
      toolCallId: call.id,
      toolExecutionId: candidate.toolExecutionId,
      attemptId,
      attempt,
      ...invocation.terminal,
      result: invocation.result,
    },
    snapshot: input.snapshot,
    turnId: turn.turnId,
    eventId: nextId(input.ids, 'event'),
    occurredAt: finishedAt,
  });
  const events: AgentHarnessEvent[] = [endEvent];
  if (nextPlan.kind === 'continue_model')
    events.push(
      toHarnessEvent({
        event: {
          type: 'turn_end',
          sequence: ++sequence,
          turn: reconstruction.turnIndex,
        },
        snapshot: input.snapshot,
        turnId: turn.turnId,
        eventId: nextId(input.ids, 'event'),
        occurredAt: finishedAt,
      }),
    );
  await input.runtimeStore.commitTask({
    ...scope(input.snapshot),
    commitId: nextId(input.ids, 'commit'),
    expectedVersion: stateVersion,
    mutations:
      nextPlan.kind === 'continue_model'
        ? [
            {
              type: 'turn_finished',
              turnIndex: reconstruction.turnIndex,
              status: 'completed',
            },
          ]
        : [],
    toolExecutions: [
      {
        type: 'tool_execution_finished',
        toolExecutionId: candidate.toolExecutionId,
        attemptId,
        ...invocation.terminal,
        resultDigest: hashRuntimeCommit(invocation.result),
      },
    ],
    events,
    checkpoint: checkpointAfterTool(
      input.snapshot,
      reconstruction.turnIndex,
      transcript,
      nextPlan,
    ),
    lease,
    now: finishedAt,
  });

  return Object.freeze({
    plan: nextPlan,
    toolExecutionId: candidate.toolExecutionId,
    attempt,
  });
}

export interface AgentToolBoundaryReconstruction {
  readonly turnIndex: number;
  readonly calls: readonly ToolCallContent[];
  readonly executions: readonly AgentToolExecutionSnapshot[];
  readonly nextIndex: number;
  readonly nextExecution?: AgentToolExecutionSnapshot;
}

export function reconstructAgentToolBoundary(
  snapshot: AgentRunRecoverySnapshot,
  plan: ToolRecoveryPlan,
): AgentToolBoundaryReconstruction {
  const turnIndex =
    plan.kind === 'continue_tools'
      ? plan.turnIndex
      : snapshot.toolExecutions.find(
          (execution) => execution.toolExecutionId === plan.toolExecutionId,
        )?.turnIndex;
  if (!turnIndex)
    throw new TypeError('Agent tool recovery Turn cursor is invalid');
  const transcript = snapshot.checkpoint.transcript;
  let assistantIndex = -1;
  let calls: readonly ToolCallContent[] = [];
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const message = transcript[index];
    if (message?.role !== 'assistant') continue;
    const candidateCalls = message.content.filter(
      (part): part is ToolCallContent => part.type === 'tool_call',
    );
    if (candidateCalls.length === 0) continue;
    assistantIndex = index;
    calls = candidateCalls;
    break;
  }
  if (assistantIndex < 0)
    throw new TypeError('Agent tool recovery assistant message is missing');
  const executions = snapshot.toolExecutions
    .filter((execution) => execution.turnIndex === turnIndex)
    .sort((left, right) => left.proposalSequence - right.proposalSequence);
  if (calls.length !== executions.length)
    throw new TypeError('Agent tool recovery Ledger length is invalid');
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]!;
    const execution = executions[index]!;
    if (
      call.id !== execution.toolCallId ||
      call.name !== execution.toolName ||
      hashRuntimeCommit(call.rawArguments) !== execution.argumentsDigest ||
      (index > 0 &&
        execution.proposalSequence !==
          executions[index - 1]!.proposalSequence + 1)
    )
      throw new TypeError('Agent tool recovery Ledger order is invalid');
  }
  const results = transcript.slice(assistantIndex + 1);
  if (results.some((message) => message.role !== 'tool_result'))
    throw new TypeError('Agent tool recovery transcript boundary is invalid');
  const resultByCall = new Map<string, ToolResultMessage>();
  for (const message of results) {
    if (message.role !== 'tool_result') continue;
    if (resultByCall.has(message.toolCallId))
      throw new TypeError('Agent tool recovery result is duplicated');
    resultByCall.set(message.toolCallId, message);
  }
  const initialIndex =
    plan.kind === 'continue_tools'
      ? executions.findIndex(
          (execution) =>
            execution.proposalSequence === plan.nextProposalSequence,
        )
      : executions.findIndex(
          (execution) => execution.toolExecutionId === plan.toolExecutionId,
        );
  if (initialIndex < 0)
    throw new TypeError('Agent tool recovery proposal cursor is invalid');
  let nextIndex = initialIndex;
  for (let index = 0; index < executions.length; index += 1) {
    const execution = executions[index]!;
    const result = resultByCall.get(execution.toolCallId);
    if (index < nextIndex || isSkippableTerminal(execution.status)) {
      if (!result || result.toolName !== execution.toolName)
        throw new TypeError('Agent tool recovery completed result is missing');
      if (index >= nextIndex) nextIndex = index + 1;
      continue;
    }
    if (result)
      throw new TypeError('Agent tool recovery unfinished result is invalid');
  }
  if (
    executions
      .slice(nextIndex + 1)
      .some((execution) => isSkippableTerminal(execution.status))
  )
    throw new TypeError('Agent tool recovery completion order is invalid');
  return Object.freeze({
    turnIndex,
    calls: Object.freeze([...calls]),
    executions: Object.freeze(executions),
    nextIndex,
    nextExecution: executions[nextIndex],
  });
}

function isSkippableTerminal(
  status: AgentToolExecutionSnapshot['status'],
): boolean {
  return ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(status);
}

export function assertAgentRecoveryExecutionDeclaration(
  execution: AgentToolExecutionSnapshot,
  tool: AgentTool,
): void {
  if (
    execution.sideEffect !== tool.execution.sideEffect ||
    execution.idempotency !== tool.execution.idempotency ||
    execution.timeoutMs !== tool.execution.timeoutMs ||
    (execution.idempotency === 'keyed') !==
      (execution.idempotencyKey !== undefined)
  )
    throw new TypeError('Agent tool recovery declaration is incompatible');
}

function parseAndValidateArguments(
  call: ToolCallContent,
  tool: AgentTool,
): JsonValue {
  const parsed = parseToolArguments(call.rawArguments);
  if (!parsed.ok)
    throw new TypeError('Agent tool recovery arguments are invalid');
  const validated = validateToolArguments(tool.definition, parsed.value);
  if (!validated.valid)
    throw new TypeError('Agent tool recovery arguments are invalid');
  return freezeJson(validated.value);
}

async function finishRecoveredToolBoundary(input: {
  readonly runtimeStore: AgentRuntimeStore;
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly lease: AgentRunExecutionLease;
  readonly ids: AgentIdGenerator;
  readonly clock: AgentClock;
  readonly turnId: string;
  readonly turnIndex: number;
  readonly transcript: readonly Message[];
  readonly stateVersion: number;
  readonly sequence: number;
}): Promise<AgentToolRecoveryResult> {
  const nextPlan = Object.freeze({
    kind: 'continue_model' as const,
    nextTurnIndex: input.turnIndex + 1,
  });
  const now = input.clock.now();
  const event = toHarnessEvent({
    event: {
      type: 'turn_end',
      sequence: input.sequence + 1,
      turn: input.turnIndex,
    },
    snapshot: input.snapshot,
    turnId: input.turnId,
    eventId: nextId(input.ids, 'event'),
    occurredAt: now,
  });
  await input.runtimeStore.commitTask({
    ...scope(input.snapshot),
    commitId: nextId(input.ids, 'commit'),
    expectedVersion: input.stateVersion,
    mutations: [
      {
        type: 'turn_finished',
        turnIndex: input.turnIndex,
        status: 'completed',
      },
    ],
    events: [event],
    checkpoint: checkpointAfterTool(
      input.snapshot,
      input.turnIndex,
      input.transcript,
      nextPlan,
    ),
    lease: {
      leaseToken: input.lease.leaseToken,
      fencingToken: input.lease.fencingToken,
    },
    now,
  });
  return Object.freeze({ plan: nextPlan });
}

function checkpointAfterTool(
  snapshot: AgentRunRecoverySnapshot,
  turnIndex: number,
  transcript: readonly Message[],
  nextPlan: NextToolRecoveryPlan,
): AgentRuntimeCheckpointWrite {
  return Object.freeze({
    kind: 'tool_result_appended',
    transcript,
    turnIndex,
    executionPosition: nextPlan.kind === 'continue_tools' ? 'tool' : 'model',
    nextTurnIndex:
      nextPlan.kind === 'continue_tools' ? turnIndex : nextPlan.nextTurnIndex,
    resumeState:
      nextPlan.kind === 'continue_tools'
        ? {
            kind: 'tool' as const,
            turnIndex,
            nextProposalSequence: nextPlan.nextProposalSequence,
          }
        : {
            kind: 'model' as const,
            nextTurnIndex: nextPlan.nextTurnIndex,
          },
    harnessProtocolVersion: snapshot.checkpoint.harnessProtocolVersion,
    checkpointSchemaVersion: snapshot.checkpoint.checkpointSchemaVersion,
    configFingerprint: snapshot.checkpoint.configFingerprint,
  });
}

function toHarnessEvent(input: {
  readonly event: AgentEvent;
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly turnId: string;
  readonly eventId: string;
  readonly occurredAt: string;
}): AgentHarnessEvent {
  return Object.freeze({
    eventId: input.eventId,
    tenantId: input.snapshot.tenantId,
    projectId: input.snapshot.projectId,
    sessionId: input.snapshot.task.sessionId,
    taskId: input.snapshot.taskId,
    runId: input.snapshot.runId,
    turnId: input.turnId,
    turnIndex: 'turn' in input.event ? input.event.turn : undefined,
    sequence: input.event.sequence,
    occurredAt: input.occurredAt,
    payload: toHarnessPayload(input.event),
  });
}

function assertLeaseMatchesSnapshot(
  snapshot: AgentRunRecoverySnapshot,
  lease: AgentRunExecutionLease,
): void {
  if (
    lease.tenantId !== snapshot.tenantId ||
    lease.projectId !== snapshot.projectId ||
    lease.taskId !== snapshot.taskId ||
    lease.runId !== snapshot.runId ||
    lease.ownerId !== snapshot.lease.ownerId ||
    lease.fencingToken !== snapshot.lease.fencingToken ||
    lease.leaseExpiresAt !== snapshot.lease.leaseExpiresAt
  )
    throw new TypeError('Agent tool recovery lease does not match snapshot');
}

function scope(snapshot: AgentRunRecoverySnapshot) {
  return {
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    taskId: snapshot.taskId,
    runId: snapshot.runId,
  } as const;
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) throw new TypeError('Agent clock is invalid');
  return new Date(value + milliseconds).toISOString();
}

function nextId(
  ids: AgentIdGenerator,
  kind: Parameters<AgentIdGenerator['next']>[0],
): string {
  const value = ids.next(kind);
  if (value.trim() === '') throw new TypeError(`Agent ${kind} ID is empty`);
  return value;
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
