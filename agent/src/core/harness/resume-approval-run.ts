import { randomUUID } from 'node:crypto';
import type { Message, ToolResultMessage } from '@duoduo/ai';

import type { AgentEvent, AgentTool } from '../types.js';
import {
  planAgentRunRecovery,
  type AgentRecoveryPlan,
} from './recovery-plan.js';
import {
  reconstructAgentToolBoundary,
  resumeAgentToolRun,
} from './resume-tool-run.js';
import type {
  AgentApprovalSnapshot,
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

type ApprovalRecoveryPlan =
  | Extract<AgentRecoveryPlan, { readonly kind: 'wait_for_approval' }>
  | Extract<AgentRecoveryPlan, { readonly kind: 'consume_approval' }>;

export interface AgentApprovalRecoveryResult {
  readonly plan: AgentRecoveryPlan;
}

export async function resumeAgentApprovalRun(input: {
  readonly runtimeStore: AgentRuntimeStore;
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly lease: AgentRunExecutionLease;
  readonly plan: ApprovalRecoveryPlan;
  readonly tools: readonly AgentTool[];
  readonly ids: AgentIdGenerator;
  readonly clock: AgentClock;
  readonly timer: AgentTimer;
  readonly approvalPollIntervalMs?: number;
  readonly signal?: AbortSignal;
}): Promise<AgentApprovalRecoveryResult> {
  assertLeaseMatchesSnapshot(input.snapshot, input.lease);
  const compatibility = {
    harnessProtocolVersion: input.snapshot.checkpoint.harnessProtocolVersion,
    checkpointSchemaVersion: input.snapshot.checkpoint.checkpointSchemaVersion,
    configFingerprint: input.snapshot.checkpoint.configFingerprint,
  } as const;
  let snapshot = await refreshRecoverySnapshot(input);
  let plan = planAgentRunRecovery(snapshot, compatibility);
  if (plan.kind === 'wait_for_approval') {
    snapshot = await waitForTerminalApproval(input, snapshot, plan.approvalId);
    plan = planAgentRunRecovery(snapshot, compatibility);
  }
  if (
    plan.kind !== 'consume_approval' ||
    plan.approvalId !== input.plan.approvalId
  )
    return Object.freeze({ plan });

  const approval = snapshot.approvals.find(
    (candidate) => candidate.approvalId === plan.approvalId,
  );
  const execution = snapshot.toolExecutions.find(
    (candidate) => candidate.toolExecutionId === approval?.toolExecutionId,
  );
  if (!approval || !execution || approval.status === 'pending')
    throw new TypeError('Agent Approval recovery state is invalid');
  const reconstruction = reconstructAgentToolBoundary(snapshot, {
    kind: 'continue_tools',
    turnIndex: execution.turnIndex,
    nextProposalSequence: execution.proposalSequence,
  });
  if (
    reconstruction.nextExecution?.toolExecutionId !== execution.toolExecutionId
  )
    throw new TypeError('Agent Approval recovery proposal order is invalid');

  return approval.status === 'approved'
    ? consumeApprovedApproval(input, snapshot, approval, execution)
    : consumeRejectedApproval(
        input,
        snapshot,
        approval,
        execution,
        reconstruction.executions[reconstruction.nextIndex + 1],
      );
}

async function waitForTerminalApproval(
  input: Parameters<typeof resumeAgentApprovalRun>[0],
  initialSnapshot: AgentRunRecoverySnapshot,
  approvalId: string,
): Promise<AgentRunRecoverySnapshot> {
  const pollIntervalMs = input.approvalPollIntervalMs ?? 1_000;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1)
    throw new TypeError('Agent Approval recovery poll interval is invalid');
  let snapshot = initialSnapshot;
  for (;;) {
    const approval = snapshot.approvals.find(
      (candidate) => candidate.approvalId === approvalId,
    );
    if (!approval)
      throw new TypeError('Agent Approval recovery state is unavailable');
    if (approval.status !== 'pending') return snapshot;
    const now = input.clock.now();
    const expiresInMs = Date.parse(approval.expiresAt) - Date.parse(now);
    if (!Number.isFinite(expiresInMs))
      throw new TypeError('Agent Approval recovery expiry is invalid');
    if (expiresInMs <= 0) {
      await input.runtimeStore.resolveApproval({
        ...scope(snapshot),
        approvalId,
        commitId: nextId(input.ids, 'commit'),
        resolution: 'expired',
        lease: leaseGuard(input.lease),
        now,
      });
    } else {
      const wakeReason = await waitForApprovalWake({
        timer: input.timer,
        pollIntervalMs,
        expiresInMs,
        signal: input.signal,
      });
      if (wakeReason === 'expired') {
        await input.runtimeStore.resolveApproval({
          ...scope(snapshot),
          approvalId,
          commitId: nextId(input.ids, 'commit'),
          resolution: 'expired',
          lease: leaseGuard(input.lease),
          now: input.clock.now(),
        });
      }
    }
    snapshot = await refreshRecoverySnapshot(input);
  }
}

