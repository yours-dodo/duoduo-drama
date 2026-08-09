import type { AgentTool } from '../types.js';
import type { AgentEvent } from '../types.js';
import {
  planAgentRunRecovery,
  type AgentRecoveryPlan,
} from './recovery-plan.js';
import {
  assertAgentRecoveryExecutionDeclaration,
  reconstructAgentToolBoundary,
  resumeAgentToolRun,
} from './resume-tool-run.js';
import type {
  AgentRunExecutionLease,
  AgentRunRecoverySnapshot,
  AgentRuntimeCheckpointWrite,
  AgentRuntimeStore,
} from './runtime-store.js';
import { toHarnessPayload } from './runtime-event.js';
import type {
  AgentClock,
  AgentHarnessEvent,
  AgentIdGenerator,
  AgentTimer,
} from './types.js';

type OrphanToolRecoveryPlan =
  | Extract<AgentRecoveryPlan, { readonly kind: 'retry_safe_tool' }>
  | Extract<AgentRecoveryPlan, { readonly kind: 'wait_for_reconciliation' }>;

export interface AgentOrphanToolRecoveryResult {
  readonly plan: AgentRecoveryPlan;
}

export async function resumeAgentOrphanToolRun(input: {
  readonly runtimeStore: AgentRuntimeStore;
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly lease: AgentRunExecutionLease;
  readonly plan: OrphanToolRecoveryPlan;
  readonly recoveryId: string;
  readonly tools: readonly AgentTool[];
  readonly ids: AgentIdGenerator;
  readonly clock: AgentClock;
  readonly timer: AgentTimer;
  readonly signal?: AbortSignal;
}): Promise<AgentOrphanToolRecoveryResult> {
  assertLeaseMatchesSnapshot(input.snapshot, input.lease);
  if (input.recoveryId.trim() === '')
    throw new TypeError('Agent orphan recovery ID is empty');
  const snapshot = await refreshRecoverySnapshot(input);
  const plan = planAgentRunRecovery(snapshot, compatibility(input.snapshot));
  if (
    plan.kind !== input.plan.kind ||
    !('toolExecutionId' in plan) ||
    plan.toolExecutionId !== input.plan.toolExecutionId
  )
    return Object.freeze({ plan });
  const execution = snapshot.toolExecutions.find(
    (candidate) => candidate.toolExecutionId === plan.toolExecutionId,
  );
  const attempt = execution?.attempts.at(-1);
  if (!execution || !attempt || attempt.status !== 'running')
    throw new TypeError('Agent orphan Attempt is invalid');
  const reconstruction = reconstructAgentToolBoundary(snapshot, {
    kind: 'continue_tools',
    turnIndex: execution.turnIndex,
    nextProposalSequence: execution.proposalSequence,
  });
  if (
    reconstruction.nextExecution?.toolExecutionId !== execution.toolExecutionId
  )
    throw new TypeError('Agent orphan recovery proposal order is invalid');
  if (plan.kind === 'wait_for_reconciliation')
    return quarantineExternalOrphan(input, snapshot, execution, attempt);

  const tool = input.tools.find(
    (candidate) => candidate.definition.name === execution.toolName,
  );
  if (!tool) throw new TypeError('Agent orphan recovery tool is unavailable');
  assertAgentRecoveryExecutionDeclaration(execution, tool);
  const now = input.clock.now();
  const deadline = addMilliseconds(now, tool.execution.timeoutMs);
  await input.runtimeStore.commitTask({
    ...scope(snapshot),
    commitId: nextId(input.ids, 'commit'),
    expectedVersion: snapshot.task.version,
    mutations: [],
    toolExecutions: [
      {
        type: 'tool_execution_orphan_reprepared',
        toolExecutionId: execution.toolExecutionId,
        attemptId: attempt.attemptId,
        deadline,
        reasonCode: 'SAFE_RECOVERY_RETRY',
      },
    ],
    lease: leaseGuard(input.lease),
    recoveryAudit: {
      recoveryId: input.recoveryId,
      action: 'resumed',
      reasonCode: 'SAFE_RECOVERY_RETRY',
    },
    now,
  });
  const preparedSnapshot = await refreshRecoverySnapshot(input);
  const preparedPlan = planAgentRunRecovery(
    preparedSnapshot,
    compatibility(input.snapshot),
  );
  if (preparedPlan.kind !== 'reprepare_tool')
    throw new TypeError('Safe Agent orphan retry plan is invalid');
  const result = await resumeAgentToolRun({
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
  return Object.freeze({ plan: result.plan });
}

async function quarantineExternalOrphan(
  input: Parameters<typeof resumeAgentOrphanToolRun>[0],
  snapshot: AgentRunRecoverySnapshot,
  execution: AgentRunRecoverySnapshot['toolExecutions'][number],
  attempt: AgentRunRecoverySnapshot['toolExecutions'][number]['attempts'][number],
): Promise<AgentOrphanToolRecoveryResult> {
  const now = input.clock.now();
  const reconciliations =
    input.runtimeStore.reconciliationSupport === 'v1'
      ? [
          {
            type: 'reconciliation_case_created' as const,
            reconciliationCaseId: nextId(input.ids, 'reconciliation_case'),
            toolExecutionId: execution.toolExecutionId,
            attemptId: attempt.attemptId,
            reasonCode: 'EXTERNAL_EFFECT_UNKNOWN' as const,
          },
        ]
      : undefined;
  const event = toHarnessEvent({
    event: {
      type: 'run_reconciliation_required',
      sequence: snapshot.lastEventSequence + 1,
      turn: execution.turnIndex,
      toolCallId: execution.toolCallId,
      toolExecutionId: execution.toolExecutionId,
      attemptId: attempt.attemptId,
      reasonCode: 'EXTERNAL_EFFECT_UNKNOWN',
    },
    snapshot,
    turnId: execution.turnId,
    eventId: nextId(input.ids, 'event'),
    occurredAt: now,
  });
  await input.runtimeStore.commitTask({
    ...scope(snapshot),
    commitId: nextId(input.ids, 'commit'),
    expectedVersion: snapshot.task.version,
    mutations: [{ type: 'reconciliation_wait_started' }],
    toolExecutions: [
      {
        type: 'tool_execution_orphan_quarantined',
        toolExecutionId: execution.toolExecutionId,
        attemptId: attempt.attemptId,
        reasonCode: 'OWNER_LEASE_EXPIRED',
      },
    ],
    reconciliations,
    events: [event],
    checkpoint: reconciliationCheckpoint(snapshot, execution, attempt),
    lease: leaseGuard(input.lease),
    recoveryAudit: {
      recoveryId: input.recoveryId,
      action: 'blocked',
      reasonCode: 'EXTERNAL_EFFECT_UNKNOWN',
    },
    now,
  });
  const quarantinedSnapshot = await refreshRecoverySnapshot(input);
  const plan = planAgentRunRecovery(
    quarantinedSnapshot,
    compatibility(input.snapshot),
  );
  if (plan.kind !== 'wait_for_reconciliation')
    throw new TypeError('External Agent orphan quarantine plan is invalid');
  return Object.freeze({ plan });
}

function reconciliationCheckpoint(
  snapshot: AgentRunRecoverySnapshot,
  execution: AgentRunRecoverySnapshot['toolExecutions'][number],
  attempt: AgentRunRecoverySnapshot['toolExecutions'][number]['attempts'][number],
): AgentRuntimeCheckpointWrite {
  return Object.freeze({
    kind: 'reconciliation_waiting',
    transcript: snapshot.checkpoint.transcript,
    turnIndex: execution.turnIndex,
    executionPosition: 'reconciliation',
    resumeState: {
      kind: 'reconciliation' as const,
      toolExecutionId: execution.toolExecutionId,
      attemptId: attempt.attemptId,
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

async function refreshRecoverySnapshot(
  input: Pick<
    Parameters<typeof resumeAgentOrphanToolRun>[0],
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

function compatibility(snapshot: AgentRunRecoverySnapshot) {
  return {
    harnessProtocolVersion: snapshot.checkpoint.harnessProtocolVersion,
    checkpointSchemaVersion: snapshot.checkpoint.checkpointSchemaVersion,
    configFingerprint: snapshot.checkpoint.configFingerprint,
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
    throw new TypeError('Agent orphan recovery lease does not match snapshot');
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
