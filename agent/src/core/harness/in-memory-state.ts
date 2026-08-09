import { randomUUID } from 'node:crypto';

import { AgentError } from '../errors.js';
import { hashRuntimeCommit } from './commit-hash.js';
import {
  applyRuntimeMutations,
  cloneRuntimeTask,
  createRuntimeTask,
  snapshotRuntimeTask,
  type MutableAgentTask,
} from './runtime-aggregate.js';
import type {
  AcknowledgeAgentOutboxCommand,
  AgentReconciliationObservationSnapshot,
  AgentOutboxBatch,
  AgentOutboxMessage,
  AgentOutboxUpdateResult,
  AgentApprovalMutation,
  AgentApprovalDecisionReceipt,
  AgentApprovalSnapshot,
  AgentApprovalStatus,
  AgentApprovalTransitionSnapshot,
  AgentReconciliationCaseSnapshot,
  AgentReconciliationCaseStatus,
  AgentReconciliationMutation,
  AgentRuntimeCommitReceipt,
  AgentRuntimeEventPage,
  AgentRuntimeStore,
  AgentRunClaimBatch,
  AgentToolExecutionAttemptSnapshot,
  AgentToolExecutionMutation,
  AgentToolExecutionSnapshot,
  AgentToolExecutionTransitionSnapshot,
  AgentRunCheckpointSnapshot,
  AgentRunExecutionLease,
  AgentRunLeaseGuard,
  AgentRunRecoveryAuditSnapshot,
  AgentRunRecoverySnapshot,
  AgentRuntimeCheckpointWrite,
  AgentRuntimeResumeState,
  ClaimRecoverableAgentRunsCommand,
  ClaimAgentOutboxCommand,
  AppendAgentReconciliationObservationCommand,
  CommitAgentRuntimeTaskCommand,
  CreateAgentRuntimeTaskCommand,
  DecideAgentRuntimeApprovalCommand,
  ReadAgentRuntimeEventsQuery,
  ReadAgentRunRecoveryCommand,
  ReleaseAgentRunLeaseCommand,
  ReleaseAgentOutboxCommand,
  RenewAgentRunLeaseCommand,
  ResolveAgentRuntimeApprovalCommand,
  ScopedRunQuery,
  ScopedAgentReconciliationCaseQuery,
} from './runtime-store.js';
import type {
  AgentReconciliationPresentation,
  AgentToolEffectOutcome,
  AgentToolExecutionStatus,
} from '../types.js';
import type {
  AgentHarnessEvent,
  AgentRequestScope,
  AgentTaskSnapshot,
  ScopedTaskQuery,
} from './types.js';

class InMemoryAgentRuntimeStore implements AgentRuntimeStore {
  readonly durability = 'ephemeral' as const;
  readonly runLeaseSupport = 'v1' as const;
  readonly checkpointResumeSupport = 'v3' as const;
  readonly reconciliationSupport = 'v1' as const;
  private readonly tasks = new Map<string, MutableAgentTask>();
  private readonly checkpoints = new Map<
    string,
    AgentRunCheckpointSnapshot[]
  >();
  private readonly events = new Map<string, AgentHarnessEvent[]>();
  private readonly toolExecutions = new Map<string, MutableToolExecution[]>();
  private readonly approvals = new Map<string, MutableApproval[]>();
  private readonly reconciliationCases = new Map<
    string,
    MutableReconciliationCase[]
  >();
  private readonly outbox: MutableOutboxMessage[] = [];
  private readonly commits = new Map<string, StoredCommit>();
  private readonly approvalDecisions = new Map<
    string,
    StoredApprovalDecision
  >();
  private readonly runLeases = new Map<string, MutableRunExecutionLease>();
  private readonly recoveryClaims = new Map<string, StoredRecoveryClaim>();
  private readonly leaseRenewals = new Map<string, StoredLeaseRenewal>();
  private readonly leaseReleases = new Map<string, StoredLeaseRelease>();
  private readonly recoveryAudit = new Map<
    string,
    AgentRunRecoveryAuditSnapshot[]
  >();
  private disposed = false;

  async createTask(
    command: CreateAgentRuntimeTaskCommand,
  ): Promise<AgentRuntimeCommitReceipt> {
    this.assertNotDisposed();
    const commandHash = hashRuntimeCommit(command);
    const commitKeyValue = commitKey(
      command.scope,
      command.taskId,
      command.commitId,
    );
    const existingCommit = this.commits.get(commitKeyValue);
    if (existingCommit) return reconcileCommit(existingCommit, commandHash);
    const key = taskKey(command.scope, command.taskId);
    if (this.tasks.has(key)) throw new TypeError('Agent task ID collision');
    const task = createRuntimeTask(command);
    const checkpoint = snapshotCheckpoint({
      query: { ...command.scope, taskId: command.taskId, runId: command.runId },
      checkpoint: command.checkpoint,
      version: 1,
      now: command.now,
    });
    const initialLease = command.initialLease
      ? createInitialRunLease(command, command.initialLease)
      : undefined;
    this.tasks.set(key, task);
    this.checkpoints.set(runKey(command.scope, command.taskId, command.runId), [
      checkpoint,
    ]);
    if (initialLease) {
      this.runLeases.set(
        runKey(command.scope, command.taskId, command.runId),
        initialLease,
      );
      this.appendRecoveryAudit(snapshotRunLease(initialLease), {
        recoveryId: command.initialLease!.ownershipId,
        action: 'initial_claim',
        occurredAt: command.now,
      });
    }
    const commitReceipt = receipt(
      task,
      command.commitId,
      checkpoint.version,
      undefined,
      initialLease ? snapshotRunLease(initialLease) : undefined,
    );
    this.commits.set(commitKeyValue, {
      commandHash,
      receipt: commitReceipt,
    });
    return commitReceipt;
  }

  async commitTask(
    command: CommitAgentRuntimeTaskCommand,
  ): Promise<AgentRuntimeCommitReceipt> {
    this.assertNotDisposed();
    const commandHash = hashRuntimeCommit(command);
    const commitKeyValue = commitKey(command, command.taskId, command.commitId);
    const existingCommit = this.commits.get(commitKeyValue);
    if (existingCommit) return reconcileCommit(existingCommit, commandHash);
    this.assertRunLease(command);
    const recoveryAuditLease = command.recoveryAudit
      ? this.recoveryAuditLease(command)
      : undefined;
    if (
      command.mutations.length === 0 &&
      (command.events?.length ?? 0) === 0 &&
      (command.toolExecutions?.length ?? 0) === 0 &&
      (command.approvals?.length ?? 0) === 0 &&
      (command.reconciliations?.length ?? 0) === 0 &&
      !command.checkpoint
    )
      throw new TypeError('Agent runtime commit has no changes');
    const taskKeyValue = taskKey(command, command.taskId);
    const task = this.tasks.get(taskKeyValue);
    if (!task) throw new TypeError('Agent task not found');
    if (task.version !== command.expectedVersion)
      throw new AgentError(
        'AGENT_STATE_CONFLICT',
        'Agent task state changed concurrently',
      );

    const nextTask = cloneRuntimeTask(task);
    const runKeyValue = runKey(command, command.taskId, command.runId);
    const currentEvents = this.events.get(runKeyValue) ?? [];
    const nextEvents = [...currentEvents];
    let nextSequence = (currentEvents.at(-1)?.sequence ?? 0) + 1;
    for (const event of command.events ?? []) {
      assertEventScope(event, command);
      if (event.sequence !== nextSequence)
        throw new TypeError('Agent event sequence is not contiguous');
      nextEvents.push(event);
      nextSequence += 1;
    }
    applyRuntimeMutations({
      task: nextTask,
      runId: command.runId,
      mutations: command.mutations,
      now: command.now,
    });
    const currentToolExecutions = this.toolExecutions.get(runKeyValue) ?? [];
    const nextToolExecutions = currentToolExecutions.map(cloneToolExecution);
    applyToolExecutionMutations({
      executions: nextToolExecutions,
      task: nextTask,
      runId: command.runId,
      commitId: command.commitId,
      mutations: command.toolExecutions ?? [],
      now: command.now,
    });
    const currentApprovals = this.approvals.get(runKeyValue) ?? [];
    const nextApprovals = currentApprovals.map(cloneApproval);
    applyApprovalMutations({
      approvals: nextApprovals,
      executions: nextToolExecutions,
      task: nextTask,
      runId: command.runId,
      commitId: command.commitId,
      mutations: command.approvals ?? [],
      now: command.now,
    });
    const currentReconciliationCases =
      this.reconciliationCases.get(runKeyValue) ?? [];
    const nextReconciliationCases = currentReconciliationCases.map(
      cloneReconciliationCase,
    );
    applyReconciliationMutations({
      cases: nextReconciliationCases,
      executions: nextToolExecutions,
      task: nextTask,
      runId: command.runId,
      mutations: command.reconciliations ?? [],
      now: command.now,
    });
    assertReconciliationCommit(command);

    const currentCheckpoints = this.checkpoints.get(runKeyValue) ?? [];
    const checkpoint = command.checkpoint
      ? snapshotCheckpoint({
          query: command,
          checkpoint: command.checkpoint,
          version: currentCheckpoints.length + 1,
          now: command.now,
        })
      : undefined;

    this.tasks.set(taskKeyValue, nextTask);
    this.events.set(runKeyValue, nextEvents);
    this.toolExecutions.set(runKeyValue, nextToolExecutions);
    this.approvals.set(runKeyValue, nextApprovals);
    this.reconciliationCases.set(runKeyValue, nextReconciliationCases);
    if (checkpoint)
      this.checkpoints.set(runKeyValue, [...currentCheckpoints, checkpoint]);
    for (const event of command.events ?? [])
      this.outbox.push({
        outboxId: event.eventId,
        event,
        status: 'pending',
        attempt: 0,
        availableAt: event.occurredAt,
      });
    if (command.recoveryAudit)
      this.appendRecoveryAudit(recoveryAuditLease!, {
        ...command.recoveryAudit,
        occurredAt: command.now,
      });
    const commitReceipt = receipt(
      nextTask,
      command.commitId,
      checkpoint?.version ?? currentCheckpoints.at(-1)?.version,
      nextEvents.at(-1)?.sequence,
    );
    this.commits.set(commitKeyValue, {
      commandHash,
      receipt: commitReceipt,
    });
    return commitReceipt;
  }

