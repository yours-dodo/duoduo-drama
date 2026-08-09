import type { AgentRunResult } from '../types.js';
import type { AgentRunRecoverySnapshot } from './runtime-store.js';

export interface AgentRecoveryCompatibility {
  readonly harnessProtocolVersion: number;
  readonly checkpointSchemaVersion: number;
  readonly configFingerprint: string;
  readonly legacyConfigFingerprints?: Readonly<Record<number, string>>;
}

export type AgentRecoveryBlockedReasonCode =
  | 'RECOVERY_SCOPE_INVALID'
  | 'RECOVERY_ACTIVE_RUN_INVALID'
  | 'RECOVERY_LEASE_INVALID'
  | 'RECOVERY_EVENT_POSITION_INVALID'
  | 'RECOVERY_CONFIG_MISMATCH'
  | 'RECOVERY_PROTOCOL_UNSUPPORTED'
  | 'RECOVERY_CHECKPOINT_UNSUPPORTED'
  | 'RECOVERY_STATE_CONTRADICTION'
  | 'RECOVERY_TURN_ORDER_INVALID'
  | 'RECOVERY_LEDGER_INVALID'
  | 'RECOVERY_APPROVAL_INVALID';

export type AgentRecoveryPlan =
  | { readonly kind: 'continue_model'; readonly nextTurnIndex: number }
  | {
      readonly kind: 'continue_tools';
      readonly turnIndex: number;
      readonly nextProposalSequence: number;
    }
  | { readonly kind: 'wait_for_approval'; readonly approvalId: string }
  | { readonly kind: 'consume_approval'; readonly approvalId: string }
  | { readonly kind: 'reprepare_tool'; readonly toolExecutionId: string }
  | { readonly kind: 'retry_safe_tool'; readonly toolExecutionId: string }
  | {
      readonly kind: 'wait_for_reconciliation';
      readonly toolExecutionId: string;
      readonly attemptId: string;
    }
  | { readonly kind: 'finalize'; readonly result: AgentRunResult }
  | {
      readonly kind: 'blocked';
      readonly reasonCode: AgentRecoveryBlockedReasonCode;
    }
  | { readonly kind: 'ignore_terminal' };

