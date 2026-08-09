import type { Message } from '@duoduo/ai';

import type {
  AgentInput,
  AgentApprovalPresentation,
  AgentReconciliationObservationOutcome,
  AgentReconciliationPresentation,
  AgentRunResult,
  AgentToolEffectOutcome,
  AgentToolExecutionStatus,
} from '../types.js';

import type {
  AgentHarnessEvent,
  AgentRequestScope,
  AgentTaskSnapshot,
  AgentTaskStatus,
  AgentTurnStatus,
  ScopedTaskQuery,
} from './types.js';

export interface ScopedRunQuery extends ScopedTaskQuery {
  readonly runId: string;
}

export interface AgentRunLeaseGuard {
  readonly leaseToken: string;
  readonly fencingToken: number;
}

export interface AgentRunExecutionLease
  extends ScopedRunQuery, AgentRunLeaseGuard {
  readonly ownerId: string;
  readonly claimedAt: string;
  readonly leaseExpiresAt: string;
}

export type AgentRunLeaseSupport = 'none' | 'v1';
export type AgentCheckpointResumeSupport = 'none' | 'v3';
export type AgentReconciliationSupport = 'none' | 'v1';

export interface InitialAgentRunLeaseCommand {
  readonly ownershipId: string;
  readonly ownerId: string;
  readonly leaseExpiresAt: string;
}

export interface ClaimRecoverableAgentRunsCommand {
  readonly claimId: string;
  readonly ownerId: string;
  readonly configFingerprint: string;
  readonly limit: number;
  readonly now: string;
  readonly leaseExpiresAt: string;
}

export interface AgentRunClaimBatch {
  readonly leases: readonly AgentRunExecutionLease[];
}

export interface RenewAgentRunLeaseCommand
  extends ScopedRunQuery, AgentRunLeaseGuard {
  readonly renewalId: string;
  readonly ownerId: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
}

export interface ReleaseAgentRunLeaseCommand
  extends ScopedRunQuery, AgentRunLeaseGuard {
  readonly releaseId: string;
  readonly ownerId: string;
  readonly now: string;
  readonly availableAt: string;
  readonly action?: Extract<AgentRunRecoveryAction, 'released' | 'handoff'>;
  readonly reasonCode?: string;
}

export type AgentRunRecoveryAction =
  | 'initial_claim'
  | 'recovery_claim'
  | 'handoff'
  | 'lease_lost'
  | 'released'
  | 'resumed'
  | 'blocked'
  | 'terminal';

export interface AgentRunRecoveryAuditSnapshot extends ScopedRunQuery {
  readonly sequence: number;
  readonly recoveryId: string;
  readonly ownerId: string;
  readonly fencingToken: number;
  readonly action: AgentRunRecoveryAction;
  readonly reasonCode?: string;
  readonly occurredAt: string;
}

export interface AgentToolExecutionAttemptSnapshot {
  readonly attemptId: string;
  readonly attempt: number;
  readonly status: Extract<
    AgentToolExecutionStatus,
    'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'unknown'
  >;
  readonly effectOutcome?: AgentToolEffectOutcome;
  readonly deadline: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly errorCode?: string;
  readonly resultDigest?: string;
}

export interface AgentToolExecutionTransitionSnapshot {
  readonly sequence: number;
  readonly from?: AgentToolExecutionStatus;
  readonly to: AgentToolExecutionStatus;
  readonly attemptId?: string;
  readonly commitId: string;
  readonly occurredAt: string;
  readonly reasonCode?: string;
}