  async claimRecoverableRuns(
    command: ClaimRecoverableAgentRunsCommand,
  ): Promise<AgentRunClaimBatch> {
    this.assertNotDisposed();
    assertClaimCommand(command);
    const commandHash = hashRuntimeCommit(command);
    const existingClaim = this.recoveryClaims.get(command.claimId);
    if (existingClaim) {
      if (existingClaim.commandHash !== commandHash)
        throw new AgentError(
          'AGENT_COMMIT_MISMATCH',
          'Agent recovery claim ID was reused with different content',
        );
      return existingClaim.batch;
    }

    const leases: AgentRunExecutionLease[] = [];
    const now = Date.parse(command.now);
    for (const task of this.tasks.values()) {
      if (leases.length >= command.limit) break;
      if (
        isTerminalStatus(task.status) ||
        task.status === 'waiting_for_reconciliation' ||
        task.status === 'recovery_blocked'
      )
        continue;
      for (const run of task.runs) {
        if (leases.length >= command.limit) break;
        if (
          isTerminalStatus(run.status) ||
          run.status === 'waiting_for_reconciliation' ||
          run.status === 'recovery_blocked'
        )
          continue;
        const key = runKey(task.scope, task.taskId, run.runId);
        const checkpoint = this.checkpoints.get(key)?.at(-1);
        if (checkpoint?.configFingerprint !== command.configFingerprint)
          continue;
        const current = this.runLeases.get(key);
        if (
          current?.ownerId !== undefined &&
          current.leaseExpiresAt !== undefined &&
          Date.parse(current.leaseExpiresAt) > now
        )
          continue;
        if (
          current?.availableAt !== undefined &&
          Date.parse(current.availableAt) > now
        )
          continue;

        const next: MutableRunExecutionLease = {
          tenantId: task.scope.tenantId,
          projectId: task.scope.projectId,
          taskId: task.taskId,
          runId: run.runId,
          ownerId: command.ownerId,
          leaseToken: randomUUID(),
          fencingToken: (current?.fencingToken ?? 0) + 1,
          claimedAt: command.now,
          leaseExpiresAt: command.leaseExpiresAt,
          availableAt: command.now,
          configFingerprint: command.configFingerprint,
        };
        this.runLeases.set(key, next);
        const snapshot = snapshotRunLease(next);
        leases.push(snapshot);
        this.appendRecoveryAudit(snapshot, {
          recoveryId: command.claimId,
          action:
            snapshot.fencingToken === 1 ? 'initial_claim' : 'recovery_claim',
          occurredAt: command.now,
        });
      }
    }
    const batch = Object.freeze({ leases: Object.freeze(leases) });
    this.recoveryClaims.set(command.claimId, { commandHash, batch });
    return batch;
  }

  async renewRunLease(
    command: RenewAgentRunLeaseCommand,
  ): Promise<AgentRunExecutionLease> {
    this.assertNotDisposed();
    assertLeaseMutationCommand(command);
    const commandHash = hashRuntimeCommit(command);
    const existingRenewal = this.leaseRenewals.get(command.renewalId);
    if (existingRenewal) {
      if (existingRenewal.commandHash !== commandHash)
        throw leaseOperationMismatch('renewal');
      this.getOwnedRunLease(command);
      return existingRenewal.lease;
    }
    const lease = this.getOwnedRunLease(command);
    if (
      lease.leaseExpiresAt === undefined ||
      Date.parse(command.leaseExpiresAt) <= Date.parse(lease.leaseExpiresAt)
    )
      throw new TypeError('Agent Run lease renewal must extend expiry');
    lease.leaseExpiresAt = command.leaseExpiresAt;
    const snapshot = snapshotRunLease(lease);
    this.leaseRenewals.set(command.renewalId, {
      commandHash,
      lease: snapshot,
    });
    return snapshot;
  }

  async releaseRunLease(command: ReleaseAgentRunLeaseCommand): Promise<void> {
    this.assertNotDisposed();
    assertLeaseMutationCommand(command);
    const commandHash = hashRuntimeCommit(command);
    const existingRelease = this.leaseReleases.get(command.releaseId);
    if (existingRelease) {
      if (existingRelease.commandHash !== commandHash)
        throw leaseOperationMismatch('release');
      return;
    }
    const lease = this.getOwnedRunLease(command);
    const ownedLease = snapshotRunLease(lease);
    lease.ownerId = undefined;
    lease.leaseToken = undefined;
    lease.claimedAt = undefined;
    lease.leaseExpiresAt = undefined;
    lease.availableAt = command.availableAt;
    this.appendRecoveryAudit(ownedLease, {
      recoveryId: command.releaseId,
      action: command.action ?? 'released',
      reasonCode: command.reasonCode,
      occurredAt: command.now,
    });
    this.leaseReleases.set(command.releaseId, { commandHash });
  }

  async readRunRecoveryAudit(
    query: ScopedRunQuery,
  ): Promise<readonly AgentRunRecoveryAuditSnapshot[]> {
    this.assertNotDisposed();
    return Object.freeze([
      ...(this.recoveryAudit.get(runKey(query, query.taskId, query.runId)) ??
        []),
    ]);
  }

  async readRecoverySnapshot(
    command: ReadAgentRunRecoveryCommand,
  ): Promise<AgentRunRecoverySnapshot> {
    this.assertNotDisposed();
    const lease = this.getOwnedRunLease(command);
    const task = this.tasks.get(taskKey(command, command.taskId));
    const key = runKey(command, command.taskId, command.runId);
    const checkpoint = this.checkpoints.get(key)?.at(-1);
    if (!task || !checkpoint)
      throw new AgentError(
        'AGENT_RECOVERY_STATE_INVALID',
        'Agent Run recovery state is incomplete',
      );
    const events = this.events.get(key) ?? [];
    return Object.freeze({
      tenantId: command.tenantId,
      projectId: command.projectId,
      taskId: command.taskId,
      runId: command.runId,
      task: snapshotRuntimeTask(task),
      checkpoint,
      toolExecutions: Object.freeze(
        (this.toolExecutions.get(key) ?? []).map((execution) =>
          snapshotToolExecution(command, execution),
        ),
      ),
      approvals: Object.freeze(
        (this.approvals.get(key) ?? []).map((approval) =>
          snapshotApproval(command, approval),
        ),
      ),
      reconciliationCases: Object.freeze(
        (this.reconciliationCases.get(key) ?? []).map((reconciliationCase) =>
          snapshotReconciliationCase(command, reconciliationCase),
        ),
      ),
      modelAttempts: snapshotModelAttempts(events),
      lastEventSequence: events.at(-1)?.sequence ?? 0,
      lease: Object.freeze({
        ownerId: lease.ownerId!,
        fencingToken: lease.fencingToken,
        leaseExpiresAt: lease.leaseExpiresAt!,
      }),
    });
  }

  async getTask(
    query: ScopedTaskQuery,
  ): Promise<AgentTaskSnapshot | undefined> {
    this.assertNotDisposed();
    const task = this.tasks.get(taskKey(query, query.taskId));
    return task ? snapshotRuntimeTask(task) : undefined;
  }

