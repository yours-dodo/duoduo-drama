import type { Message, ToolResultMessage } from '@duoduo/ai';

import type { AgentEvent } from '../types.js';
import {
  planAgentRunRecovery,
  type AgentRecoveryPlan,
} from './recovery-plan.js';
import { reconstructAgentToolBoundary } from './resume-tool-run.js';
import type {
  AgentReconciliationCaseSnapshot,
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
} from './types.js';

type ReconciliationRecoveryPlan = Extract<
  AgentRecoveryPlan,
  { readonly kind: 'consume_reconciliation' }
>;

type NextReconciliationRecoveryPlan = Extract<
  AgentRecoveryPlan,
  { readonly kind: 'continue_tools' | 'continue_model' }
>;

export interface AgentReconciliationRecoveryResult {
  readonly plan: NextReconciliationRecoveryPlan | AgentRecoveryPlan;
}

export async function resumeAgentReconciliationRun(input: {
  readonly runtimeStore: AgentRuntimeStore;
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly lease: AgentRunExecutionLease;
  readonly plan: ReconciliationRecoveryPlan;
  readonly recoveryId: string;
  readonly ids: AgentIdGenerator;
  readonly clock: AgentClock;
}): Promise<AgentReconciliationRecoveryResult> {
  assertLeaseMatchesSnapshot(input.snapshot, input.lease);
  if (input.recoveryId.trim() === '')
    throw new TypeError('Agent reconciliation recovery ID is empty');
  const snapshot = await refreshRecoverySnapshot(input);
  const plan = planAgentRunRecovery(snapshot, compatibility(input.snapshot));
  if (
    plan.kind !== 'consume_reconciliation' ||
    plan.reconciliationCaseId !== input.plan.reconciliationCaseId
  )
    return Object.freeze({ plan });

  const reconciliationCase = snapshot.reconciliationCases.find(
    (candidate) => candidate.reconciliationCaseId === plan.reconciliationCaseId,
  );
  const execution = snapshot.toolExecutions.find(
    (candidate) =>
      candidate.toolExecutionId === reconciliationCase?.toolExecutionId,
  );
  const attempt = execution?.attempts.find(
    (candidate) => candidate.attemptId === reconciliationCase?.attemptId,
  );
  if (
    !reconciliationCase ||
    !execution ||
    !attempt ||
    reconciliationCase.status !== 'resolved' ||
    reconciliationCase.resolutionId === undefined ||
    reconciliationCase.resolution === undefined ||
    execution.status !== 'unknown' ||
    execution.effectOutcome !== 'unknown' ||
    attempt.status !== 'unknown' ||
    attempt.effectOutcome !== 'unknown'
  )
    throw new TypeError('Agent reconciliation recovery state is invalid');
  const reconstruction = reconstructAgentToolBoundary(snapshot, {
    kind: 'continue_tools',
    turnIndex: execution.turnIndex,
    nextProposalSequence: execution.proposalSequence,
  });
  if (
    reconstruction.nextExecution?.toolExecutionId !== execution.toolExecutionId
  )
    throw new TypeError(
      'Agent reconciliation recovery proposal order is invalid',
    );

  const nextExecution = reconstruction.executions[reconstruction.nextIndex + 1];
  const nextPlan: NextReconciliationRecoveryPlan = nextExecution
    ? Object.freeze({
        kind: 'continue_tools',
        turnIndex: execution.turnIndex,
        nextProposalSequence: nextExecution.proposalSequence,
      })
    : Object.freeze({
        kind: 'continue_model',
        nextTurnIndex: execution.turnIndex + 1,
      });
  const now = input.clock.now();
  const result = reconciliationToolResult(reconciliationCase, execution);
  let sequence = snapshot.lastEventSequence;
  const endEvent = toHarnessEvent({
    event: {
      type: 'tool_execution_end',
      sequence: ++sequence,
      turn: execution.turnIndex,
      toolCallId: execution.toolCallId,
      toolExecutionId: execution.toolExecutionId,
      attemptId: attempt.attemptId,
      attempt: attempt.attempt,
      status: 'unknown',
      effectOutcome: 'unknown',
      result,
    },
    snapshot,
    turnId: execution.turnId,
    eventId: nextId(input.ids, 'event'),
    occurredAt: now,
  });
  const events: AgentHarnessEvent[] = [endEvent];
  if (nextPlan.kind === 'continue_model')
    events.push(
      toHarnessEvent({
        event: {
          type: 'turn_end',
          sequence: ++sequence,
          turn: execution.turnIndex,
        },
        snapshot,
        turnId: execution.turnId,
        eventId: nextId(input.ids, 'event'),
        occurredAt: now,
      }),
    );
  const transcript = Object.freeze([...snapshot.checkpoint.transcript, result]);
  await input.runtimeStore.commitTask({
    ...scope(snapshot),
    commitId: nextId(input.ids, 'commit'),
    expectedVersion: snapshot.task.version,
    mutations: [
      { type: 'reconciliation_wait_resumed' },
      ...(nextPlan.kind === 'continue_model'
        ? ([
            {
              type: 'turn_finished' as const,
              turnIndex: execution.turnIndex,
              status: 'completed' as const,
            },
          ] as const)
        : []),
    ],
    reconciliations: [
      {
        type: 'reconciliation_case_consumed',
        reconciliationCaseId: reconciliationCase.reconciliationCaseId,
        toolExecutionId: execution.toolExecutionId,
        attemptId: attempt.attemptId,
        resolutionId: reconciliationCase.resolutionId,
        consumeId: nextId(input.ids, 'reconciliation_consume'),
      },
    ],
    events,
    checkpoint: checkpointAfterReconciliation(
      snapshot,
      execution.turnIndex,
      transcript,
      nextPlan,
    ),
    lease: leaseGuard(input.lease),
    recoveryAudit: {
      recoveryId: input.recoveryId,
      action: 'resumed',
      reasonCode: reconciliationRecoveryReasonCode(reconciliationCase),
    },
    now,
  });
  return Object.freeze({ plan: nextPlan });
}