export interface AgentToolExecutionSnapshot extends ScopedRunQuery {
  readonly turnId: string;
  readonly turnIndex: number;
  readonly toolExecutionId: string;
  readonly toolCallId: string;
  readonly proposalSequence: number;
  readonly toolName: string;
  readonly argumentsDigest: string;
  readonly sideEffect?: 'none' | 'reversible' | 'external';
  readonly idempotency?: 'none' | 'keyed';
  readonly timeoutMs?: number;
  readonly idempotencyKey?: string;
  readonly deadline?: string;
  readonly status: AgentToolExecutionStatus;
  readonly effectOutcome?: AgentToolEffectOutcome;
  readonly retryable?: boolean;
  readonly attemptCount: number;
  readonly attempts: readonly AgentToolExecutionAttemptSnapshot[];
  readonly transitions: readonly AgentToolExecutionTransitionSnapshot[];
  readonly proposedAt: string;
  readonly preparedAt?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export type AgentApprovalStatus =
  'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';

export interface AgentApprovalTransitionSnapshot {
  readonly sequence: number;
  readonly from?: AgentApprovalStatus;
  readonly to: AgentApprovalStatus;
  readonly commitId: string;
  readonly occurredAt: string;
  readonly reasonCode?: string;
  readonly decisionId?: string;
  readonly consumeId?: string;
}

export interface AgentApprovalSnapshot extends ScopedRunQuery {
  readonly turnId: string;
  readonly approvalId: string;
  readonly toolExecutionId: string;
  readonly proposalSequence: number;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly argumentsDigest: string;
  readonly presentation: AgentApprovalPresentation;
  readonly status: AgentApprovalStatus;
  readonly transitions: readonly AgentApprovalTransitionSnapshot[];
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly rowVersion: number;
  readonly decisionId?: string;
  readonly decision?: 'approved' | 'denied';
  readonly decidedBy?: string;
  readonly decisionReasonCode?: string;
  readonly decidedAt?: string;
  readonly consumeId?: string;
  readonly consumedAt?: string;
}

export type AgentReconciliationCaseStatus =
  'waiting' | 'resolved' | 'consumed' | 'cancelled';

export interface AgentReconciliationCaseSnapshot extends ScopedRunQuery {
  readonly reconciliationCaseId: string;
  readonly toolExecutionId: string;
  readonly attemptId: string;
  readonly toolName: string;
  readonly status: AgentReconciliationCaseStatus;
  readonly reasonCode: 'EXTERNAL_EFFECT_UNKNOWN';
  readonly createdAt: string;
  readonly rowVersion: number;
  readonly resolutionId?: string;
  readonly resolution?: AgentReconciliationResolution;
  readonly resolvedBy?: string;
  readonly resolutionReasonCode?: string;
  readonly resolutionPresentation?: AgentReconciliationPresentation;
  readonly resolvedAt?: string;
  readonly cancelledAt?: string;
}

export type AgentReconciliationResolution =
  | 'confirmed_applied'
  | 'confirmed_not_applied'
  | 'confirmed_compensated'
  | 'abandoned';

export interface ScopedAgentReconciliationCaseQuery extends ScopedRunQuery {
  readonly reconciliationCaseId: string;
}

export interface AgentReconciliationObservationSnapshot extends ScopedAgentReconciliationCaseQuery {
  readonly sequence: number;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly outcome: AgentReconciliationObservationOutcome;
  readonly reasonCode: string;
  readonly presentation?: AgentReconciliationPresentation;
  readonly observedAt: string;
}

export interface AppendAgentReconciliationObservationCommand extends ScopedAgentReconciliationCaseQuery {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly outcome: AgentReconciliationObservationOutcome;
  readonly reasonCode: string;
  readonly presentation?: AgentReconciliationPresentation;
  readonly observedAt: string;
}

export interface DecideAgentRuntimeReconciliationCommand extends ScopedAgentReconciliationCaseQuery {
  readonly resolutionId: string;
  readonly resolution: AgentReconciliationResolution;
  readonly resolvedBy: string;
  readonly reasonCode?: string;
  readonly presentation?: AgentReconciliationPresentation;
  readonly now: string;
}

export interface CancelAgentRuntimeReconciliationCommand extends ScopedRunQuery {
  readonly cancellationId: string;
  readonly now: string;
}

export type AgentReconciliationMutation = {
  readonly type: 'reconciliation_case_created';
  readonly reconciliationCaseId: string;
  readonly toolExecutionId: string;
  readonly attemptId: string;
  readonly reasonCode: 'EXTERNAL_EFFECT_UNKNOWN';
};

export type AgentApprovalMutation =
  | {
      readonly type: 'approval_requested';
      readonly approvalId: string;
      readonly toolExecutionId: string;
      readonly turnId: string;
      readonly proposalSequence: number;
      readonly policyId: string;
      readonly policyVersion: string;
      readonly argumentsDigest: string;
      readonly expiresAt: string;
      readonly presentation: AgentApprovalPresentation;
    }
  | {
      readonly type: 'approval_consumed';
      readonly approvalId: string;
      readonly toolExecutionId: string;
      readonly decisionId?: string;
      readonly consumeId: string;
    };

export interface ResolveAgentRuntimeApprovalCommand extends ScopedRunQuery {
  readonly approvalId: string;
  readonly commitId: string;
  readonly resolution: 'expired' | 'cancelled';
  readonly lease?: AgentRunLeaseGuard;
  readonly now: string;
}

export interface DecideAgentRuntimeApprovalCommand extends ScopedRunQuery {
  readonly approvalId: string;
  readonly commitId: string;
  readonly decisionId: string;
  readonly decision: 'approved' | 'denied';
  readonly decidedBy: string;
  readonly reasonCode?: string;
  readonly now: string;
}

export interface AgentApprovalDecisionReceipt {
  readonly approval: AgentApprovalSnapshot;
  readonly version: number;
}

export type AgentToolExecutionMutation =
  | {
      readonly type: 'tool_execution_proposed';
      readonly toolExecutionId: string;
      readonly toolCallId: string;
      readonly turnId: string;
      readonly turnIndex: number;
      readonly proposalSequence: number;
      readonly toolName: string;
      readonly argumentsDigest: string;
    }
  | {
      readonly type: 'tool_execution_awaiting_approval';
      readonly toolExecutionId: string;
      readonly sideEffect: 'none' | 'reversible' | 'external';
      readonly idempotency: 'none' | 'keyed';
      readonly timeoutMs: number;
    }
  | {
      readonly type: 'tool_execution_prepared';
      readonly toolExecutionId: string;
      readonly sideEffect: 'none' | 'reversible' | 'external';
      readonly idempotency: 'none' | 'keyed';
      readonly timeoutMs: number;
      readonly idempotencyKey?: string;
      readonly deadline: string;
    }
  | {
      readonly type: 'tool_execution_reprepared';
      readonly toolExecutionId: string;
      readonly deadline: string;
      readonly reasonCode: 'RECOVERY_RESUME';
    }
  | {
      readonly type: 'tool_execution_orphan_reprepared';
      readonly toolExecutionId: string;
      readonly attemptId: string;
      readonly deadline: string;
      readonly reasonCode: 'SAFE_RECOVERY_RETRY';
    }
  | {
      readonly type: 'tool_execution_orphan_quarantined';
      readonly toolExecutionId: string;
      readonly attemptId: string;
      readonly reasonCode: 'OWNER_LEASE_EXPIRED';
    }
  | {
      readonly type: 'tool_execution_approval_rejected';
      readonly toolExecutionId: string;
      readonly reasonCode:
        'APPROVAL_DENIED' | 'APPROVAL_EXPIRED' | 'APPROVAL_CANCELLED';
    }
  | {
      readonly type: 'tool_execution_started';
      readonly toolExecutionId: string;
      readonly attemptId: string;
      readonly attempt: number;
    }
  | {
      readonly type: 'tool_execution_rejected';
      readonly toolExecutionId: string;
      readonly reasonCode: string;
    }
  | {
      readonly type: 'tool_execution_finished';
      readonly toolExecutionId: string;
      readonly attemptId: string;
      readonly status: Extract<
        AgentToolExecutionStatus,
        'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'unknown'
      >;
      readonly effectOutcome: AgentToolEffectOutcome;
      readonly retryable: boolean;
      readonly errorCode?: string;
      readonly resultDigest?: string;
      readonly reasonCode?: string;
    };

export type AgentRunCheckpointKind =
  | 'input_accepted'
  | 'model_completed'
  | 'approval_waiting'
  | 'approval_resolved'
  | 'tool_result_appended'
  | 'reconciliation_waiting'
  | 'recovery_blocked'
  | 'run_terminal';

export type AgentRuntimeExecutionPosition =
  'model' | 'approval' | 'tool' | 'reconciliation' | 'recovery' | 'terminal';

export interface AgentRuntimeCheckpointWrite {
  readonly kind: AgentRunCheckpointKind;
  readonly input?: AgentInput;
  readonly transcript: readonly Message[];
  readonly turnIndex?: number;
  readonly executionPosition: AgentRuntimeExecutionPosition;
  readonly nextTurnIndex?: number;
  readonly resumeState?: AgentRuntimeResumeState;
  readonly harnessProtocolVersion: number;
  readonly checkpointSchemaVersion: number;
  readonly configFingerprint: string;
}

export interface AgentRunCheckpointSnapshot
  extends AgentRuntimeCheckpointWrite, ScopedRunQuery {
  readonly version: number;
  readonly createdAt: string;
}

export type AgentRuntimeResumeState =
  | { readonly kind: 'model'; readonly nextTurnIndex: number }
  | {
      readonly kind: 'tool';
      readonly turnIndex: number;
      readonly nextProposalSequence: number;
    }
  | {
      readonly kind: 'approval';
      readonly turnIndex: number;
      readonly approvalId: string;
      readonly toolExecutionId: string;
    }
  | { readonly kind: 'finalize'; readonly result: AgentRunResult }
  | {
      readonly kind: 'reconciliation';
      readonly toolExecutionId: string;
      readonly attemptId: string;
    };

export interface AgentRunRecoveryLeaseSnapshot {
  readonly ownerId: string;
  readonly fencingToken: number;
  readonly leaseExpiresAt: string;
}

export interface AgentModelAttemptSnapshot {
  readonly turnIndex: number;
  readonly lastAttempt: number;
}

export interface AgentRunRecoverySnapshot extends ScopedRunQuery {
  readonly task: AgentTaskSnapshot;
  readonly checkpoint: AgentRunCheckpointSnapshot;
  readonly toolExecutions: readonly AgentToolExecutionSnapshot[];
  readonly approvals: readonly AgentApprovalSnapshot[];
  readonly reconciliationCases: readonly AgentReconciliationCaseSnapshot[];
  readonly modelAttempts: readonly AgentModelAttemptSnapshot[];
  readonly lastEventSequence: number;
  readonly lease: AgentRunRecoveryLeaseSnapshot;
}

export interface ReadAgentRunRecoveryCommand
  extends ScopedRunQuery, AgentRunLeaseGuard {
  readonly ownerId: string;
  readonly now: string;
}

export interface CreateAgentRuntimeTaskCommand {
  readonly scope: AgentRequestScope;
  readonly taskId: string;
  readonly runId: string;
  readonly commitId: string;
  readonly now: string;
  readonly checkpoint: AgentRuntimeCheckpointWrite;
  readonly initialLease?: InitialAgentRunLeaseCommand;
}

export type AgentRuntimeMutation =
  | { readonly type: 'run_started' }
  | { readonly type: 'approval_wait_started' }
  | { readonly type: 'approval_wait_resumed' }
  | { readonly type: 'reconciliation_wait_started' }
  | { readonly type: 'recovery_blocked_started' }
  | {
      readonly type: 'turn_started';
      readonly turnId: string;
      readonly turnIndex: number;
    }
  | {
      readonly type: 'turn_finished';
      readonly turnIndex: number;
      readonly status: AgentTurnStatus;
    }
  | {
      readonly type: 'run_finished';
      readonly status: Extract<
        AgentTaskStatus,
        'completed' | 'failed' | 'cancelled'
      >;
      readonly transcript: readonly Message[];
    };

export interface CommitAgentRuntimeTaskCommand extends ScopedTaskQuery {
  readonly runId: string;
  readonly commitId: string;
  readonly expectedVersion: number;
  readonly mutations: readonly AgentRuntimeMutation[];
  readonly toolExecutions?: readonly AgentToolExecutionMutation[];
  readonly approvals?: readonly AgentApprovalMutation[];
  readonly reconciliations?: readonly AgentReconciliationMutation[];
  readonly events?: readonly AgentHarnessEvent[];
  readonly checkpoint?: AgentRuntimeCheckpointWrite;
  readonly lease?: AgentRunLeaseGuard;
  readonly recoveryAudit?: {
    readonly recoveryId: string;
    readonly action: Extract<AgentRunRecoveryAction, 'resumed' | 'blocked'>;
    readonly reasonCode: string;
  };
  readonly now: string;
}

export interface AgentRuntimeCommitReceipt {
  readonly commitId: string;
  readonly version: number;
  readonly task: AgentTaskSnapshot;
  readonly checkpointVersion?: number;
  readonly lastSequence?: number;
  readonly lease?: AgentRunExecutionLease;
}

export interface ReadAgentRuntimeEventsQuery extends ScopedRunQuery {
  readonly afterSequence?: number;
  readonly limit: number;
}

export interface AgentRuntimeEventPage {
  readonly events: readonly AgentHarnessEvent[];
  readonly hasMore: boolean;
}

export interface ClaimAgentOutboxCommand {
  readonly workerId: string;
  readonly limit: number;
  readonly now: string;
  readonly leaseExpiresAt: string;
}

export interface AgentOutboxMessage {
  readonly outboxId: string;
  readonly event: AgentHarnessEvent;
  readonly attempt: number;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: string;
}

export interface AgentOutboxBatch {
  readonly messages: readonly AgentOutboxMessage[];
}

export interface AcknowledgeAgentOutboxCommand {
  readonly workerId: string;
  readonly outboxIds: readonly string[];
  readonly now: string;
}

export interface ReleaseAgentOutboxCommand extends AcknowledgeAgentOutboxCommand {
  readonly availableAt: string;
}

export interface AgentOutboxUpdateResult {
  readonly updatedCount: number;
}

export interface AgentRuntimeStore {
  readonly durability: 'ephemeral' | 'durable';
  readonly runLeaseSupport: AgentRunLeaseSupport;
  readonly checkpointResumeSupport: AgentCheckpointResumeSupport;
  readonly reconciliationSupport: AgentReconciliationSupport;
  createTask(
    command: CreateAgentRuntimeTaskCommand,
  ): Promise<AgentRuntimeCommitReceipt>;
  commitTask(
    command: CommitAgentRuntimeTaskCommand,
  ): Promise<AgentRuntimeCommitReceipt>;
  claimRecoverableRuns(
    command: ClaimRecoverableAgentRunsCommand,
  ): Promise<AgentRunClaimBatch>;
  renewRunLease(
    command: RenewAgentRunLeaseCommand,
  ): Promise<AgentRunExecutionLease>;
  releaseRunLease(command: ReleaseAgentRunLeaseCommand): Promise<void>;
  readRunRecoveryAudit(
    query: ScopedRunQuery,
  ): Promise<readonly AgentRunRecoveryAuditSnapshot[]>;
  readRecoverySnapshot(
    command: ReadAgentRunRecoveryCommand,
  ): Promise<AgentRunRecoverySnapshot>;
  getTask(query: ScopedTaskQuery): Promise<AgentTaskSnapshot | undefined>;
  getCheckpoint(
    query: ScopedRunQuery,
  ): Promise<AgentRunCheckpointSnapshot | undefined>;
  readCheckpoints(
    query: ScopedRunQuery,
  ): Promise<readonly AgentRunCheckpointSnapshot[]>;
  readEvents(
    query: ReadAgentRuntimeEventsQuery,
  ): Promise<AgentRuntimeEventPage>;
  readToolExecutions(
    query: ScopedRunQuery,
  ): Promise<readonly AgentToolExecutionSnapshot[]>;
  readApprovals(
    query: ScopedRunQuery,
  ): Promise<readonly AgentApprovalSnapshot[]>;
  readReconciliationCases(
    query: ScopedRunQuery,
  ): Promise<readonly AgentReconciliationCaseSnapshot[]>;
  readReconciliationObservations(
    query: ScopedAgentReconciliationCaseQuery,
  ): Promise<readonly AgentReconciliationObservationSnapshot[]>;
  appendReconciliationObservation(
    command: AppendAgentReconciliationObservationCommand,
  ): Promise<AgentReconciliationObservationSnapshot>;
  decideReconciliation(
    command: DecideAgentRuntimeReconciliationCommand,
  ): Promise<AgentReconciliationCaseSnapshot>;
  cancelReconciliation(
    command: CancelAgentRuntimeReconciliationCommand,
  ): Promise<readonly AgentReconciliationCaseSnapshot[]>;
  decideApproval(
    command: DecideAgentRuntimeApprovalCommand,
  ): Promise<AgentApprovalDecisionReceipt>;
  resolveApproval(
    command: ResolveAgentRuntimeApprovalCommand,
  ): Promise<AgentApprovalDecisionReceipt>;
  claimOutbox(command: ClaimAgentOutboxCommand): Promise<AgentOutboxBatch>;
  acknowledgeOutbox(
    command: AcknowledgeAgentOutboxCommand,
  ): Promise<AgentOutboxUpdateResult>;
  releaseOutbox(
    command: ReleaseAgentOutboxCommand,
  ): Promise<AgentOutboxUpdateResult>;
  dispose(): Promise<void>;
}