  async getCheckpoint(
    query: ScopedRunQuery,
  ): Promise<AgentRunCheckpointSnapshot | undefined> {
    this.assertNotDisposed();
    return this.checkpoints
      .get(runKey(query, query.taskId, query.runId))
      ?.at(-1);
  }

  async readCheckpoints(
    query: ScopedRunQuery,
  ): Promise<readonly AgentRunCheckpointSnapshot[]> {
    this.assertNotDisposed();
    return Object.freeze([
      ...(this.checkpoints.get(runKey(query, query.taskId, query.runId)) ?? []),
    ]);
  }

  async readEvents(
    query: ReadAgentRuntimeEventsQuery,
  ): Promise<AgentRuntimeEventPage> {
    this.assertNotDisposed();
    const afterSequence = query.afterSequence ?? 0;
    const matching = (
      this.events.get(runKey(query, query.taskId, query.runId)) ?? []
    ).filter((event) => event.sequence > afterSequence);
    return Object.freeze({
      events: Object.freeze(matching.slice(0, query.limit)),
      hasMore: matching.length > query.limit,
    });
  }

  async readToolExecutions(
    query: ScopedRunQuery,
  ): Promise<readonly AgentToolExecutionSnapshot[]> {
    this.assertNotDisposed();
    return Object.freeze(
      (
        this.toolExecutions.get(runKey(query, query.taskId, query.runId)) ?? []
      ).map((execution) => snapshotToolExecution(query, execution)),
    );
  }

  async readApprovals(
    query: ScopedRunQuery,
  ): Promise<readonly AgentApprovalSnapshot[]> {
    this.assertNotDisposed();
    return Object.freeze(
      (this.approvals.get(runKey(query, query.taskId, query.runId)) ?? []).map(
        (approval) => snapshotApproval(query, approval),
      ),
    );
  }

  async readReconciliationCases(
    query: ScopedRunQuery,
  ): Promise<readonly AgentReconciliationCaseSnapshot[]> {
    this.assertNotDisposed();
    return Object.freeze(
      (
        this.reconciliationCases.get(
          runKey(query, query.taskId, query.runId),
        ) ?? []
      ).map((reconciliationCase) =>
        snapshotReconciliationCase(query, reconciliationCase),
      ),
    );
  }

  async readReconciliationObservations(
    query: ScopedAgentReconciliationCaseQuery,
  ): Promise<readonly AgentReconciliationObservationSnapshot[]> {
    this.assertNotDisposed();
    const reconciliationCase = this.reconciliationCases
      .get(runKey(query, query.taskId, query.runId))
      ?.find(
        (candidate) =>
          candidate.reconciliationCaseId === query.reconciliationCaseId,
      );
    return Object.freeze(
      (reconciliationCase?.observations ?? []).map((observation) =>
        snapshotReconciliationObservation(query, observation),
      ),
    );
  }

  async appendReconciliationObservation(
    command: AppendAgentReconciliationObservationCommand,
  ): Promise<AgentReconciliationObservationSnapshot> {
    this.assertNotDisposed();
    assertReconciliationObservation(command);
    const key = runKey(command, command.taskId, command.runId);
    const currentCases = this.reconciliationCases.get(key) ?? [];
    const nextCases = currentCases.map(cloneReconciliationCase);
    const reconciliationCase = nextCases.find(
      (candidate) =>
        candidate.reconciliationCaseId === command.reconciliationCaseId,
    );
    if (!reconciliationCase)
      throw new AgentError(
        'AGENT_RECONCILIATION_CASE_NOT_FOUND',
        'Agent reconciliation Case not found',
      );
    if (reconciliationCase.status !== 'waiting')
      throw new TypeError(
        'Agent reconciliation Observation requires a waiting Case',
      );
    const observation: MutableReconciliationObservation = {
      sequence: reconciliationCase.observations.length + 1,
      adapterId: command.adapterId,
      adapterVersion: command.adapterVersion,
      outcome: command.outcome,
      reasonCode: command.reasonCode,
      presentation: command.presentation
        ? freezeReconciliationPresentation(command.presentation)
        : undefined,
      observedAt: command.observedAt,
    };
    reconciliationCase.observations.push(observation);
    this.reconciliationCases.set(key, nextCases);
    return snapshotReconciliationObservation(command, observation);
  }

  async decideApproval(
    command: DecideAgentRuntimeApprovalCommand,
  ): Promise<AgentApprovalDecisionReceipt> {
    this.assertNotDisposed();
    assertApprovalDecision(command);
    const decisionKey = approvalDecisionKey(command);
    const decisionHash = hashApprovalDecision(command);
    const storedDecision = this.approvalDecisions.get(decisionKey);
    if (storedDecision)
      return reconcileApprovalDecision(storedDecision, decisionHash);

    const taskKeyValue = taskKey(command, command.taskId);
    const runKeyValue = runKey(command, command.taskId, command.runId);
    const task = this.tasks.get(taskKeyValue);
    const approvals = this.approvals.get(runKeyValue);
    const approval = approvals?.find(
      (candidate) => candidate.approvalId === command.approvalId,
    );
    if (!task || !approval)
      throw new AgentError(
        'AGENT_APPROVAL_NOT_FOUND',
        'Agent Approval not found',
      );
    const run = task.runs.find(
      (candidate) => candidate.runId === command.runId,
    );
    if (approval.status !== 'pending') {
      if (
        approval.decisionId === command.decisionId &&
        approval.decision === command.decision &&
        approval.decidedBy === command.decidedBy &&
        approval.decisionReasonCode === command.reasonCode
      )
        return Object.freeze({
          approval: snapshotApproval(command, approval),
          version: task.version,
        });
      if (approval.decisionId === command.decisionId)
        throw new AgentError(
          'AGENT_APPROVAL_DECISION_MISMATCH',
          'Agent Approval decision ID was reused with different content',
        );
      throw new AgentError(
        'AGENT_APPROVAL_ALREADY_DECIDED',
        'Agent Approval is already decided',
      );
    }
    if (
      task.status !== 'waiting_for_approval' ||
      run?.status !== 'waiting_for_approval'
    )
      throw new TypeError('Agent Approval decision requires a waiting run');
    if (
      approval.status === 'pending' &&
      Date.parse(command.now) >= Date.parse(approval.expiresAt)
    )
      return this.resolveApproval({
        ...command,
        resolution: 'expired',
      });

    const nextTask = cloneRuntimeTask(task);
    const nextApprovals = approvals!.map(cloneApproval);
    const nextApproval = nextApprovals.find(
      (candidate) => candidate.approvalId === command.approvalId,
    )!;
    nextApproval.status = command.decision;
    nextApproval.decisionId = command.decisionId;
    nextApproval.decision = command.decision;
    nextApproval.decidedBy = command.decidedBy;
    nextApproval.decisionReasonCode = command.reasonCode;
    nextApproval.decidedAt = command.now;
    nextApproval.rowVersion += 1;
    nextApproval.transitions.push({
      sequence: nextApproval.transitions.length + 1,
      from: 'pending',
      to: command.decision,
      commitId: command.commitId,
      occurredAt: command.now,
      reasonCode:
        command.reasonCode ??
        (command.decision === 'approved' ? 'APPROVED' : 'DENIED'),
      decisionId: command.decisionId,
    });
    nextTask.version += 1;
    nextTask.updatedAt = command.now;
    const nextRun = nextTask.runs.find(
      (candidate) => candidate.runId === command.runId,
    );
    if (!nextRun) throw new TypeError('Agent Approval Run not found');
    nextRun.updatedAt = command.now;
    this.tasks.set(taskKeyValue, nextTask);
    this.approvals.set(runKeyValue, nextApprovals);
    const decisionReceipt = Object.freeze({
      approval: snapshotApproval(command, nextApproval),
      version: nextTask.version,
    });
    this.approvalDecisions.set(decisionKey, {
      commandHash: decisionHash,
      receipt: decisionReceipt,
    });
    return decisionReceipt;
  }

