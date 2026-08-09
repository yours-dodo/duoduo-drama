import type {
  AiRuntime,
  ModelHandle,
  RequestCredentialOverride,
  StreamOptionsInput,
} from '@duoduo/ai';

import { runAgentLoop, type AgentCheckpointFrame } from '../run-loop.js';
import type { AgentToolExecutionCoordinator } from '../tool-execution.js';
import type { AgentEvent, AgentRunResult, AgentTool } from '../types.js';
import type { AgentRecoveryPlan } from './recovery-plan.js';
import type {
  AgentRunExecutionLease,
  AgentRunRecoverySnapshot,
  AgentRuntimeCheckpointWrite,
  AgentRuntimeMutation,
  AgentRuntimeStore,
} from './runtime-store.js';
import type {
  AgentClock,
  AgentHarnessEvent,
  AgentIdGenerator,
} from './types.js';
import { toHarnessPayload, turnStatusForResult } from './runtime-event.js';

export async function resumeAgentModelRun<TScopeHandle>(input: {
  readonly ai: AiRuntime<TScopeHandle>;
  readonly model: ModelHandle;
  readonly runtimeStore: AgentRuntimeStore;
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly lease: AgentRunExecutionLease;
  readonly plan: Extract<
    AgentRecoveryPlan,
    { readonly kind: 'continue_model' }
  >;
  readonly ids: AgentIdGenerator;
  readonly clock: AgentClock;
  readonly toolExecutionCoordinator: AgentToolExecutionCoordinator;
  readonly tools?: readonly AgentTool[];
  readonly systemPrompt?: string;
  readonly maxTurns?: number;
  readonly signal?: AbortSignal;
  readonly streamOptions?: Omit<
    StreamOptionsInput,
    'signal' | 'credentialOverride'
  >;
  readonly credentialOverride?: RequestCredentialOverride;
}): Promise<AgentRunResult> {
  const run = input.snapshot.task.runs.find(
    (candidate) => candidate.runId === input.snapshot.runId,
  );
  const turn = run?.turns.find(
    (candidate) => candidate.turnIndex === input.plan.nextTurnIndex,
  );
  if (!run || (turn !== undefined && turn.status !== 'running'))
    throw new TypeError('Agent model recovery Turn is invalid');
  if (
    input.snapshot.checkpoint.kind === 'input_accepted' &&
    input.snapshot.checkpoint.input === undefined
  )
    throw new TypeError('Agent model recovery input is missing');
  assertLeaseMatchesSnapshot(input.snapshot, input.lease);

  let activeTurnIndex = turn?.turnIndex;
  const turnIds = new Map(
    run.turns.map((candidate) => [candidate.turnIndex, candidate.turnId]),
  );
  let terminalCheckpoint: AgentRuntimeCheckpointWrite | undefined;
  const lease = {
    leaseToken: input.lease.leaseToken,
    fencingToken: input.lease.fencingToken,
  };
  const currentVersion = async (): Promise<number> => {
    const task = await input.runtimeStore.getTask({
      tenantId: input.snapshot.tenantId,
      projectId: input.snapshot.projectId,
      taskId: input.snapshot.taskId,
    });
    if (!task) throw new TypeError('Agent recovery Task is unavailable');
    return task.version;
  };

  const commitCheckpoint = async (frame: AgentCheckpointFrame) => {
    const checkpoint = recoveryCheckpoint(frame, input.snapshot.checkpoint);
    if (frame.kind === 'run_terminal') {
      terminalCheckpoint = checkpoint;
      return;
    }
    await input.runtimeStore.commitTask({
      tenantId: input.snapshot.tenantId,
      projectId: input.snapshot.projectId,
      taskId: input.snapshot.taskId,
      runId: input.snapshot.runId,
      commitId: nextId(input.ids, 'commit'),
      expectedVersion: await currentVersion(),
      mutations: [],
      checkpoint,
      lease,
      now: input.clock.now(),
    });
  };

  const emit = async (event: AgentEvent): Promise<void> => {
    const mutations: AgentRuntimeMutation[] = [];
    if (event.type === 'turn_start') {
      if (activeTurnIndex !== undefined)
        mutations.push({
          type: 'turn_finished',
          turnIndex: activeTurnIndex,
          status: 'completed',
        });
      const turnId = nextId(input.ids, 'turn');
      turnIds.set(event.turn, turnId);
      activeTurnIndex = event.turn;
      mutations.push({
        type: 'turn_started',
        turnId,
        turnIndex: event.turn,
      });
    } else if (event.type === 'run_end') {
      if (activeTurnIndex !== undefined)
        mutations.push({
          type: 'turn_finished',
          turnIndex: activeTurnIndex,
          status: turnStatusForResult(event.result),
        });
      mutations.push({
        type: 'run_finished',
        status: event.result.status,
        transcript: event.result.transcript,
      });
    }
    const harnessEvent = toHarnessEvent({
      event,
      snapshot: input.snapshot,
      turnId: 'turn' in event ? turnIds.get(event.turn) : undefined,
      eventId: nextId(input.ids, 'event'),
      occurredAt: input.clock.now(),
    });
    await input.runtimeStore.commitTask({
      tenantId: input.snapshot.tenantId,
      projectId: input.snapshot.projectId,
      taskId: input.snapshot.taskId,
      runId: input.snapshot.runId,
      commitId: nextId(input.ids, 'commit'),
      expectedVersion: await currentVersion(),
      mutations,
      events: [harnessEvent],
      checkpoint: event.type === 'run_end' ? terminalCheckpoint : undefined,
      lease,
      now: harnessEvent.occurredAt,
    });
    if (event.type === 'run_end') activeTurnIndex = undefined;
  };

  const previousAttempt =
    input.snapshot.modelAttempts.find(
      (attempt) => attempt.turnIndex === input.plan.nextTurnIndex,
    )?.lastAttempt ?? 0;
  return runAgentLoop({
    ai: input.ai,
    model: input.model,
    prompt: input.snapshot.checkpoint.input ?? '',
    systemPrompt: input.systemPrompt,
    transcript: input.snapshot.checkpoint.transcript,
    maxTurns: input.maxTurns,
    tools: input.tools,
    signal: input.signal,
    streamOptions: input.streamOptions,
    credentialOverride: input.credentialOverride,
    toolExecutionCoordinator: input.toolExecutionCoordinator,
    resume: {
      initialSequence: input.snapshot.lastEventSequence,
      nextTurnIndex: input.plan.nextTurnIndex,
      reenterTurn: turn !== undefined,
      modelAttempt: turn ? previousAttempt + 1 : 1,
      appendPrompt:
        input.snapshot.checkpoint.kind === 'input_accepted' &&
        input.snapshot.checkpoint.transcript.length === 0,
    },
    modelAttemptId: () => nextId(input.ids, 'model_attempt'),
    emit,
    checkpoint: commitCheckpoint,
  });
}