export function planAgentRunRecovery(
  snapshot: AgentRunRecoverySnapshot,
  compatibility: AgentRecoveryCompatibility,
): AgentRecoveryPlan {
  const checkpoint = snapshot.checkpoint;
  if (
    snapshot.task.tenantId !== snapshot.tenantId ||
    snapshot.task.projectId !== snapshot.projectId ||
    snapshot.task.taskId !== snapshot.taskId ||
    !matchesScope(checkpoint, snapshot) ||
    snapshot.toolExecutions.some(
      (execution) => !matchesScope(execution, snapshot),
    ) ||
    snapshot.approvals.some((approval) => !matchesScope(approval, snapshot))
  )
    return blocked('RECOVERY_SCOPE_INVALID');
  const run = snapshot.task.runs.find(
    (candidate) => candidate.runId === snapshot.runId,
  );
  if (!run) return blocked('RECOVERY_ACTIVE_RUN_INVALID');
  if (isTerminal(snapshot.task.status) && isTerminal(run.status))
    return Object.freeze({ kind: 'ignore_terminal' });
  if (
    isTerminal(snapshot.task.status) !== isTerminal(run.status) ||
    snapshot.task.activeRunId !== snapshot.runId
  )
    return blocked('RECOVERY_ACTIVE_RUN_INVALID');
  if (
    snapshot.lease.ownerId.trim() === '' ||
    !Number.isSafeInteger(snapshot.lease.fencingToken) ||
    snapshot.lease.fencingToken < 1 ||
    !Number.isFinite(Date.parse(snapshot.lease.leaseExpiresAt))
  )
    return blocked('RECOVERY_LEASE_INVALID');
  if (
    checkpoint.harnessProtocolVersion !== compatibility.harnessProtocolVersion
  )
    return blocked('RECOVERY_PROTOCOL_UNSUPPORTED');
  const isCurrentCheckpoint =
    checkpoint.checkpointSchemaVersion ===
    compatibility.checkpointSchemaVersion;
  const isSupportedLegacyCheckpoint =
    !isCurrentCheckpoint &&
    compatibility.checkpointSchemaVersion === 3 &&
    (checkpoint.checkpointSchemaVersion === 1 ||
      checkpoint.checkpointSchemaVersion === 2) &&
    compatibility.legacyConfigFingerprints?.[
      checkpoint.checkpointSchemaVersion
    ] !== undefined;
  if (!isCurrentCheckpoint && !isSupportedLegacyCheckpoint)
    return blocked('RECOVERY_CHECKPOINT_UNSUPPORTED');
  const expectedConfigFingerprint = isCurrentCheckpoint
    ? compatibility.configFingerprint
    : compatibility.legacyConfigFingerprints?.[
        checkpoint.checkpointSchemaVersion
      ];
  if (checkpoint.configFingerprint !== expectedConfigFingerprint)
    return blocked('RECOVERY_CONFIG_MISMATCH');
  const resumeState = isCurrentCheckpoint
    ? checkpoint.resumeState
    : inferLegacyResumeState(snapshot);
  if (!isCurrentCheckpoint && !resumeState)
    return blocked('RECOVERY_CHECKPOINT_UNSUPPORTED');
  if (
    !Number.isSafeInteger(snapshot.lastEventSequence) ||
    snapshot.lastEventSequence < 0 ||
    !hasValidModelAttempts(snapshot, run, resumeState)
  )
    return blocked('RECOVERY_EVENT_POSITION_INVALID');
  if (!hasValidTurnOrder(run, resumeState))
    return blocked('RECOVERY_TURN_ORDER_INVALID');
  if (!hasValidToolLedger(snapshot, run.turns))
    return blocked('RECOVERY_LEDGER_INVALID');
  if (!hasValidApprovalLedger(snapshot))
    return blocked('RECOVERY_APPROVAL_INVALID');
  if (
    resumeState?.kind === 'model' &&
    Number.isSafeInteger(resumeState.nextTurnIndex) &&
    resumeState.nextTurnIndex > 0
  )
    return Object.freeze({
      kind: 'continue_model',
      nextTurnIndex: resumeState.nextTurnIndex,
    });
  if (
    resumeState?.kind === 'tool' &&
    Number.isSafeInteger(resumeState.turnIndex) &&
    resumeState.turnIndex > 0 &&
    Number.isSafeInteger(resumeState.nextProposalSequence) &&
    resumeState.nextProposalSequence > 0
  ) {
    const execution = snapshot.toolExecutions.find(
      (candidate) =>
        candidate.turnIndex === resumeState.turnIndex &&
        candidate.proposalSequence === resumeState.nextProposalSequence,
    );
    if (execution?.status === 'prepared')
      return Object.freeze({
        kind: 'reprepare_tool',
        toolExecutionId: execution.toolExecutionId,
      });
    if (execution?.status === 'running') {
      const attempt = execution.attempts.at(-1);
      if (
        !attempt ||
        attempt.status !== 'running' ||
        attempt.attempt !== execution.attemptCount
      )
        return blocked('RECOVERY_LEDGER_INVALID');
      if (execution.sideEffect === 'none')
        return Object.freeze({
          kind: 'retry_safe_tool',
          toolExecutionId: execution.toolExecutionId,
        });
      if (
        execution.sideEffect === 'reversible' ||
        execution.sideEffect === 'external'
      )
        return Object.freeze({
          kind: 'wait_for_reconciliation',
          toolExecutionId: execution.toolExecutionId,
          attemptId: attempt.attemptId,
        });
      return blocked('RECOVERY_LEDGER_INVALID');
    }
    return Object.freeze({
      kind: 'continue_tools',
      turnIndex: resumeState.turnIndex,
      nextProposalSequence: resumeState.nextProposalSequence,
    });
  }
  if (
    resumeState?.kind === 'approval' &&
    Number.isSafeInteger(resumeState.turnIndex) &&
    resumeState.turnIndex > 0 &&
    resumeState.approvalId.trim() !== '' &&
    resumeState.toolExecutionId.trim() !== ''
  ) {
    const approval = snapshot.approvals.find(
      (candidate) => candidate.approvalId === resumeState.approvalId,
    );
    const execution = snapshot.toolExecutions.find(
      (candidate) => candidate.toolExecutionId === resumeState.toolExecutionId,
    );
    if (
      !approval ||
      !execution ||
      approval.toolExecutionId !== execution.toolExecutionId ||
      execution.turnIndex !== resumeState.turnIndex ||
      approval.proposalSequence !== execution.proposalSequence ||
      approval.argumentsDigest !== execution.argumentsDigest ||
      execution.status !== 'awaiting_approval' ||
      snapshot.task.status !== 'waiting_for_approval' ||
      run.status !== 'waiting_for_approval'
    )
      return blocked('RECOVERY_APPROVAL_INVALID');
    if (approval.consumeId || approval.consumedAt)
      return blocked('RECOVERY_STATE_CONTRADICTION');
    if (approval.status === 'pending')
      return Object.freeze({
        kind: 'wait_for_approval',
        approvalId: approval.approvalId,
      });
    return Object.freeze({
      kind: 'consume_approval',
      approvalId: approval.approvalId,
    });
  }
  if (resumeState?.kind === 'finalize') {
    if (
      checkpoint.executionPosition !== 'terminal' ||
      !Number.isSafeInteger(resumeState.result.turns) ||
      resumeState.result.turns < 0 ||
      JSON.stringify(resumeState.result.transcript) !==
        JSON.stringify(checkpoint.transcript)
    )
      return blocked('RECOVERY_STATE_CONTRADICTION');
    return Object.freeze({ kind: 'finalize', result: resumeState.result });
  }
  if (
    resumeState?.kind === 'reconciliation' &&
    resumeState.toolExecutionId.trim() !== '' &&
    resumeState.attemptId.trim() !== ''
  ) {
    const execution = snapshot.toolExecutions.find(
      (candidate) => candidate.toolExecutionId === resumeState.toolExecutionId,
    );
    const attempt = execution?.attempts.find(
      (candidate) => candidate.attemptId === resumeState.attemptId,
    );
    if (
      !execution ||
      !attempt ||
      (execution.sideEffect !== 'reversible' &&
        execution.sideEffect !== 'external') ||
      execution.status !== 'unknown' ||
      execution.effectOutcome !== 'unknown' ||
      execution.retryable !== false ||
      attempt.status !== 'unknown' ||
      attempt.effectOutcome !== 'unknown' ||
      snapshot.task.status !== 'waiting_for_reconciliation' ||
      run.status !== 'waiting_for_reconciliation'
    )
      return blocked('RECOVERY_LEDGER_INVALID');
    return Object.freeze({
      kind: 'wait_for_reconciliation',
      toolExecutionId: execution.toolExecutionId,
      attemptId: attempt.attemptId,
    });
  }
  return blocked('RECOVERY_STATE_CONTRADICTION');
}