function waitForApprovalWake(input: {
  readonly timer: AgentTimer;
  readonly pollIntervalMs: number;
  readonly expiresInMs: number;
  readonly signal?: AbortSignal;
}): Promise<'poll' | 'expired'> {
  if (input.signal?.aborted)
    return Promise.reject(
      new TypeError('Agent Approval recovery wait was stopped'),
    );
  return new Promise((resolve, reject) => {
    let settled = false;
    let cancelPoll = (): void => undefined;
    let cancelExpiry = (): void => undefined;
    const settle = (reason: 'poll' | 'expired'): void => {
      if (settled) return;
      settled = true;
      cancelPoll();
      cancelExpiry();
      input.signal?.removeEventListener('abort', onAbort);
      resolve(reason);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cancelPoll();
      cancelExpiry();
      input.signal?.removeEventListener('abort', onAbort);
      reject(new TypeError('Agent Approval recovery wait was stopped'));
    };
    cancelPoll = input.timer.schedule(input.pollIntervalMs, () => {
      settle('poll');
    });
    cancelExpiry = input.timer.schedule(input.expiresInMs, () => {
      settle('expired');
    });
    input.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function consumeApprovedApproval(
  input: Parameters<typeof resumeAgentApprovalRun>[0],
  snapshot: AgentRunRecoverySnapshot,
  approval: AgentApprovalSnapshot,
  execution: AgentToolExecutionSnapshot,
): Promise<AgentApprovalRecoveryResult> {
  const tool = input.tools.find(
    (candidate) => candidate.definition.name === execution.toolName,
  );
  if (!tool) throw new TypeError('Agent Approval recovery tool is unavailable');
  if (
    execution.sideEffect !== tool.execution.sideEffect ||
    execution.idempotency !== tool.execution.idempotency ||
    execution.timeoutMs !== tool.execution.timeoutMs
  )
    throw new TypeError('Agent Approval recovery declaration is incompatible');
  const now = input.clock.now();
  const deadline = addMilliseconds(now, tool.execution.timeoutMs);
  const idempotencyKey =
    tool.execution.idempotency === 'keyed' ? randomUUID() : undefined;
  const event = approvalEvent({
    snapshot,
    approval,
    turnIndex: execution.turnIndex,
    sequence: snapshot.lastEventSequence + 1,
    eventId: nextId(input.ids, 'event'),
    occurredAt: now,
  });
  await input.runtimeStore.commitTask({
    ...scope(snapshot),
    commitId: nextId(input.ids, 'commit'),
    expectedVersion: snapshot.task.version,
    mutations: [{ type: 'approval_wait_resumed' }],
    toolExecutions: [
      {
        type: 'tool_execution_prepared',
        toolExecutionId: execution.toolExecutionId,
        ...tool.execution,
        idempotencyKey,
        deadline,
      },
    ],
    approvals: [
      {
        type: 'approval_consumed',
        approvalId: approval.approvalId,
        toolExecutionId: execution.toolExecutionId,
        decisionId: approval.decisionId,
        consumeId: nextId(input.ids, 'approval_consume'),
      },
    ],
    events: [event],
    checkpoint: approvalResolvedCheckpoint(snapshot, execution),
    lease: leaseGuard(input.lease),
    now,
  });
  const preparedSnapshot = await refreshRecoverySnapshot(input);
  const preparedPlan = planAgentRunRecovery(preparedSnapshot, {
    harnessProtocolVersion: snapshot.checkpoint.harnessProtocolVersion,
    checkpointSchemaVersion: snapshot.checkpoint.checkpointSchemaVersion,
    configFingerprint: snapshot.checkpoint.configFingerprint,
  });
  if (preparedPlan.kind !== 'reprepare_tool')
    throw new TypeError('Approved Agent tool recovery plan is invalid');
  const toolResult = await resumeAgentToolRun({
    runtimeStore: input.runtimeStore,
    snapshot: preparedSnapshot,
    lease: leaseForSnapshot(input.lease, preparedSnapshot),
    plan: preparedPlan,
    tools: input.tools,
    ids: input.ids,
    clock: input.clock,
    timer: input.timer,
    signal: input.signal,
  });
  return Object.freeze({ plan: toolResult.plan });
}

async function consumeRejectedApproval(
  input: Parameters<typeof resumeAgentApprovalRun>[0],
  snapshot: AgentRunRecoverySnapshot,
  approval: AgentApprovalSnapshot,
  execution: AgentToolExecutionSnapshot,
  nextExecution: AgentToolExecutionSnapshot | undefined,
): Promise<AgentApprovalRecoveryResult> {
  const now = input.clock.now();
  const result = rejectedApprovalResult(approval, execution);
  const nextPlan: AgentRecoveryPlan = nextExecution
    ? Object.freeze({
        kind: 'continue_tools',
        turnIndex: execution.turnIndex,
        nextProposalSequence: nextExecution.proposalSequence,
      })
    : Object.freeze({
        kind: 'continue_model',
        nextTurnIndex: execution.turnIndex + 1,
      });
  let sequence = snapshot.lastEventSequence;
  const approvalResolutionEvent = approvalEvent({
    snapshot,
    approval,
    turnIndex: execution.turnIndex,
    sequence: ++sequence,
    eventId: nextId(input.ids, 'event'),
    occurredAt: now,
  });
  const endEvent = toHarnessEvent({
    event: {
      type: 'tool_execution_end',
      sequence: ++sequence,
      turn: execution.turnIndex,
      toolCallId: execution.toolCallId,
      toolExecutionId: execution.toolExecutionId,
      attempt: 0,
      status: 'failed',
      effectOutcome: 'not_applied',
      result,
    },
    snapshot,
    turnId: execution.turnId,
    eventId: nextId(input.ids, 'event'),
    occurredAt: now,
  });
  const events: AgentHarnessEvent[] = [approvalResolutionEvent, endEvent];
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
      { type: 'approval_wait_resumed' },
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
    toolExecutions: [
      {
        type: 'tool_execution_approval_rejected',
        toolExecutionId: execution.toolExecutionId,
        reasonCode: approvalReasonCode(approval),
      },
    ],
    approvals: [
      {
        type: 'approval_consumed',
        approvalId: approval.approvalId,
        toolExecutionId: execution.toolExecutionId,
        decisionId: approval.decisionId,
        consumeId: nextId(input.ids, 'approval_consume'),
      },
    ],
    events,
    checkpoint: checkpointAfterRejectedApproval(
      snapshot,
      execution.turnIndex,
      transcript,
      nextPlan,
    ),
    lease: leaseGuard(input.lease),
    now,
  });
  return Object.freeze({ plan: nextPlan });
}

function approvalEvent(input: {
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly approval: AgentApprovalSnapshot;
  readonly turnIndex: number;
  readonly sequence: number;
  readonly eventId: string;
  readonly occurredAt: string;
}): AgentHarnessEvent {
  const event: AgentEvent =
    input.approval.status === 'approved' || input.approval.status === 'denied'
      ? {
          type: 'approval_decided',
          sequence: input.sequence,
          turn: input.turnIndex,
          approvalId: input.approval.approvalId,
          toolExecutionId: input.approval.toolExecutionId,
          decision: input.approval.status,
          decidedBy: input.approval.decidedBy!,
          reasonCode: input.approval.decisionReasonCode,
        }
      : {
          type:
            input.approval.status === 'expired'
              ? 'approval_expired'
              : 'approval_cancelled',
          sequence: input.sequence,
          turn: input.turnIndex,
          approvalId: input.approval.approvalId,
          toolExecutionId: input.approval.toolExecutionId,
        };
  return toHarnessEvent({
    event,
    snapshot: input.snapshot,
    turnId: input.approval.turnId,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  });
}

function rejectedApprovalResult(
  approval: AgentApprovalSnapshot,
  execution: AgentToolExecutionSnapshot,
): ToolResultMessage {
  const message =
    approval.status === 'expired'
      ? 'Tool approval expired'
      : approval.status === 'cancelled'
        ? 'Tool execution cancelled'
        : 'Tool execution denied';
  return Object.freeze({
    role: 'tool_result' as const,
    toolCallId: execution.toolCallId,
    toolName: execution.toolName,
    isError: true,
    content: Object.freeze([{ type: 'text' as const, text: message }]),
  });
}

function approvalReasonCode(
  approval: AgentApprovalSnapshot,
): 'APPROVAL_DENIED' | 'APPROVAL_EXPIRED' | 'APPROVAL_CANCELLED' {
  if (approval.status === 'expired') return 'APPROVAL_EXPIRED';
  if (approval.status === 'cancelled') return 'APPROVAL_CANCELLED';
  return 'APPROVAL_DENIED';
}

function approvalResolvedCheckpoint(
  snapshot: AgentRunRecoverySnapshot,
  execution: AgentToolExecutionSnapshot,
): AgentRuntimeCheckpointWrite {
  return Object.freeze({
    kind: 'approval_resolved',
    transcript: snapshot.checkpoint.transcript,
    turnIndex: execution.turnIndex,
    executionPosition: 'tool',
    nextTurnIndex: execution.turnIndex,
    resumeState: {
      kind: 'tool' as const,
      turnIndex: execution.turnIndex,
      nextProposalSequence: execution.proposalSequence,
    },
    harnessProtocolVersion: snapshot.checkpoint.harnessProtocolVersion,
    checkpointSchemaVersion: snapshot.checkpoint.checkpointSchemaVersion,
    configFingerprint: snapshot.checkpoint.configFingerprint,
  });
}

function checkpointAfterRejectedApproval(
  snapshot: AgentRunRecoverySnapshot,
  turnIndex: number,
  transcript: readonly Message[],
  nextPlan: AgentRecoveryPlan,
): AgentRuntimeCheckpointWrite {
  if (nextPlan.kind !== 'continue_tools' && nextPlan.kind !== 'continue_model')
    throw new TypeError('Agent Approval recovery next plan is invalid');
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

async function refreshRecoverySnapshot(
  input: Pick<
    Parameters<typeof resumeAgentApprovalRun>[0],
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
    throw new TypeError(
      'Agent Approval recovery lease does not match snapshot',
    );
}

function leaseForSnapshot(
  lease: AgentRunExecutionLease,
  snapshot: AgentRunRecoverySnapshot,
): AgentRunExecutionLease {
  return Object.freeze({
    ...lease,
    leaseExpiresAt: snapshot.lease.leaseExpiresAt,
  });
}

function leaseGuard(lease: AgentRunExecutionLease) {
  return {
    leaseToken: lease.leaseToken,
    fencingToken: lease.fencingToken,
  } as const;
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