  async resolveApproval(
    command: ResolveAgentRuntimeApprovalCommand,
  ): Promise<AgentApprovalDecisionReceipt> {
    this.assertNotDisposed();
    const taskKeyValue = taskKey(command, command.taskId);
    const runKeyValue = runKey(command, command.taskId, command.runId);
    const task = this.tasks.get(taskKeyValue);
    const approvals = this.approvals.get(runKeyValue);
    const approval = approvals?.find(
      (candidate) => candidate.approvalId === command.approvalId,
    );
    const run = task?.runs.find(
      (candidate) => candidate.runId === command.runId,
    );
    if (!task || !approval || !run)
      throw new AgentError(
        'AGENT_APPROVAL_NOT_FOUND',
        'Agent Approval not found',
      );
    if (approval.status !== 'pending')
      return Object.freeze({
        approval: snapshotApproval(command, approval),
        version: task.version,
      });
    this.assertRunLease(command);
    if (
      command.resolution === 'expired' &&
      Date.parse(command.now) < Date.parse(approval.expiresAt)
    )
      throw new TypeError('Agent Approval has not expired');
    if (
      task.status !== 'waiting_for_approval' ||
      run.status !== 'waiting_for_approval'
    )
      throw new TypeError('Agent Approval resolution requires a waiting run');

    const nextTask = cloneRuntimeTask(task);
    const nextApprovals = approvals!.map(cloneApproval);
    const nextApproval = nextApprovals.find(
      (candidate) => candidate.approvalId === command.approvalId,
    )!;
    nextApproval.status = command.resolution;
    nextApproval.rowVersion += 1;
    nextApproval.transitions.push({
      sequence: nextApproval.transitions.length + 1,
      from: 'pending',
      to: command.resolution,
      commitId: command.commitId,
      occurredAt: command.now,
      reasonCode:
        command.resolution === 'expired'
          ? 'APPROVAL_EXPIRED'
          : 'APPROVAL_CANCELLED',
    });
    nextTask.version += 1;
    nextTask.updatedAt = command.now;
    const nextRun = nextTask.runs.find(
      (candidate) => candidate.runId === command.runId,
    )!;
    nextRun.updatedAt = command.now;
    this.tasks.set(taskKeyValue, nextTask);
    this.approvals.set(runKeyValue, nextApprovals);
    return Object.freeze({
      approval: snapshotApproval(command, nextApproval),
      version: nextTask.version,
    });
  }

  async claimOutbox(
    command: ClaimAgentOutboxCommand,
  ): Promise<AgentOutboxBatch> {
    this.assertNotDisposed();
    const messages: AgentOutboxMessage[] = [];
    for (const item of this.outbox) {
      if (messages.length >= command.limit) break;
      const available =
        (item.status === 'pending' && item.availableAt <= command.now) ||
        (item.status === 'delivering' &&
          item.leaseExpiresAt !== undefined &&
          item.leaseExpiresAt <= command.now);
      if (!available) continue;
      item.status = 'delivering';
      item.attempt += 1;
      item.leaseOwner = command.workerId;
      item.leaseExpiresAt = command.leaseExpiresAt;
      messages.push(
        Object.freeze({
          outboxId: item.outboxId,
          event: item.event,
          attempt: item.attempt,
          leaseOwner: command.workerId,
          leaseExpiresAt: command.leaseExpiresAt,
        }),
      );
    }
    return Object.freeze({ messages: Object.freeze(messages) });
  }

  async acknowledgeOutbox(
    command: AcknowledgeAgentOutboxCommand,
  ): Promise<AgentOutboxUpdateResult> {
    this.assertNotDisposed();
    const ids = new Set(command.outboxIds);
    let updatedCount = 0;
    for (const item of this.outbox) {
      if (
        !ids.has(item.outboxId) ||
        item.status !== 'delivering' ||
        item.leaseOwner !== command.workerId
      )
        continue;
      item.status = 'delivered';
      item.deliveredAt = command.now;
      item.leaseOwner = undefined;
      item.leaseExpiresAt = undefined;
      updatedCount += 1;
    }
    return Object.freeze({ updatedCount });
  }

  async releaseOutbox(
    command: ReleaseAgentOutboxCommand,
  ): Promise<AgentOutboxUpdateResult> {
    this.assertNotDisposed();
    const ids = new Set(command.outboxIds);
    let updatedCount = 0;
    for (const item of this.outbox) {
      if (
        !ids.has(item.outboxId) ||
        item.status !== 'delivering' ||
        item.leaseOwner !== command.workerId
      )
        continue;
      item.status = 'pending';
      item.availableAt = command.availableAt;
      item.leaseOwner = undefined;
      item.leaseExpiresAt = undefined;
      updatedCount += 1;
    }
    return Object.freeze({ updatedCount });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.tasks.clear();
    this.checkpoints.clear();
    this.events.clear();
    this.toolExecutions.clear();
    this.approvals.clear();
    this.reconciliationCases.clear();
    this.outbox.splice(0);
    this.commits.clear();
    this.approvalDecisions.clear();
    this.runLeases.clear();
    this.recoveryClaims.clear();
    this.leaseRenewals.clear();
    this.leaseReleases.clear();
    this.recoveryAudit.clear();
  }

  private assertRunLease(
    command: ScopedRunQuery & {
      readonly lease?: AgentRunLeaseGuard;
      readonly now: string;
    },
  ): void {
    const lease = this.runLeases.get(
      runKey(command, command.taskId, command.runId),
    );
    if (!lease) return;
    if (
      !command.lease ||
      lease.ownerId === undefined ||
      lease.leaseToken !== command.lease.leaseToken ||
      lease.fencingToken !== command.lease.fencingToken ||
      lease.leaseExpiresAt === undefined ||
      Date.parse(lease.leaseExpiresAt) <= Date.parse(command.now)
    )
      throw runLeaseLost();
  }

  private getOwnedRunLease(
    command:
      | RenewAgentRunLeaseCommand
      | ReleaseAgentRunLeaseCommand
      | ReadAgentRunRecoveryCommand,
  ): MutableRunExecutionLease {
    const lease = this.runLeases.get(
      runKey(command, command.taskId, command.runId),
    );
    if (
      !lease ||
      lease.ownerId !== command.ownerId ||
      lease.leaseToken !== command.leaseToken ||
      lease.fencingToken !== command.fencingToken ||
      lease.leaseExpiresAt === undefined ||
      Date.parse(lease.leaseExpiresAt) <= Date.parse(command.now)
    )
      throw runLeaseLost();
    return lease;
  }

  private recoveryAuditLease(
    command: CommitAgentRuntimeTaskCommand,
  ): AgentRunExecutionLease {
    if (
      !command.lease ||
      !command.recoveryAudit ||
      command.recoveryAudit.recoveryId.trim() === '' ||
      command.recoveryAudit.reasonCode.trim() === ''
    )
      throw new TypeError('Agent recovery audit is invalid');
    const lease = this.runLeases.get(
      runKey(command, command.taskId, command.runId),
    );
    if (!lease) throw runLeaseLost();
    return snapshotRunLease(lease);
  }

  private appendRecoveryAudit(
    lease: AgentRunExecutionLease,
    input: Pick<
      AgentRunRecoveryAuditSnapshot,
      'recoveryId' | 'action' | 'occurredAt' | 'reasonCode'
    >,
  ): void {
    const key = runKey(lease, lease.taskId, lease.runId);
    const records = this.recoveryAudit.get(key) ?? [];
    records.push(
      Object.freeze({
        tenantId: lease.tenantId,
        projectId: lease.projectId,
        taskId: lease.taskId,
        runId: lease.runId,
        sequence: records.length + 1,
        recoveryId: input.recoveryId,
        ownerId: lease.ownerId,
        fencingToken: lease.fencingToken,
        action: input.action,
        reasonCode: input.reasonCode,
        occurredAt: input.occurredAt,
      }),
    );
    this.recoveryAudit.set(key, records);
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new TypeError('Agent Runtime Store is disposed');
  }
}

function snapshotModelAttempts(
  events: readonly AgentHarnessEvent[],
): readonly import('./runtime-store.js').AgentModelAttemptSnapshot[] {
  const attempts = new Map<number, number>();
  for (const event of events) {
    if (event.payload.type !== 'model_start' || event.turnIndex === undefined)
      continue;
    const attempt =
      event.payload.modelAttempt ?? (attempts.get(event.turnIndex) ?? 0) + 1;
    attempts.set(
      event.turnIndex,
      Math.max(attempts.get(event.turnIndex) ?? 0, attempt),
    );
  }
  return Object.freeze(
    [...attempts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([turnIndex, lastAttempt]) =>
        Object.freeze({ turnIndex, lastAttempt }),
      ),
  );
}

export function createInMemoryAgentRuntimeStore(): AgentRuntimeStore {
  return new InMemoryAgentRuntimeStore();
}

function taskKey(
  scope: Pick<AgentRequestScope, 'tenantId' | 'projectId'>,
  taskId: string,
): string {
  return JSON.stringify([scope.tenantId, scope.projectId, taskId]);
}

function runKey(
  scope: Pick<AgentRequestScope, 'tenantId' | 'projectId'>,
  taskId: string,
  runId: string,
): string {
  return JSON.stringify([scope.tenantId, scope.projectId, taskId, runId]);
}