function hasValidModelAttempts(
  snapshot: AgentRunRecoverySnapshot,
  run: AgentRunRecoverySnapshot['task']['runs'][number],
  resumeState: AgentRunRecoverySnapshot['checkpoint']['resumeState'],
): boolean {
  const turnIndexes = new Set<number>();
  for (const attempt of snapshot.modelAttempts) {
    if (
      !Number.isSafeInteger(attempt.turnIndex) ||
      attempt.turnIndex < 1 ||
      turnIndexes.has(attempt.turnIndex) ||
      !Number.isSafeInteger(attempt.lastAttempt) ||
      attempt.lastAttempt < 1 ||
      !run.turns.some((turn) => turn.turnIndex === attempt.turnIndex)
    )
      return false;
    turnIndexes.add(attempt.turnIndex);
  }
  if (resumeState?.kind !== 'model') return true;
  const resumedTurn = run.turns.find(
    (turn) => turn.turnIndex === resumeState.nextTurnIndex,
  );
  return (
    resumedTurn?.status !== 'running' || turnIndexes.has(resumedTurn.turnIndex)
  );
}

function isTerminal(status: string): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

function matchesScope(
  value: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly taskId: string;
    readonly runId: string;
  },
  snapshot: AgentRunRecoverySnapshot,
): boolean {
  return (
    value.tenantId === snapshot.tenantId &&
    value.projectId === snapshot.projectId &&
    value.taskId === snapshot.taskId &&
    value.runId === snapshot.runId
  );
}