function recoveryCheckpoint(
  frame: AgentCheckpointFrame,
  previous: AgentRunRecoverySnapshot['checkpoint'],
): AgentRuntimeCheckpointWrite {
  const resumeState =
    frame.executionPosition === 'model' && frame.nextTurnIndex !== undefined
      ? ({
          kind: 'model' as const,
          nextTurnIndex: frame.nextTurnIndex,
        } as const)
      : frame.executionPosition === 'terminal' && frame.result
        ? ({ kind: 'finalize' as const, result: frame.result } as const)
        : undefined;
  if (previous.checkpointSchemaVersion >= 3 && !resumeState)
    throw new TypeError(
      'Agent model recovery reached an unsupported checkpoint boundary',
    );
  return Object.freeze({
    kind: frame.kind,
    transcript: frame.transcript,
    turnIndex: frame.turnIndex,
    executionPosition: frame.executionPosition,
    nextTurnIndex: frame.nextTurnIndex,
    resumeState,
    harnessProtocolVersion: previous.harnessProtocolVersion,
    checkpointSchemaVersion: previous.checkpointSchemaVersion,
    configFingerprint: previous.configFingerprint,
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
    throw new TypeError('Agent model recovery lease does not match snapshot');
}

function toHarnessEvent(input: {
  readonly event: AgentEvent;
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly turnId?: string;
  readonly eventId: string;
  readonly occurredAt: string;
}): AgentHarnessEvent {
  const turnIndex = 'turn' in input.event ? input.event.turn : undefined;
  return Object.freeze({
    eventId: input.eventId,
    tenantId: input.snapshot.tenantId,
    projectId: input.snapshot.projectId,
    sessionId: input.snapshot.task.sessionId,
    taskId: input.snapshot.taskId,
    runId: input.snapshot.runId,
    turnId: input.turnId,
    turnIndex,
    sequence: input.event.sequence,
    occurredAt: input.occurredAt,
    payload: toHarnessPayload(input.event),
  });
}

function nextId(
  ids: AgentIdGenerator,
  kind: Parameters<AgentIdGenerator['next']>[0],
): string {
  const value = ids.next(kind);
  if (value.trim() === '') throw new TypeError(`Agent ${kind} ID is empty`);
  return value;
}