function assertClaimCommand(command: ClaimRecoverableAgentRunsCommand): void {
  if (
    !hasBoundedUtf8(command.claimId, 256) ||
    !hasBoundedUtf8(command.ownerId, 256) ||
    !hasBoundedUtf8(command.configFingerprint, 512) ||
    !Number.isInteger(command.limit) ||
    command.limit < 1 ||
    command.limit > 100 ||
    !isValidTimestamp(command.now) ||
    !isValidTimestamp(command.leaseExpiresAt) ||
    Date.parse(command.leaseExpiresAt) <= Date.parse(command.now)
  )
    throw new TypeError('Agent recovery claim is invalid');
}

function createInitialRunLease(
  command: CreateAgentRuntimeTaskCommand,
  initialLease: NonNullable<CreateAgentRuntimeTaskCommand['initialLease']>,
): MutableRunExecutionLease {
  if (
    !hasBoundedUtf8(initialLease.ownershipId, 256) ||
    !hasBoundedUtf8(initialLease.ownerId, 256) ||
    !isValidTimestamp(command.now) ||
    !isValidTimestamp(initialLease.leaseExpiresAt) ||
    Date.parse(initialLease.leaseExpiresAt) <= Date.parse(command.now)
  )
    throw new TypeError('Initial Agent Run lease is invalid');
  return {
    tenantId: command.scope.tenantId,
    projectId: command.scope.projectId,
    taskId: command.taskId,
    runId: command.runId,
    ownerId: initialLease.ownerId,
    leaseToken: randomUUID(),
    fencingToken: 1,
    claimedAt: command.now,
    leaseExpiresAt: initialLease.leaseExpiresAt,
    availableAt: command.now,
    configFingerprint: command.checkpoint.configFingerprint,
  };
}

function assertLeaseMutationCommand(
  command: RenewAgentRunLeaseCommand | ReleaseAgentRunLeaseCommand,
): void {
  const boundary =
    'leaseExpiresAt' in command ? command.leaseExpiresAt : command.availableAt;
  if (
    !hasBoundedUtf8(
      'renewalId' in command ? command.renewalId : command.releaseId,
      256,
    ) ||
    !hasBoundedUtf8(command.ownerId, 256) ||
    !hasBoundedUtf8(command.leaseToken, 256) ||
    !Number.isSafeInteger(command.fencingToken) ||
    command.fencingToken < 1 ||
    !isValidTimestamp(command.now) ||
    !isValidTimestamp(boundary) ||
    Date.parse(boundary) < Date.parse(command.now) ||
    ('leaseExpiresAt' in command &&
      Date.parse(command.leaseExpiresAt) <= Date.parse(command.now))
  )
    throw new TypeError('Agent Run lease command is invalid');
}

function isValidTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isTerminalStatus(status: string): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

function snapshotRunLease(
  lease: MutableRunExecutionLease,
): AgentRunExecutionLease {
  if (
    lease.ownerId === undefined ||
    lease.leaseToken === undefined ||
    lease.claimedAt === undefined ||
    lease.leaseExpiresAt === undefined
  )
    throw new TypeError('Agent Run lease has no owner');
  return Object.freeze({
    tenantId: lease.tenantId,
    projectId: lease.projectId,
    taskId: lease.taskId,
    runId: lease.runId,
    ownerId: lease.ownerId,
    leaseToken: lease.leaseToken,
    fencingToken: lease.fencingToken,
    claimedAt: lease.claimedAt,
    leaseExpiresAt: lease.leaseExpiresAt,
  });
}

function runLeaseLost(): AgentError {
  return new AgentError(
    'AGENT_RUN_LEASE_LOST',
    'Agent Run execution lease is no longer owned',
  );
}

function leaseOperationMismatch(operation: 'renewal' | 'release'): AgentError {
  return new AgentError(
    'AGENT_COMMIT_MISMATCH',
    `Agent Run lease ${operation} ID was reused with different content`,
  );
}

function receipt(
  task: MutableAgentTask,
  commitId: string,
  checkpointVersion?: number,
  lastSequence?: number,
  lease?: AgentRunExecutionLease,
): AgentRuntimeCommitReceipt {
  return Object.freeze({
    commitId,
    version: task.version,
    task: snapshotRuntimeTask(task),
    checkpointVersion,
    lastSequence,
    lease,
  });
}

function commitKey(
  scope: Pick<AgentRequestScope, 'tenantId' | 'projectId'>,
  taskId: string,
  commitId: string,
): string {
  return JSON.stringify([scope.tenantId, scope.projectId, taskId, commitId]);
}

function reconcileCommit(
  stored: StoredCommit,
  commandHash: string,
): AgentRuntimeCommitReceipt {
  if (stored.commandHash !== commandHash)
    throw new AgentError(
      'AGENT_COMMIT_MISMATCH',
      'Agent commit ID was reused with different content',
    );
  return stored.receipt;
}

function assertApprovalDecision(
  command: DecideAgentRuntimeApprovalCommand,
): void {
  if (
    !hasBoundedUtf8(command.decisionId, 256) ||
    !hasBoundedUtf8(command.decidedBy, 256) ||
    (command.reasonCode !== undefined &&
      (command.reasonCode.length > 128 ||
        !/^[A-Z][A-Z0-9_]*$/.test(command.reasonCode)))
  )
    throw new TypeError('Agent Approval decision is invalid');
}

function hasBoundedUtf8(value: string, maximumBytes: number): boolean {
  return (
    value.trim() !== '' && Buffer.byteLength(value, 'utf8') <= maximumBytes
  );
}

function hasReasonCode(value: string): boolean {
  return value.length <= 128 && /^[A-Z][A-Z0-9_]*$/.test(value);
}

function isReconciliationObservationOutcome(
  outcome: string,
): outcome is AgentReconciliationObservationSnapshot['outcome'] {
  return ['applied', 'not_applied', 'inconclusive', 'failed'].includes(outcome);
}

function isReconciliationPresentation(
  presentation: AgentReconciliationPresentation,
): boolean {
  return (
    hasBoundedUtf8(presentation.title, 512) &&
    (presentation.description === undefined ||
      typeof presentation.description === 'string') &&
    (presentation.fields === undefined ||
      presentation.fields.every(
        (field) =>
          hasBoundedUtf8(field.label, 512) && typeof field.value === 'string',
      )) &&
    Buffer.byteLength(JSON.stringify(presentation), 'utf8') <= 32 * 1024
  );
}

function approvalDecisionKey(
  command: DecideAgentRuntimeApprovalCommand,
): string {
  return JSON.stringify([
    command.tenantId,
    command.projectId,
    command.taskId,
    command.runId,
    command.decisionId,
  ]);
}

function hashApprovalDecision(
  command: DecideAgentRuntimeApprovalCommand,
): string {
  return hashRuntimeCommit({
    tenantId: command.tenantId,
    projectId: command.projectId,
    taskId: command.taskId,
    runId: command.runId,
    approvalId: command.approvalId,
    decisionId: command.decisionId,
    decision: command.decision,
    decidedBy: command.decidedBy,
    reasonCode: command.reasonCode,
  });
}

function reconcileApprovalDecision(
  stored: StoredApprovalDecision,
  commandHash: string,
): AgentApprovalDecisionReceipt {
  if (stored.commandHash !== commandHash)
    throw new AgentError(
      'AGENT_APPROVAL_DECISION_MISMATCH',
      'Agent Approval decision ID was reused with different content',
    );
  return stored.receipt;
}

function snapshotCheckpoint(input: {
  query: ScopedRunQuery;
  checkpoint: AgentRuntimeCheckpointWrite;
  version: number;
  now: string;
}): AgentRunCheckpointSnapshot {
  return Object.freeze({
    tenantId: input.query.tenantId,
    projectId: input.query.projectId,
    taskId: input.query.taskId,
    runId: input.query.runId,
    version: input.version,
    kind: input.checkpoint.kind,
    input: input.checkpoint.input,
    transcript: Object.freeze([...input.checkpoint.transcript]),
    turnIndex: input.checkpoint.turnIndex,
    executionPosition: input.checkpoint.executionPosition,
    nextTurnIndex: input.checkpoint.nextTurnIndex,
    resumeState: input.checkpoint.resumeState
      ? snapshotResumeState(input.checkpoint.resumeState)
      : undefined,
    harnessProtocolVersion: input.checkpoint.harnessProtocolVersion,
    checkpointSchemaVersion: input.checkpoint.checkpointSchemaVersion,
    configFingerprint: input.checkpoint.configFingerprint,
    createdAt: input.now,
  });
}