function hasValidTurnOrder(
  run: AgentRunRecoverySnapshot['task']['runs'][number],
  resumeState: AgentRunRecoverySnapshot['checkpoint']['resumeState'],
): boolean {
  const turnIds = new Set<string>();
  let runningTurnIndex: number | undefined;
  for (const [offset, turn] of run.turns.entries()) {
    if (
      turn.turnIndex !== offset + 1 ||
      turn.turnId.trim() === '' ||
      turnIds.has(turn.turnId) ||
      turn.status === 'failed' ||
      turn.status === 'cancelled'
    )
      return false;
    turnIds.add(turn.turnId);
    if (turn.status === 'running') {
      if (runningTurnIndex !== undefined || offset !== run.turns.length - 1)
        return false;
      runningTurnIndex = turn.turnIndex;
    }
  }
  if (resumeState?.kind === 'model') {
    const expected = runningTurnIndex ?? run.turns.length + 1;
    return resumeState.nextTurnIndex === expected;
  }
  if (resumeState?.kind === 'tool' || resumeState?.kind === 'approval')
    return resumeState.turnIndex === runningTurnIndex;
  return true;
}

function hasValidToolLedger(
  snapshot: AgentRunRecoverySnapshot,
  turns: AgentRunRecoverySnapshot['task']['runs'][number]['turns'],
): boolean {
  const executionIds = new Set<string>();
  const toolCallIds = new Set<string>();
  const proposalSequences = new Set<number>();
  const attemptIds = new Set<string>();
  const turnById = new Map(turns.map((turn) => [turn.turnId, turn]));
  for (const execution of snapshot.toolExecutions) {
    const turn = turnById.get(execution.turnId);
    if (
      execution.toolExecutionId.trim() === '' ||
      execution.toolCallId.trim() === '' ||
      executionIds.has(execution.toolExecutionId) ||
      toolCallIds.has(execution.toolCallId) ||
      proposalSequences.has(execution.proposalSequence) ||
      !Number.isSafeInteger(execution.proposalSequence) ||
      execution.proposalSequence < 1 ||
      !turn ||
      turn.turnIndex !== execution.turnIndex ||
      execution.attemptCount !== execution.attempts.length
    )
      return false;
    executionIds.add(execution.toolExecutionId);
    toolCallIds.add(execution.toolCallId);
    proposalSequences.add(execution.proposalSequence);
    for (const [offset, attempt] of execution.attempts.entries()) {
      if (
        attempt.attempt !== offset + 1 ||
        attempt.attemptId.trim() === '' ||
        attemptIds.has(attempt.attemptId)
      )
        return false;
      attemptIds.add(attempt.attemptId);
    }
    if (!hasValidToolTransitions(execution)) return false;
    if (
      execution.status === 'running' &&
      execution.attempts.at(-1)?.status !== 'running'
    )
      return false;
  }
  if (
    [...proposalSequences]
      .sort((left, right) => left - right)
      .some((sequence, offset) => sequence !== offset + 1)
  )
    return false;
  return true;
}