function reconciliationToolResult(
  reconciliationCase: AgentReconciliationCaseSnapshot,
  execution: AgentToolExecutionSnapshot,
): ToolResultMessage {
  const resolution = reconciliationCase.resolution;
  if (!resolution)
    throw new TypeError('Agent reconciliation Resolution is unavailable');
  const text =
    resolution === 'confirmed_applied'
      ? 'External action confirmed applied'
      : resolution === 'confirmed_not_applied'
        ? 'External action confirmed not applied'
        : resolution === 'confirmed_compensated'
          ? 'External action was compensated'
          : 'External action could not be confirmed and was abandoned';
  return Object.freeze({
    role: 'tool_result' as const,
    toolCallId: execution.toolCallId,
    toolName: execution.toolName,
    isError: resolution !== 'confirmed_applied',
    content: Object.freeze([{ type: 'text' as const, text }]),
  });
}

function reconciliationRecoveryReasonCode(
  reconciliationCase: AgentReconciliationCaseSnapshot,
): string {
  return `RECONCILIATION_${reconciliationCase.resolution?.toUpperCase()}`;
}

function checkpointAfterReconciliation(
  snapshot: AgentRunRecoverySnapshot,
  turnIndex: number,
  transcript: readonly Message[],
  nextPlan: NextReconciliationRecoveryPlan,
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

function compatibility(snapshot: AgentRunRecoverySnapshot) {
  return {
    harnessProtocolVersion: snapshot.checkpoint.harnessProtocolVersion,
    checkpointSchemaVersion: snapshot.checkpoint.checkpointSchemaVersion,
    configFingerprint: snapshot.checkpoint.configFingerprint,
  } as const;
}

async function refreshRecoverySnapshot(
  input: Pick<
    Parameters<typeof resumeAgentReconciliationRun>[0],
    'runtimeStore' | 'snapshot' | 'lease' | 'clock'
  >,
): Promise<AgentRunRecoverySnapshot> {
  return input.runtimeStore.readRecoverySnapshot({
    ...scope(input.snapshot),
    ownerId: input.lease.ownerId,
    leaseToken: input.lease.leaseToken,
    fencingToken: input.lease.fencingToken,
    now: input.clock.now(),
  });
}

function scope(snapshot: AgentRunRecoverySnapshot) {
  return {
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    taskId: snapshot.taskId,
    runId: snapshot.runId,
  } as const;
}

function leaseGuard(lease: AgentRunExecutionLease) {
  return {
    leaseToken: lease.leaseToken,
    fencingToken: lease.fencingToken,
  } as const;
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
    throw new TypeError(
      'Agent reconciliation recovery lease does not match snapshot',
    );
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

function nextId(
  ids: AgentIdGenerator,
  kind: Parameters<AgentIdGenerator['next']>[0],
): string {
  const value = ids.next(kind);
  if (value.trim() === '') throw new TypeError(`Agent ${kind} ID is empty`);
  return value;
}