function snapshotResumeState(
  state: AgentRuntimeResumeState,
): AgentRuntimeResumeState {
  if (state.kind !== 'finalize') return Object.freeze({ ...state });
  const result =
    state.result.status === 'completed'
      ? Object.freeze({
          ...state.result,
          response: Object.freeze({ ...state.result.response }),
          transcript: Object.freeze([...state.result.transcript]),
        })
      : state.result.status === 'failed'
        ? Object.freeze({
            ...state.result,
            error: Object.freeze({ ...state.result.error }),
            transcript: Object.freeze([...state.result.transcript]),
          })
        : Object.freeze({
            ...state.result,
            error: Object.freeze({ ...state.result.error }),
            transcript: Object.freeze([...state.result.transcript]),
          });
  return Object.freeze({
    kind: 'finalize',
    result,
  });
}

function assertEventScope(
  event: AgentHarnessEvent,
  command: CommitAgentRuntimeTaskCommand,
): void {
  if (
    event.tenantId !== command.tenantId ||
    event.projectId !== command.projectId ||
    event.taskId !== command.taskId ||
    event.runId !== command.runId
  )
    throw new TypeError('Agent event scope does not match commit scope');
}

interface MutableOutboxMessage {
  outboxId: string;
  event: AgentHarnessEvent;
  status: 'pending' | 'delivering' | 'delivered';
  attempt: number;
  availableAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  deliveredAt?: string;
}

interface StoredCommit {
  readonly commandHash: string;
  readonly receipt: AgentRuntimeCommitReceipt;
}

interface StoredApprovalDecision {
  readonly commandHash: string;
  readonly receipt: AgentApprovalDecisionReceipt;
}

interface StoredRecoveryClaim {
  readonly commandHash: string;
  readonly batch: AgentRunClaimBatch;
}

interface StoredLeaseRenewal {
  readonly commandHash: string;
  readonly lease: AgentRunExecutionLease;
}

interface StoredLeaseRelease {
  readonly commandHash: string;
}

interface MutableRunExecutionLease extends ScopedRunQuery {
  ownerId?: string;
  leaseToken?: string;
  fencingToken: number;
  claimedAt?: string;
  leaseExpiresAt?: string;
  availableAt: string;
  configFingerprint: string;
}