function hasValidToolTransitions(
  execution: AgentRunRecoverySnapshot['toolExecutions'][number],
): boolean {
  let previousStatus:
    AgentRunRecoverySnapshot['toolExecutions'][number]['status'] | undefined;
  const attemptIds = new Set(
    execution.attempts.map((attempt) => attempt.attemptId),
  );
  for (const [offset, transition] of execution.transitions.entries()) {
    if (
      transition.sequence !== offset + 1 ||
      transition.from !== previousStatus ||
      (transition.attemptId !== undefined &&
        !attemptIds.has(transition.attemptId))
    )
      return false;
    previousStatus = transition.to;
  }
  return (
    execution.transitions.length === 0 || previousStatus === execution.status
  );
}

function hasValidApprovalLedger(snapshot: AgentRunRecoverySnapshot): boolean {
  const approvalIds = new Set<string>();
  for (const approval of snapshot.approvals) {
    const execution = snapshot.toolExecutions.find(
      (candidate) => candidate.toolExecutionId === approval.toolExecutionId,
    );
    if (
      approval.approvalId.trim() === '' ||
      approvalIds.has(approval.approvalId) ||
      Boolean(approval.consumeId) !== Boolean(approval.consumedAt) ||
      !execution ||
      approval.turnId !== execution.turnId ||
      approval.proposalSequence !== execution.proposalSequence ||
      approval.argumentsDigest !== execution.argumentsDigest
    )
      return false;
    if (!hasValidApprovalTransitions(approval)) return false;
    if (
      approval.status === 'pending' &&
      (approval.decisionId !== undefined ||
        approval.decision !== undefined ||
        approval.decidedAt !== undefined)
    )
      return false;
    if (
      (approval.status === 'approved' || approval.status === 'denied') &&
      (approval.decision !== approval.status ||
        !approval.decisionId ||
        !approval.decidedBy ||
        !approval.decidedAt)
    )
      return false;
    approvalIds.add(approval.approvalId);
  }
  return true;
}

function hasValidApprovalTransitions(
  approval: AgentRunRecoverySnapshot['approvals'][number],
): boolean {
  let previousStatus:
    AgentRunRecoverySnapshot['approvals'][number]['status'] | undefined;
  for (const [offset, transition] of approval.transitions.entries()) {
    if (
      transition.sequence !== offset + 1 ||
      transition.from !== previousStatus
    )
      return false;
    previousStatus = transition.to;
  }
  return (
    approval.transitions.length === 0 || previousStatus === approval.status
  );
}

function inferLegacyResumeState(
  snapshot: AgentRunRecoverySnapshot,
): AgentRunRecoverySnapshot['checkpoint']['resumeState'] {
  const checkpoint = snapshot.checkpoint;
  if (
    (checkpoint.kind === 'input_accepted' ||
      checkpoint.kind === 'tool_result_appended') &&
    checkpoint.executionPosition === 'model' &&
    checkpoint.nextTurnIndex !== undefined
  )
    return Object.freeze({
      kind: 'model',
      nextTurnIndex: checkpoint.nextTurnIndex,
    });
  if (
    checkpoint.kind === 'approval_waiting' &&
    checkpoint.executionPosition === 'approval' &&
    checkpoint.turnIndex !== undefined
  ) {
    const candidates = snapshot.approvals.filter((approval) => {
      const execution = snapshot.toolExecutions.find(
        (item) => item.toolExecutionId === approval.toolExecutionId,
      );
      return (
        execution !== undefined &&
        execution.turnIndex === checkpoint.turnIndex &&
        execution.status === 'awaiting_approval' &&
        !approval.consumeId &&
        !approval.consumedAt
      );
    });
    if (candidates.length !== 1) return undefined;
    const approval = candidates[0]!;
    return Object.freeze({
      kind: 'approval',
      turnIndex: checkpoint.turnIndex,
      approvalId: approval.approvalId,
      toolExecutionId: approval.toolExecutionId,
    });
  }
  return undefined;
}

function blocked(
  reasonCode: AgentRecoveryBlockedReasonCode,
): AgentRecoveryPlan {
  return Object.freeze({ kind: 'blocked', reasonCode });
}
