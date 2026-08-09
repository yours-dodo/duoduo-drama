import type { JsonValue, Message } from '@duoduo/ai';

import type {
  AgentEvent,
  AgentApprovalPresentation,
  AgentInput,
  AgentReconciliationPresentation,
  AgentRunResult,
  AgentToolExecutionDeclaration,
  CreateAgentOptions,
} from '../types.js';
import type {
  AgentApprovalSnapshot,
  AgentReconciliationCaseSnapshot,
  AgentReconciliationObservationSnapshot,
  AgentReconciliationResolution,
  AgentRuntimeStore,
  AgentToolExecutionSnapshot,
} from './runtime-store.js';

export type AgentIdKind =
  | 'task'
  | 'run'
  | 'turn'
  | 'event'
  | 'commit'
  | 'approval'
  | 'approval_consume'
  | 'reconciliation_case'
  | 'reconciliation_consume'
  | 'tool_execution'
  | 'tool_attempt'
  | 'model_attempt';

export interface AgentIdGenerator {
  next(kind: AgentIdKind): string;
}

export interface AgentClock {
  now(): string;
}

export interface AgentTimer {
  schedule(delayMs: number, callback: () => void): () => void;
}

export interface AgentRequestScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly sessionId?: string;
}

export interface AgentApprovalPolicyContext {
  readonly scope: AgentRequestScope;
  readonly taskId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly turnIndex: number;
  readonly toolExecutionId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: JsonValue;
  readonly argumentsDigest: string;
  readonly execution: AgentToolExecutionDeclaration;
}

export type AgentApprovalPolicyResult =
  | { readonly decision: 'allow' }
  | { readonly decision: 'deny'; readonly reasonCode: string }
  | {
      readonly decision: 'require_approval';
      readonly expiresAt: string;
      readonly presentation: AgentApprovalPresentation;
    };

export interface AgentApprovalPolicy {
  readonly policyId: string;
  readonly version: string;
  evaluate(
    context: AgentApprovalPolicyContext,
  ): AgentApprovalPolicyResult | Promise<AgentApprovalPolicyResult>;
}

export interface CreateAgentHarnessOptions<
  TScopeHandle,
> extends CreateAgentOptions<TScopeHandle> {
  readonly approvalPolicy?: AgentApprovalPolicy;
  readonly ids?: AgentIdGenerator;
  readonly clock?: AgentClock;
  readonly timer?: AgentTimer;
  readonly runtimeStore?: AgentRuntimeStore;
  readonly runLease?: {
    readonly durationMs?: number;
    readonly heartbeatIntervalMs?: number;
  };
  readonly durableEventBatch?: {
    readonly maxEvents?: number;
    readonly maxWaitMs?: number;
  };
}

export interface CreateAgentRecoveryWorkerOptions<
  TScopeHandle,
> extends CreateAgentOptions<TScopeHandle> {
  readonly runtimeStore: AgentRuntimeStore;
  readonly workerId: string;
  readonly approvalPolicy?: AgentApprovalPolicy;
  readonly ids?: AgentIdGenerator;
  readonly clock?: AgentClock;
  readonly timer?: AgentTimer;
  readonly runLease?: {
    readonly durationMs?: number;
    readonly heartbeatIntervalMs?: number;
  };
  readonly recovery?: {
    readonly scanIntervalMs?: number;
    readonly claimBatchSize?: number;
    readonly concurrency?: number;
    readonly initialBackoffMs?: number;
    readonly maxBackoffMs?: number;
    readonly jitter?: () => number;
  };
}

export interface AgentRecoveryBatchResult {
  readonly claimed: number;
  readonly resumed: number;
  readonly blocked: number;
  readonly waitingForReconciliation: number;
}

export interface AgentRecoveryWorker {
  start(): Promise<void>;
  recoverOnce(): Promise<AgentRecoveryBatchResult>;
  dispose(): Promise<void>;
}

export interface StartAgentTaskCommand {
  readonly scope: AgentRequestScope;
  readonly input: AgentInput;
  readonly signal?: AbortSignal;
}

export interface ScopedTaskQuery {
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId: string;
}

export interface CancelAgentTaskCommand extends ScopedTaskQuery {
  readonly reason?: string;
}

export interface DecideAgentApprovalCommand extends ScopedTaskQuery {
  readonly runId: string;
  readonly approvalId: string;
  readonly decisionId: string;
  readonly decision: 'approved' | 'denied';
  readonly decidedBy: string;
  readonly reasonCode?: string;
}

export interface ReadAgentEventsQuery extends ScopedTaskQuery {
  readonly runId: string;
  readonly after?: string;
  readonly limit?: number;
}