interface MutableToolExecution {
  turnId: string;
  turnIndex: number;
  toolExecutionId: string;
  toolCallId: string;
  proposalSequence: number;
  toolName: string;
  argumentsDigest: string;
  sideEffect?: 'none' | 'reversible' | 'external';
  idempotency?: 'none' | 'keyed';
  timeoutMs?: number;
  idempotencyKey?: string;
  deadline?: string;
  status: AgentToolExecutionStatus;
  effectOutcome?: AgentToolEffectOutcome;
  retryable?: boolean;
  attemptCount: number;
  attempts: MutableToolExecutionAttempt[];
  transitions: MutableToolExecutionTransition[];
  proposedAt: string;
  preparedAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

interface MutableApproval {
  turnId: string;
  approvalId: string;
  toolExecutionId: string;
  proposalSequence: number;
  policyId: string;
  policyVersion: string;
  argumentsDigest: string;
  presentation: AgentApprovalSnapshot['presentation'];
  status: AgentApprovalStatus;
  transitions: MutableApprovalTransition[];
  requestedAt: string;
  expiresAt: string;
  rowVersion: number;
  decisionId?: string;
  decision?: 'approved' | 'denied';
  decidedBy?: string;
  decisionReasonCode?: string;
  decidedAt?: string;
  consumeId?: string;
  consumedAt?: string;
}

interface MutableApprovalTransition {
  sequence: number;
  from?: AgentApprovalStatus;
  to: AgentApprovalStatus;
  commitId: string;
  occurredAt: string;
  reasonCode?: string;
  decisionId?: string;
  consumeId?: string;
}

interface MutableReconciliationCase {
  reconciliationCaseId: string;
  toolExecutionId: string;
  attemptId: string;
  toolName: string;
  status: AgentReconciliationCaseStatus;
  reasonCode: 'EXTERNAL_EFFECT_UNKNOWN';
  createdAt: string;
  rowVersion: number;
  observations: MutableReconciliationObservation[];
}

interface MutableReconciliationObservation {
  sequence: number;
  adapterId: string;
  adapterVersion: string;
  outcome: AgentReconciliationObservationSnapshot['outcome'];
  reasonCode: string;
  presentation?: AgentReconciliationPresentation;
  observedAt: string;
}

interface MutableToolExecutionAttempt {
  attemptId: string;
  attempt: number;
  status: AgentToolExecutionAttemptSnapshot['status'];
  effectOutcome?: AgentToolEffectOutcome;
  deadline: string;
  startedAt: string;
  finishedAt?: string;
  errorCode?: string;
  resultDigest?: string;
}

interface MutableToolExecutionTransition {
  sequence: number;
  from?: AgentToolExecutionStatus;
  to: AgentToolExecutionStatus;
  attemptId?: string;
  commitId: string;
  occurredAt: string;
  reasonCode?: string;
}

function applyToolExecutionMutations(input: {
  executions: MutableToolExecution[];
  task: MutableAgentTask;
  runId: string;
  commitId: string;
  mutations: readonly AgentToolExecutionMutation[];
  now: string;
}): void {
  const run = input.task.runs.find(
    (candidate) => candidate.runId === input.runId,
  );
  if (!run) throw new TypeError('Agent run not found for tool execution');

  for (const mutation of input.mutations) {
    if (mutation.type === 'tool_execution_proposed') {
      if (
        input.executions.some(
          (execution) =>
            execution.toolExecutionId === mutation.toolExecutionId ||
            execution.toolCallId === mutation.toolCallId ||
            execution.proposalSequence === mutation.proposalSequence,
        )
      )
        throw new TypeError('Agent tool execution identity collision');
      const turn = run.turns.find(
        (candidate) =>
          candidate.turnId === mutation.turnId &&
          candidate.turnIndex === mutation.turnIndex,
      );
      if (!turn) throw new TypeError('Agent tool execution turn not found');
      const execution: MutableToolExecution = {
        turnId: mutation.turnId,
        turnIndex: mutation.turnIndex,
        toolExecutionId: mutation.toolExecutionId,
        toolCallId: mutation.toolCallId,
        proposalSequence: mutation.proposalSequence,
        toolName: mutation.toolName,
        argumentsDigest: mutation.argumentsDigest,
        status: 'proposed',
        attemptCount: 0,
        attempts: [],
        transitions: [],
        proposedAt: input.now,
      };
      appendToolTransition(execution, {
        to: 'proposed',
        commitId: input.commitId,
        occurredAt: input.now,
      });
      input.executions.push(execution);
      continue;
    }

    const execution = input.executions.find(
      (candidate) => candidate.toolExecutionId === mutation.toolExecutionId,
    );
    if (!execution) throw new TypeError('Agent tool execution not found');

    if (mutation.type === 'tool_execution_rejected') {
      assertToolExecutionStatus(execution, 'proposed');
      execution.effectOutcome = 'not_applied';
      execution.retryable = false;
      transitionToolExecution(
        execution,
        'failed',
        input,
        undefined,
        mutation.reasonCode,
      );
      execution.finishedAt = input.now;
      continue;
    }

    if (mutation.type === 'tool_execution_awaiting_approval') {
      assertToolExecutionStatus(execution, 'proposed');
      execution.sideEffect = mutation.sideEffect;
      execution.idempotency = mutation.idempotency;
      execution.timeoutMs = mutation.timeoutMs;
      transitionToolExecution(
        execution,
        'awaiting_approval',
        input,
        undefined,
        'APPROVAL_REQUIRED',
      );
      continue;
    }

    if (mutation.type === 'tool_execution_approval_rejected') {
      assertToolExecutionStatus(execution, 'awaiting_approval');
      execution.effectOutcome = 'not_applied';
      execution.retryable = false;
      transitionToolExecution(
        execution,
        'failed',
        input,
        undefined,
        mutation.reasonCode,
      );
      execution.finishedAt = input.now;
      continue;
    }

    if (mutation.type === 'tool_execution_prepared') {
      const previousStatus = execution.status;
      if (
        previousStatus !== 'proposed' &&
        previousStatus !== 'awaiting_approval'
      )
        throw new TypeError(
          `Agent tool execution cannot transition from ${previousStatus}`,
        );
      if (
        (mutation.idempotency === 'keyed') !==
        (mutation.idempotencyKey !== undefined)
      )
        throw new TypeError('Agent tool idempotency key does not match mode');
      execution.sideEffect = mutation.sideEffect;
      execution.idempotency = mutation.idempotency;
      execution.timeoutMs = mutation.timeoutMs;
      execution.idempotencyKey = mutation.idempotencyKey;
      execution.deadline = mutation.deadline;
      transitionToolExecution(
        execution,
        'prepared',
        input,
        undefined,
        previousStatus === 'awaiting_approval'
          ? 'APPROVAL_CONSUMED'
          : undefined,
      );
      execution.preparedAt = input.now;
      continue;
    }

    if (mutation.type === 'tool_execution_reprepared') {
      assertToolExecutionStatus(execution, 'prepared');
      if (!Number.isFinite(Date.parse(mutation.deadline)))
        throw new TypeError('Agent tool execution deadline is invalid');
      execution.deadline = mutation.deadline;
      transitionToolExecution(
        execution,
        'prepared',
        input,
        undefined,
        mutation.reasonCode,
      );
      execution.preparedAt = input.now;
      continue;
    }

    if (mutation.type === 'tool_execution_orphan_reprepared') {
      assertToolExecutionStatus(execution, 'running');
      if (execution.sideEffect !== 'none')
        throw new TypeError(
          'Only a side-effect-free Agent tool execution can be retried safely',
        );
      if (!Number.isFinite(Date.parse(mutation.deadline)))
        throw new TypeError('Agent tool execution deadline is invalid');
      const attempt = execution.attempts.at(-1);
      if (
        !attempt ||
        attempt.attemptId !== mutation.attemptId ||
        attempt.status !== 'running'
      )
        throw new TypeError('Active Agent tool execution attempt not found');
      attempt.status = 'unknown';
      attempt.effectOutcome = 'not_applied';
      attempt.finishedAt = input.now;
      attempt.errorCode = 'OWNER_LEASE_EXPIRED';
      execution.effectOutcome = undefined;
      execution.retryable = undefined;
      execution.deadline = mutation.deadline;
      execution.preparedAt = input.now;
      execution.finishedAt = undefined;
      transitionToolExecution(
        execution,
        'prepared',
        input,
        mutation.attemptId,
        mutation.reasonCode,
      );
      continue;
    }

    if (mutation.type === 'tool_execution_orphan_quarantined') {
      assertToolExecutionStatus(execution, 'running');
      if (
        execution.sideEffect !== 'reversible' &&
        execution.sideEffect !== 'external'
      )
        throw new TypeError(
          'Only an external Agent tool execution can require reconciliation',
        );
      const attempt = execution.attempts.at(-1);
      if (
        !attempt ||
        attempt.attemptId !== mutation.attemptId ||
        attempt.status !== 'running'
      )
        throw new TypeError('Active Agent tool execution attempt not found');
      attempt.status = 'unknown';
      attempt.effectOutcome = 'unknown';
      attempt.finishedAt = input.now;
      attempt.errorCode = mutation.reasonCode;
      execution.effectOutcome = 'unknown';
      execution.retryable = false;
      transitionToolExecution(
        execution,
        'unknown',
        input,
        mutation.attemptId,
        mutation.reasonCode,
      );
      execution.finishedAt = input.now;
      continue;
    }

    if (mutation.type === 'tool_execution_started') {
      assertToolExecutionStatus(execution, 'prepared');
      if (!execution.deadline)
        throw new TypeError('Prepared tool execution has no deadline');
      if (
        mutation.attempt !== execution.attemptCount + 1 ||
        mutation.attempt < 1 ||
        execution.attempts.some(
          (attempt) => attempt.attemptId === mutation.attemptId,
        )
      )
        throw new TypeError('Agent tool execution attempt is not monotonic');
      execution.attempts.push({
        attemptId: mutation.attemptId,
        attempt: mutation.attempt,
        status: 'running',
        deadline: execution.deadline,
        startedAt: input.now,
      });
      execution.attemptCount = mutation.attempt;
      transitionToolExecution(execution, 'running', input, mutation.attemptId);
      execution.startedAt = input.now;
      continue;
    }

    assertToolExecutionStatus(execution, 'running');
    const attempt = execution.attempts.at(-1);
    if (!attempt || attempt.attemptId !== mutation.attemptId)
      throw new TypeError('Active Agent tool execution attempt not found');
    attempt.status = mutation.status;
    attempt.effectOutcome = mutation.effectOutcome;
    attempt.finishedAt = input.now;
    attempt.errorCode = mutation.errorCode;
    attempt.resultDigest = mutation.resultDigest;
    execution.effectOutcome = mutation.effectOutcome;
    execution.retryable = mutation.retryable;
    transitionToolExecution(
      execution,
      mutation.status,
      input,
      mutation.attemptId,
      mutation.reasonCode,
    );
    execution.finishedAt = input.now;
  }
}

function applyApprovalMutations(input: {
  approvals: MutableApproval[];
  executions: MutableToolExecution[];
  task: MutableAgentTask;
  runId: string;
  commitId: string;
  mutations: readonly AgentApprovalMutation[];
  now: string;
}): void {
  const run = input.task.runs.find(
    (candidate) => candidate.runId === input.runId,
  );
  if (!run) throw new TypeError('Agent run not found for Approval');

  for (const mutation of input.mutations) {
    if (mutation.type === 'approval_consumed') {
      if (input.task.status !== 'running' || run.status !== 'running')
        throw new TypeError(
          'Agent Approval consumption requires a running run',
        );
      const approval = input.approvals.find(
        (candidate) =>
          candidate.approvalId === mutation.approvalId &&
          candidate.toolExecutionId === mutation.toolExecutionId,
      );
      const execution = input.executions.find(
        (candidate) => candidate.toolExecutionId === mutation.toolExecutionId,
      );
      if (
        !approval ||
        approval.status === 'pending' ||
        (approval.decisionId !== undefined &&
          approval.decisionId !== mutation.decisionId) ||
        approval.consumedAt !== undefined ||
        (approval.status === 'approved'
          ? execution?.status !== 'prepared'
          : execution?.status !== 'failed')
      )
        throw new TypeError('Agent Approval cannot be consumed');
      approval.consumeId = mutation.consumeId;
      approval.consumedAt = input.now;
      approval.rowVersion += 1;
      approval.transitions.push({
        sequence: approval.transitions.length + 1,
        from: approval.status,
        to: approval.status,
        commitId: input.commitId,
        occurredAt: input.now,
        reasonCode: 'CONSUMED',
        consumeId: mutation.consumeId,
      });
      continue;
    }
    if (
      input.task.status !== 'waiting_for_approval' ||
      run.status !== 'waiting_for_approval'
    )
      throw new TypeError('Agent Approval requires a waiting run');
    const execution = input.executions.find(
      (candidate) =>
        candidate.toolExecutionId === mutation.toolExecutionId &&
        candidate.turnId === mutation.turnId,
    );
    if (
      !execution ||
      execution.status !== 'awaiting_approval' ||
      execution.proposalSequence !== mutation.proposalSequence ||
      execution.argumentsDigest !== mutation.argumentsDigest
    )
      throw new TypeError('Agent Approval does not match ToolExecution');
    if (
      input.approvals.some(
        (approval) =>
          approval.approvalId === mutation.approvalId ||
          approval.toolExecutionId === mutation.toolExecutionId ||
          approval.status === 'pending',
      )
    )
      throw new TypeError('Agent Approval identity collision');
    if (
      mutation.approvalId.trim() === '' ||
      mutation.policyId.trim() === '' ||
      mutation.policyVersion.trim() === '' ||
      mutation.presentation.title.trim() === '' ||
      !Number.isFinite(Date.parse(mutation.expiresAt)) ||
      Date.parse(mutation.expiresAt) <= Date.parse(input.now) ||
      Buffer.byteLength(JSON.stringify(mutation.presentation), 'utf8') >
        32 * 1024
    )
      throw new TypeError('Agent Approval request is invalid');
    const approval: MutableApproval = {
      turnId: mutation.turnId,
      approvalId: mutation.approvalId,
      toolExecutionId: mutation.toolExecutionId,
      proposalSequence: mutation.proposalSequence,
      policyId: mutation.policyId,
      policyVersion: mutation.policyVersion,
      argumentsDigest: mutation.argumentsDigest,
      presentation: freezeApprovalPresentation(mutation.presentation),
      status: 'pending',
      transitions: [],
      requestedAt: input.now,
      expiresAt: mutation.expiresAt,
      rowVersion: 1,
    };
    approval.transitions.push({
      sequence: 1,
      to: 'pending',
      commitId: input.commitId,
      occurredAt: input.now,
      reasonCode: 'APPROVAL_REQUIRED',
    });
    input.approvals.push(approval);
  }
}

function applyReconciliationMutations(input: {
  cases: MutableReconciliationCase[];
  executions: MutableToolExecution[];
  task: MutableAgentTask;
  runId: string;
  mutations: readonly AgentReconciliationMutation[];
  now: string;
}): void {
  const run = input.task.runs.find(
    (candidate) => candidate.runId === input.runId,
  );
  if (!run) throw new TypeError('Agent run not found for reconciliation');

  for (const mutation of input.mutations) {
    if (
      input.task.status !== 'waiting_for_reconciliation' ||
      run.status !== 'waiting_for_reconciliation'
    )
      throw new TypeError('Agent reconciliation Case requires a waiting run');
    if (!hasBoundedUtf8(mutation.reconciliationCaseId, 256))
      throw new TypeError('Agent reconciliation Case ID is invalid');
    if (
      input.cases.some(
        (reconciliationCase) =>
          reconciliationCase.reconciliationCaseId ===
            mutation.reconciliationCaseId ||
          reconciliationCase.toolExecutionId === mutation.toolExecutionId,
      )
    )
      throw new TypeError('Agent reconciliation Case identity collision');
    const execution = input.executions.find(
      (candidate) => candidate.toolExecutionId === mutation.toolExecutionId,
    );
    const attempt = execution?.attempts.find(
      (candidate) => candidate.attemptId === mutation.attemptId,
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
      attempt.effectOutcome !== 'unknown'
    )
      throw new TypeError(
        'Agent reconciliation Case does not match an unknown ToolExecution Attempt',
      );
    input.cases.push({
      reconciliationCaseId: mutation.reconciliationCaseId,
      toolExecutionId: execution.toolExecutionId,
      attemptId: attempt.attemptId,
      toolName: execution.toolName,
      status: 'waiting',
      reasonCode: mutation.reasonCode,
      createdAt: input.now,
      rowVersion: 1,
      observations: [],
    });
  }
}

function assertReconciliationCommit(
  command: CommitAgentRuntimeTaskCommand,
): void {
  const reconciliations = command.reconciliations ?? [];
  const startsReconciliation = command.mutations.some(
    (runtimeMutation) => runtimeMutation.type === 'reconciliation_wait_started',
  );
  if (startsReconciliation && reconciliations.length !== 1)
    throw new TypeError(
      'Agent reconciliation wait must create exactly one Case',
    );

  for (const mutation of reconciliations) {
    if (
      !startsReconciliation ||
      command.checkpoint?.kind !== 'reconciliation_waiting' ||
      command.checkpoint.resumeState?.kind !== 'reconciliation' ||
      command.checkpoint.resumeState.toolExecutionId !==
        mutation.toolExecutionId ||
      command.checkpoint.resumeState.attemptId !== mutation.attemptId ||
      !command.toolExecutions?.some(
        (toolExecution) =>
          toolExecution.type === 'tool_execution_orphan_quarantined' &&
          toolExecution.toolExecutionId === mutation.toolExecutionId &&
          toolExecution.attemptId === mutation.attemptId,
      ) ||
      !command.events?.some(
        (event) =>
          event.payload.type === 'run_reconciliation_required' &&
          event.payload.toolExecutionId === mutation.toolExecutionId &&
          event.payload.attemptId === mutation.attemptId &&
          event.payload.reasonCode === mutation.reasonCode,
      )
    )
      throw new TypeError(
        'Agent reconciliation Case must be created with its quarantine boundary',
      );
  }
}

function assertReconciliationObservation(
  command: AppendAgentReconciliationObservationCommand,
): void {
  if (
    !hasBoundedUtf8(command.reconciliationCaseId, 256) ||
    !hasBoundedUtf8(command.adapterId, 256) ||
    !hasBoundedUtf8(command.adapterVersion, 256) ||
    !hasReasonCode(command.reasonCode) ||
    !isReconciliationObservationOutcome(command.outcome) ||
    !Number.isFinite(Date.parse(command.observedAt)) ||
    (command.presentation !== undefined &&
      !isReconciliationPresentation(command.presentation))
  )
    throw new TypeError('Agent reconciliation Observation is invalid');
}

function assertToolExecutionStatus(
  execution: MutableToolExecution,
  expected: AgentToolExecutionStatus,
): void {
  if (execution.status !== expected)
    throw new TypeError(
      `Agent tool execution cannot transition from ${execution.status}`,
    );
}

function transitionToolExecution(
  execution: MutableToolExecution,
  to: AgentToolExecutionStatus,
  input: { commitId: string; now: string },
  attemptId?: string,
  reasonCode?: string,
): void {
  const from = execution.status;
  execution.status = to;
  appendToolTransition(execution, {
    from,
    to,
    attemptId,
    commitId: input.commitId,
    occurredAt: input.now,
    reasonCode,
  });
}

function appendToolTransition(
  execution: MutableToolExecution,
  transition: Omit<MutableToolExecutionTransition, 'sequence'>,
): void {
  execution.transitions.push({
    sequence: execution.transitions.length + 1,
    ...transition,
  });
}

function cloneToolExecution(
  execution: MutableToolExecution,
): MutableToolExecution {
  return {
    ...execution,
    attempts: execution.attempts.map((attempt) => ({ ...attempt })),
    transitions: execution.transitions.map((transition) => ({ ...transition })),
  };
}

function snapshotToolExecution(
  query: ScopedRunQuery,
  execution: MutableToolExecution,
): AgentToolExecutionSnapshot {
  return Object.freeze({
    ...query,
    ...execution,
    attempts: Object.freeze(
      execution.attempts.map(
        (attempt) =>
          Object.freeze({ ...attempt }) as AgentToolExecutionAttemptSnapshot,
      ),
    ),
    transitions: Object.freeze(
      execution.transitions.map(
        (transition) =>
          Object.freeze({
            ...transition,
          }) as AgentToolExecutionTransitionSnapshot,
      ),
    ),
  });
}

function cloneReconciliationCase(
  reconciliationCase: MutableReconciliationCase,
): MutableReconciliationCase {
  return {
    ...reconciliationCase,
    observations: reconciliationCase.observations.map(
      cloneReconciliationObservation,
    ),
  };
}

function snapshotReconciliationCase(
  query: ScopedRunQuery,
  reconciliationCase: MutableReconciliationCase,
): AgentReconciliationCaseSnapshot {
  return Object.freeze({
    ...query,
    reconciliationCaseId: reconciliationCase.reconciliationCaseId,
    toolExecutionId: reconciliationCase.toolExecutionId,
    attemptId: reconciliationCase.attemptId,
    toolName: reconciliationCase.toolName,
    status: reconciliationCase.status,
    reasonCode: reconciliationCase.reasonCode,
    createdAt: reconciliationCase.createdAt,
    rowVersion: reconciliationCase.rowVersion,
  });
}

function cloneReconciliationObservation(
  observation: MutableReconciliationObservation,
): MutableReconciliationObservation {
  return {
    ...observation,
    presentation: observation.presentation
      ? freezeReconciliationPresentation(observation.presentation)
      : undefined,
  };
}

function snapshotReconciliationObservation(
  query: ScopedAgentReconciliationCaseQuery,
  observation: MutableReconciliationObservation,
): AgentReconciliationObservationSnapshot {
  return Object.freeze({
    ...query,
    sequence: observation.sequence,
    adapterId: observation.adapterId,
    adapterVersion: observation.adapterVersion,
    outcome: observation.outcome,
    reasonCode: observation.reasonCode,
    presentation: observation.presentation
      ? freezeReconciliationPresentation(observation.presentation)
      : undefined,
    observedAt: observation.observedAt,
  });
}

function cloneApproval(approval: MutableApproval): MutableApproval {
  return {
    ...approval,
    presentation: freezeApprovalPresentation(approval.presentation),
    transitions: approval.transitions.map((transition) => ({ ...transition })),
  };
}

function snapshotApproval(
  query: ScopedRunQuery,
  approval: MutableApproval,
): AgentApprovalSnapshot {
  return Object.freeze({
    ...query,
    ...approval,
    presentation: freezeApprovalPresentation(approval.presentation),
    transitions: Object.freeze(
      approval.transitions.map(
        (transition) =>
          Object.freeze({ ...transition }) as AgentApprovalTransitionSnapshot,
      ),
    ),
  });
}

function freezeApprovalPresentation(
  presentation: AgentApprovalSnapshot['presentation'],
): AgentApprovalSnapshot['presentation'] {
  return Object.freeze({
    title: presentation.title,
    description: presentation.description,
    fields: presentation.fields
      ? Object.freeze(
          presentation.fields.map((field) => Object.freeze({ ...field })),
        )
      : undefined,
  });
}

function freezeReconciliationPresentation(
  presentation: AgentReconciliationPresentation,
): AgentReconciliationPresentation {
  return Object.freeze({
    title: presentation.title,
    description: presentation.description,
    fields: presentation.fields
      ? Object.freeze(
          presentation.fields.map((field) => Object.freeze({ ...field })),
        )
      : undefined,
  });
}