export interface ReadAgentToolExecutionsQuery extends ScopedTaskQuery {
  readonly runId: string;
  readonly after?: string;
  readonly limit?: number;
}

export interface ReadAgentApprovalsQuery extends ScopedTaskQuery {
  readonly runId: string;
  readonly after?: string;
  readonly limit?: number;
}

export interface InspectAgentReconciliationCommand extends ScopedTaskQuery {
  readonly runId: string;
  readonly reconciliationCaseId: string;
}

export interface DecideAgentReconciliationCommand extends ScopedTaskQuery {
  readonly runId: string;
  readonly reconciliationCaseId: string;
  readonly resolutionId: string;
  readonly resolution: AgentReconciliationResolution;
  readonly resolvedBy: string;
  readonly reasonCode?: string;
  readonly presentation?: AgentReconciliationPresentation;
}

export interface ReadAgentReconciliationCasesQuery extends ScopedTaskQuery {
  readonly runId: string;
}

export interface ReadAgentReconciliationObservationsQuery extends InspectAgentReconciliationCommand {
  readonly after?: string;
  readonly limit?: number;
}

export interface AgentToolExecutionPage {
  readonly executions: readonly AgentToolExecutionSnapshot[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

export interface AgentApprovalPage {
  readonly approvals: readonly AgentApprovalSnapshot[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

export interface AgentReconciliationObservationPage {
  readonly observations: readonly AgentReconciliationObservationSnapshot[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

export type AgentTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_input'
  | 'waiting_for_approval'
  | 'waiting_for_reconciliation'
  | 'recovery_blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentRunStatus = AgentTaskStatus;
export type AgentTurnStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentTurnSnapshot {
  readonly turnId: string;
  readonly turnIndex: number;
  readonly status: AgentTurnStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentRunSnapshot {
  readonly runId: string;
  readonly status: AgentRunStatus;
  readonly turns: readonly AgentTurnSnapshot[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentTaskSnapshot {
  readonly taskId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly sessionId?: string;
  readonly status: AgentTaskStatus;
  readonly latestRunId: string;
  readonly activeRunId?: string;
  readonly runs: readonly AgentRunSnapshot[];
  readonly transcript: readonly Message[];
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type AgentHarnessEventPayload = AgentEvent extends infer TEvent
  ? TEvent extends AgentEvent
    ? Omit<TEvent, 'sequence' | 'turn'>
    : never
  : never;

export interface AgentHarnessEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly sessionId?: string;
  readonly taskId: string;
  readonly runId: string;
  readonly turnId?: string;
  readonly turnIndex?: number;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly payload: AgentHarnessEventPayload;
}

export interface AgentEventPage {
  readonly events: readonly AgentHarnessEvent[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

export interface AgentTaskResult {
  readonly status: AgentRunResult['status'];
  readonly taskId: string;
  readonly runId: string;
  readonly execution: AgentRunResult;
  readonly task: AgentTaskSnapshot;
}

export interface AgentTaskHandle {
  readonly taskId: string;
  readonly runId: string;
  readonly events: AsyncIterable<AgentHarnessEvent>;
  result(): Promise<AgentTaskResult>;
  cancel(reason?: string): void;
}

export interface AgentHarness {
  startTask(command: StartAgentTaskCommand): Promise<AgentTaskHandle>;
  getTask(query: ScopedTaskQuery): Promise<AgentTaskSnapshot | undefined>;
  readEvents(query: ReadAgentEventsQuery): Promise<AgentEventPage>;
  readToolExecutions(
    query: ReadAgentToolExecutionsQuery,
  ): Promise<AgentToolExecutionPage>;
  readApprovals(query: ReadAgentApprovalsQuery): Promise<AgentApprovalPage>;
  readReconciliationCases(
    query: ReadAgentReconciliationCasesQuery,
  ): Promise<readonly AgentReconciliationCaseSnapshot[]>;
  inspectReconciliation(
    command: InspectAgentReconciliationCommand,
  ): Promise<AgentReconciliationObservationSnapshot>;
  decideReconciliation(
    command: DecideAgentReconciliationCommand,
  ): Promise<import('./runtime-store.js').AgentReconciliationCaseSnapshot>;
  readReconciliationObservations(
    query: ReadAgentReconciliationObservationsQuery,
  ): Promise<AgentReconciliationObservationPage>;
  decideApproval(
    command: DecideAgentApprovalCommand,
  ): Promise<import('./runtime-store.js').AgentApprovalSnapshot>;
  cancelTask(command: CancelAgentTaskCommand): Promise<void>;
  handoff(): Promise<void>;
  dispose(): Promise<void>;
}
