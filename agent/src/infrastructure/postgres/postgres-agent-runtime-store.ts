import { randomUUID } from 'node:crypto';

import type { Message } from '@duoduo/ai';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { AgentError } from '../../core/errors.js';
import { hashRuntimeCommit } from '../../core/harness/commit-hash.js';
import {
  applyRuntimeMutations,
  createRuntimeTask,
  snapshotRuntimeTask,
  type MutableAgentRun,
  type MutableAgentTask,
  type MutableAgentTurn,
} from '../../core/harness/runtime-aggregate.js';
import type {
  AcknowledgeAgentOutboxCommand,
  AgentApprovalDecisionReceipt,
  AgentApprovalMutation,
  AgentApprovalSnapshot,
  AgentApprovalTransitionSnapshot,
  AgentOutboxBatch,
  AgentOutboxUpdateResult,
  AgentRuntimeCommitReceipt,
  AgentRuntimeEventPage,
  AgentRuntimeStore,
  AgentRunClaimBatch,
  AgentRunCheckpointSnapshot,
  AgentRunExecutionLease,
  AgentRunRecoveryAuditSnapshot,
  AgentRunRecoverySnapshot,
  AgentToolExecutionAttemptSnapshot,
  AgentToolExecutionMutation,
  AgentToolExecutionSnapshot,
  AgentToolExecutionTransitionSnapshot,
  ClaimAgentOutboxCommand,
  ClaimRecoverableAgentRunsCommand,
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
} from '../../core/harness/runtime-store.js';
import type {
  AgentHarnessEvent,
  AgentRequestScope,
  AgentRunStatus,
  AgentTaskSnapshot,
  AgentTaskStatus,
  AgentTurnStatus,
  ScopedTaskQuery,
} from '../../core/harness/types.js';
import { resolvePool } from './migrations.js';
import type { PostgresAgentRuntimeOptions } from './types.js';

export function createPostgresAgentRuntimeStore(
  options: PostgresAgentRuntimeOptions,
): AgentRuntimeStore {
  const { pool, ownsPool } = resolvePool(options);
  return new PostgresAgentRuntimeStore(pool, ownsPool);
}

class PostgresAgentRuntimeStore implements AgentRuntimeStore {
  readonly durability = 'durable' as const;
  readonly runLeaseSupport = 'v1' as const;
  readonly checkpointResumeSupport = 'v3' as const;
  private disposed = false;

  constructor(
    private readonly pool: Pool,
    private readonly ownsPool: boolean,
  ) {}

  async createTask(
    command: CreateAgentRuntimeTaskCommand,
  ): Promise<AgentRuntimeCommitReceipt> {
    this.assertNotDisposed();
    const initialLeaseDurationMs = command.initialLease
      ? positiveDurationMs(command.now, command.initialLease.leaseExpiresAt)
      : undefined;
    const commandHash = hashRuntimeCommit(command);
    const task = createRuntimeTask(command);
    const run = task.runs[0];
    if (!run) throw new TypeError('Agent Runtime Task has no Run');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockCommit(client, command.scope, command.taskId, command.commitId);
      const existingCommit = await loadStoredCommit(
        client,
        command.scope,
        command.taskId,
        command.commitId,
        commandHash,
      );
      if (existingCommit) {
        await client.query('COMMIT');
        return existingCommit;
      }
      await client.query(
        `INSERT INTO agent_runtime.tasks (
           tenant_id, project_id, task_id, origin_session_id, status,
           latest_run_id, active_run_id, version, transcript,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
        [
          task.scope.tenantId,
          task.scope.projectId,
          task.taskId,
          task.scope.sessionId ?? null,
          task.status,
          task.latestRunId,
          task.activeRunId ?? null,
          task.version,
          JSON.stringify(task.transcript),
          task.createdAt,
          task.updatedAt,
        ],
      );
      await client.query(
        `INSERT INTO agent_runtime.runs (
           tenant_id, project_id, task_id, run_id, status,
           latest_checkpoint_version, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7)`,
        [
          task.scope.tenantId,
          task.scope.projectId,
          task.taskId,
          run.runId,
          run.status,
          run.createdAt,
          run.updatedAt,
        ],
      );
      await insertCheckpoint(client, {
        query: {
          tenantId: task.scope.tenantId,
          projectId: task.scope.projectId,
          taskId: task.taskId,
          runId: run.runId,
        },
        checkpoint: command.checkpoint,
        version: 1,
        now: command.now,
      });
      const initialLease = command.initialLease
        ? await insertInitialRunLease(client, command, initialLeaseDurationMs!)
        : undefined;
      const commitReceipt = receipt(
        task,
        command.commitId,
        1,
        undefined,
        initialLease,
      );
      await insertStoredCommit(client, command, commandHash, commitReceipt);
      await client.query('COMMIT');
      return commitReceipt;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async commitTask(
    command: CommitAgentRuntimeTaskCommand,
  ): Promise<AgentRuntimeCommitReceipt> {
    this.assertNotDisposed();
    const commandHash = hashRuntimeCommit(command);
    if (
      command.mutations.length === 0 &&
      (command.events?.length ?? 0) === 0 &&
      (command.toolExecutions?.length ?? 0) === 0 &&
      (command.approvals?.length ?? 0) === 0 &&
      !command.checkpoint
    )
      throw new TypeError('Agent runtime commit has no changes');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockCommit(client, command, command.taskId, command.commitId);
      const existingCommit = await loadStoredCommit(
        client,
        command,
        command.taskId,
        command.commitId,
        commandHash,
      );
      if (existingCommit) {
        await client.query('COMMIT');
        return existingCommit;
      }
      const recoveryLease = await assertRunLeaseInTransaction(client, command);
      const task = await loadRuntimeTask(client, command, true);
      if (!task) throw new TypeError('Agent task not found');
      if (task.version !== command.expectedVersion)
        throw new AgentError(
          'AGENT_STATE_CONFLICT',
          'Agent task state changed concurrently',
        );
      const durability = await loadRunDurabilityState(client, command);
      let nextSequence = Number(durability.next_event_sequence);
      for (const event of command.events ?? []) {
        assertEventScope(event, command);
        if (event.sequence !== nextSequence)
          throw new TypeError('Agent event sequence is not contiguous');
        nextSequence += 1;
      }
      applyRuntimeMutations({
        task,
        runId: command.runId,
        mutations: command.mutations,
        now: command.now,
      });
      await persistRuntimeTask(client, task, command.runId);
      for (const mutation of command.toolExecutions ?? [])
        await applyToolExecutionMutation(client, command, mutation);
      for (const mutation of command.approvals ?? [])
        await applyApprovalMutation(client, command, task, mutation);
      for (const event of command.events ?? [])
        await insertEventAndOutbox(client, event);
      const checkpointVersion = command.checkpoint
        ? Number(durability.latest_checkpoint_version) + 1
        : Number(durability.latest_checkpoint_version);
      if (command.checkpoint)
        await insertCheckpoint(client, {
          query: command,
          checkpoint: command.checkpoint,
          version: checkpointVersion,
          now: command.now,
        });
      await client.query(
        `UPDATE agent_runtime.runs
            SET next_event_sequence = $5,
                latest_checkpoint_version = $6
          WHERE tenant_id = $1 AND project_id = $2
            AND task_id = $3 AND run_id = $4`,
        [
          command.tenantId,
          command.projectId,
          command.taskId,
          command.runId,
          nextSequence,
          checkpointVersion,
        ],
      );
      if (command.recoveryAudit) {
        if (!recoveryLease)
          throw new TypeError('Agent recovery audit is invalid');
        await insertRecoveryAudit(client, recoveryLease, {
          recoveryId: command.recoveryAudit.recoveryId,
          action: command.recoveryAudit.action,
          reasonCode: command.recoveryAudit.reasonCode,
        });
      }
      const commitReceipt = receipt(
        task,
        command.commitId,
        checkpointVersion || undefined,
        nextSequence > 1 ? nextSequence - 1 : undefined,
      );
      await insertStoredCommit(client, command, commandHash, commitReceipt);
      await client.query('COMMIT');
      return commitReceipt;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getTask(
    query: ScopedTaskQuery,
  ): Promise<AgentTaskSnapshot | undefined> {
    this.assertNotDisposed();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const task = await loadRuntimeTask(client, query, false);
      await client.query('COMMIT');
      return task ? snapshotRuntimeTask(task) : undefined;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getCheckpoint(
    query: ScopedRunQuery,
  ): Promise<AgentRunCheckpointSnapshot | undefined> {
    this.assertNotDisposed();
    const result = await this.pool.query<CheckpointRow>(
      `SELECT checkpoint_version, kind, input, transcript, turn_index,
              execution_position, next_turn_index, resume_state,
              harness_protocol_version,
              checkpoint_schema_version, config_fingerprint, created_at
         FROM agent_runtime.run_checkpoints
        WHERE tenant_id = $1 AND project_id = $2
          AND task_id = $3 AND run_id = $4
        ORDER BY checkpoint_version DESC
        LIMIT 1`,
      [query.tenantId, query.projectId, query.taskId, query.runId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return checkpointFromRow(query, row);
  }

  async readCheckpoints(
    query: ScopedRunQuery,
  ): Promise<readonly AgentRunCheckpointSnapshot[]> {
    this.assertNotDisposed();
    const result = await this.pool.query<CheckpointRow>(
      `SELECT checkpoint_version, kind, input, transcript, turn_index,
              execution_position, next_turn_index, resume_state,
              harness_protocol_version,
              checkpoint_schema_version, config_fingerprint, created_at
         FROM agent_runtime.run_checkpoints
        WHERE tenant_id = $1 AND project_id = $2
          AND task_id = $3 AND run_id = $4
        ORDER BY checkpoint_version`,
      [query.tenantId, query.projectId, query.taskId, query.runId],
    );
    return Object.freeze(
      result.rows.map((row) => checkpointFromRow(query, row)),
    );
  }

  async readEvents(
    query: ReadAgentRuntimeEventsQuery,
  ): Promise<AgentRuntimeEventPage> {
    this.assertNotDisposed();
    const result = await this.pool.query<EventRow>(
      `SELECT event
         FROM agent_runtime.run_events
        WHERE tenant_id = $1 AND project_id = $2
          AND task_id = $3 AND run_id = $4 AND sequence > $5
        ORDER BY sequence
        LIMIT $6`,
      [
        query.tenantId,
        query.projectId,
        query.taskId,
        query.runId,
        query.afterSequence ?? 0,
        query.limit + 1,
      ],
    );
    return Object.freeze({
      events: Object.freeze(
        result.rows.slice(0, query.limit).map((row) => row.event),
      ),
      hasMore: result.rows.length > query.limit,
    });
  }

  async readToolExecutions(
    query: ScopedRunQuery,
  ): Promise<readonly AgentToolExecutionSnapshot[]> {
    this.assertNotDisposed();
    const [executionResult, attemptResult, transitionResult] =
      await Promise.all([
        this.pool.query<ToolExecutionRow>(
          `SELECT *
             FROM agent_runtime.tool_executions
            WHERE tenant_id = $1 AND project_id = $2
              AND task_id = $3 AND run_id = $4
            ORDER BY proposal_sequence`,
          [query.tenantId, query.projectId, query.taskId, query.runId],
        ),
        this.pool.query<ToolExecutionAttemptRow>(
          `SELECT *
             FROM agent_runtime.tool_execution_attempts
            WHERE tenant_id = $1 AND project_id = $2
              AND task_id = $3 AND run_id = $4
            ORDER BY tool_execution_id, attempt`,
          [query.tenantId, query.projectId, query.taskId, query.runId],
        ),
        this.pool.query<ToolExecutionTransitionRow>(
          `SELECT *
             FROM agent_runtime.tool_execution_transitions
            WHERE tenant_id = $1 AND project_id = $2
              AND task_id = $3 AND run_id = $4
            ORDER BY tool_execution_id, transition_sequence`,
          [query.tenantId, query.projectId, query.taskId, query.runId],
        ),
      ]);
    const attemptsByExecution = groupRows(
      attemptResult.rows,
      (row) => row.tool_execution_id,
    );
    const transitionsByExecution = groupRows(
      transitionResult.rows,
      (row) => row.tool_execution_id,
    );
    return Object.freeze(
      executionResult.rows.map((row) =>
        toolExecutionFromRows(
          query,
          row,
          attemptsByExecution.get(row.tool_execution_id) ?? [],
          transitionsByExecution.get(row.tool_execution_id) ?? [],
        ),
      ),
    );
  }

  async readApprovals(
    query: ScopedRunQuery,
  ): Promise<readonly AgentApprovalSnapshot[]> {
    this.assertNotDisposed();
    const [approvalResult, transitionResult] = await Promise.all([
      this.pool.query<ApprovalRow>(
        `SELECT *
           FROM agent_runtime.approval_requests
          WHERE tenant_id = $1 AND project_id = $2
            AND task_id = $3 AND run_id = $4
          ORDER BY proposal_sequence`,
        [query.tenantId, query.projectId, query.taskId, query.runId],
      ),
      this.pool.query<ApprovalTransitionRow>(
        `SELECT *
           FROM agent_runtime.approval_transitions
          WHERE tenant_id = $1 AND project_id = $2
            AND task_id = $3 AND run_id = $4
          ORDER BY approval_id, transition_sequence`,
        [query.tenantId, query.projectId, query.taskId, query.runId],
      ),
    ]);
    const transitionsByApproval = groupRows(
      transitionResult.rows,
      (row) => row.approval_id,
    );
    return Object.freeze(
      approvalResult.rows.map((row) =>
        approvalFromRows(
          query,
          row,
          transitionsByApproval.get(row.approval_id) ?? [],
        ),
      ),
    );
  }

  async decideApproval(
    command: DecideAgentRuntimeApprovalCommand,
  ): Promise<AgentApprovalDecisionReceipt> {
    this.assertNotDisposed();
    assertApprovalDecision(command);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const task = await loadRuntimeTask(client, command, true);
      if (!task)
        throw new AgentError(
          'AGENT_APPROVAL_NOT_FOUND',
          'Agent Approval not found',
        );
      const existingDecision = await loadApprovalByDecisionId(
        client,
        command,
        command.decisionId,
      );
      if (existingDecision) {
        if (
          existingDecision.approval_id !== command.approvalId ||
          existingDecision.decision !== command.decision ||
          existingDecision.decided_by !== command.decidedBy ||
          (existingDecision.decision_reason_code ?? undefined) !==
            command.reasonCode ||
          !existingDecision.decision_receipt
        )
          throw new AgentError(
            'AGENT_APPROVAL_DECISION_MISMATCH',
            'Agent Approval decision ID was reused with different content',
          );
        await client.query('COMMIT');
        return freezeApprovalDecisionReceipt(existingDecision.decision_receipt);
      }
      const approval = await loadApprovalForUpdate(client, command);
      const run = task.runs.find(
        (candidate) => candidate.runId === command.runId,
      );
      if (!approval || !run)
        throw new AgentError(
          'AGENT_APPROVAL_NOT_FOUND',
          'Agent Approval not found',
        );
      if (approval.status !== 'pending')
        throw new AgentError(
          'AGENT_APPROVAL_ALREADY_DECIDED',
          'Agent Approval is already decided',
        );
      if (
        task.status !== 'waiting_for_approval' ||
        run.status !== 'waiting_for_approval'
      )
        throw new TypeError('Agent Approval decision requires a waiting run');
      if (
        approval.status === 'pending' &&
        Date.parse(command.now) >= Date.parse(toIso(approval.expires_at))
      ) {
        const receipt = await resolveApprovalInTransaction(
          client,
          command,
          task,
          approval,
          'expired',
        );
        await client.query('COMMIT');
        return receipt;
      }

      const transitions = await loadApprovalTransitions(
        client,
        command,
        command.approvalId,
      );
      task.version += 1;
      task.updatedAt = command.now;
      run.updatedAt = command.now;
      const transition: ApprovalTransitionRow = {
        approval_id: command.approvalId,
        transition_sequence: transitions.length + 1,
        from_status: 'pending',
        to_status: command.decision,
        commit_id: command.commitId,
        occurred_at: command.now,
        reason_code:
          command.reasonCode ??
          (command.decision === 'approved' ? 'APPROVED' : 'DENIED'),
        decision_id: command.decisionId,
        consume_id: null,
      };
      const nextApproval: ApprovalRow = {
        ...approval,
        status: command.decision,
        row_version: Number(approval.row_version) + 1,
        decision_id: command.decisionId,
        decision: command.decision,
        decided_by: command.decidedBy,
        decision_reason_code: command.reasonCode ?? null,
        decided_at: command.now,
        decision_task_version: task.version,
        decision_receipt: null,
      };
      const decisionReceipt = Object.freeze({
        approval: approvalFromRows(command, nextApproval, [
          ...transitions,
          transition,
        ]),
        version: task.version,
      });
      const updated = await client.query(
        `UPDATE agent_runtime.approval_requests
            SET status = $6,
                row_version = row_version + 1,
                decision_id = $7,
                decision = $6,
                decided_by = $8,
                decision_reason_code = $9,
                decided_at = $10,
                decision_task_version = $11,
                decision_receipt = $12::jsonb
          WHERE tenant_id = $1 AND project_id = $2
            AND task_id = $3 AND run_id = $4 AND approval_id = $5
            AND status = 'pending'`,
        [
          command.tenantId,
          command.projectId,
          command.taskId,
          command.runId,
          command.approvalId,
          command.decision,
          command.decisionId,
          command.decidedBy,
          command.reasonCode ?? null,
          command.now,
          task.version,
          JSON.stringify(decisionReceipt),
        ],
      );
      if (updated.rowCount !== 1)
        throw new AgentError(
          'AGENT_APPROVAL_ALREADY_DECIDED',
          'Agent Approval is already decided',
        );
      await persistRuntimeTask(client, task, command.runId);
      await insertApprovalTransition(client, command, {
        approvalId: command.approvalId,
        from: 'pending',
        to: command.decision,
        reasonCode: transition.reason_code ?? undefined,
        decisionId: command.decisionId,
      });
      await client.query('COMMIT');
      return decisionReceipt;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveApproval(
    command: ResolveAgentRuntimeApprovalCommand,
  ): Promise<AgentApprovalDecisionReceipt> {
    this.assertNotDisposed();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await assertRunLeaseInTransaction(client, command);
      const task = await loadRuntimeTask(client, command, true);
      const approval = await loadApprovalForUpdate(client, command);
      const run = task?.runs.find(
        (candidate) => candidate.runId === command.runId,
      );
      if (!task || !approval || !run)
        throw new AgentError(
          'AGENT_APPROVAL_NOT_FOUND',
          'Agent Approval not found',
        );
      if (approval.status !== 'pending') {
        const transitions = await loadApprovalTransitions(
          client,
          command,
          command.approvalId,
        );
        const receipt = Object.freeze({
          approval: approvalFromRows(command, approval, transitions),
          version: task.version,
        });
        await client.query('COMMIT');
        return receipt;
      }
      if (
        command.resolution === 'expired' &&
        Date.parse(command.now) < Date.parse(toIso(approval.expires_at))
      )
        throw new TypeError('Agent Approval has not expired');
      if (
        task.status !== 'waiting_for_approval' ||
        run.status !== 'waiting_for_approval'
      )
        throw new TypeError('Agent Approval resolution requires a waiting run');
      const receipt = await resolveApprovalInTransaction(
        client,
        command,
        task,
        approval,
        command.resolution,
      );
      await client.query('COMMIT');
      return receipt;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimOutbox(
    command: ClaimAgentOutboxCommand,
  ): Promise<AgentOutboxBatch> {
    this.assertNotDisposed();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<ClaimedOutboxRow>(
        `WITH candidates AS (
           SELECT outbox_id
             FROM agent_runtime.event_outbox
            WHERE (status = 'pending' AND available_at <= $1)
               OR (status = 'delivering' AND lease_expires_at <= $1)
            ORDER BY available_at, outbox_id
            FOR UPDATE SKIP LOCKED
            LIMIT $2
         ), claimed AS (
           UPDATE agent_runtime.event_outbox AS outbox
              SET status = 'delivering',
                  lease_owner = $3,
                  lease_expires_at = $4,
                  attempt = outbox.attempt + 1,
                  updated_at = $1
             FROM candidates
            WHERE outbox.outbox_id = candidates.outbox_id
           RETURNING outbox.*
         )
         SELECT claimed.outbox_id, claimed.attempt, claimed.lease_owner,
                claimed.lease_expires_at, event.event
           FROM claimed
           JOIN agent_runtime.run_events AS event
             ON event.tenant_id = claimed.tenant_id
            AND event.project_id = claimed.project_id
            AND event.task_id = claimed.task_id
            AND event.run_id = claimed.run_id
            AND event.sequence = claimed.sequence
          ORDER BY claimed.outbox_id`,
        [command.now, command.limit, command.workerId, command.leaseExpiresAt],
      );
      await client.query('COMMIT');
      return Object.freeze({
        messages: Object.freeze(
          result.rows.map((row) =>
            Object.freeze({
              outboxId: String(row.outbox_id),
              event: row.event,
              attempt: row.attempt,
              leaseOwner: row.lease_owner,
              leaseExpiresAt: toIso(row.lease_expires_at),
            }),
          ),
        ),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimRecoverableRuns(
    command: ClaimRecoverableAgentRunsCommand,
  ): Promise<AgentRunClaimBatch> {
    this.assertNotDisposed();
    assertClaimCommand(command);
    const commandHash = hashRuntimeCommit(command);
    const leaseDurationMs = positiveDurationMs(
      command.now,
      command.leaseExpiresAt,
    );
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockRecoveryOperation(client, command.claimId);
      const replay = await loadRecoveryOperation<AgentRunClaimBatch>(
        client,
        command.claimId,
        'claim',
        commandHash,
      );
      if (replay) {
        await client.query('COMMIT');
        return freezeRunClaimBatch(replay);
      }
      const databaseNow = await readDatabaseNow(client);
      await client.query(
        `INSERT INTO agent_runtime.run_execution_leases (
           tenant_id, project_id, task_id, run_id, available_at,
           config_fingerprint
         )
         SELECT run.tenant_id, run.project_id, run.task_id, run.run_id,
                $1, checkpoint.config_fingerprint
           FROM agent_runtime.runs AS run
           JOIN agent_runtime.run_checkpoints AS checkpoint
             ON checkpoint.tenant_id = run.tenant_id
            AND checkpoint.project_id = run.project_id
            AND checkpoint.task_id = run.task_id
            AND checkpoint.run_id = run.run_id
            AND checkpoint.checkpoint_version = run.latest_checkpoint_version
          WHERE run.status NOT IN (
                  'completed', 'failed', 'cancelled',
                  'waiting_for_reconciliation', 'recovery_blocked'
                )
            AND checkpoint.config_fingerprint = $2
         ON CONFLICT (tenant_id, project_id, task_id, run_id) DO NOTHING`,
        [databaseNow, command.configFingerprint],
      );
      const candidates = await client.query<RunLeaseRow>(
        `SELECT lease.*
           FROM agent_runtime.run_execution_leases AS lease
           JOIN agent_runtime.tasks AS task
             ON task.tenant_id = lease.tenant_id
            AND task.project_id = lease.project_id
            AND task.task_id = lease.task_id
           JOIN agent_runtime.runs AS run
             ON run.tenant_id = lease.tenant_id
            AND run.project_id = lease.project_id
            AND run.task_id = lease.task_id
            AND run.run_id = lease.run_id
          WHERE lease.config_fingerprint = $1
            AND lease.available_at <= $2
            AND (lease.owner_id IS NULL OR lease.lease_expires_at <= $2)
            AND task.status NOT IN (
              'completed', 'failed', 'cancelled',
              'waiting_for_reconciliation', 'recovery_blocked'
            )
            AND run.status NOT IN (
              'completed', 'failed', 'cancelled',
              'waiting_for_reconciliation', 'recovery_blocked'
            )
          ORDER BY lease.available_at, lease.tenant_id, lease.project_id,
                   lease.task_id, lease.run_id
          FOR UPDATE OF lease SKIP LOCKED
          LIMIT $3`,
        [command.configFingerprint, databaseNow, command.limit],
      );
      const leases: AgentRunExecutionLease[] = [];
      for (const candidate of candidates.rows) {
        const leaseToken = randomUUID();
        const claimed = await client.query<RunLeaseRow>(
          `UPDATE agent_runtime.run_execution_leases
              SET owner_id = $5,
                  lease_token = $6,
                  fencing_token = fencing_token + 1,
                  claimed_at = $7,
                  renewed_at = $7,
                  lease_expires_at = $7::timestamptz
                    + $8::double precision * interval '1 millisecond',
                  available_at = $7,
                  row_version = row_version + 1
            WHERE tenant_id = $1 AND project_id = $2
              AND task_id = $3 AND run_id = $4
          RETURNING *`,
          [
            candidate.tenant_id,
            candidate.project_id,
            candidate.task_id,
            candidate.run_id,
            command.ownerId,
            leaseToken,
            databaseNow,
            leaseDurationMs,
          ],
        );
        const lease = leaseFromRow(requireRow(claimed.rows[0]));
        leases.push(lease);
        await insertRecoveryAudit(client, lease, {
          recoveryId: command.claimId,
          action: lease.fencingToken === 1 ? 'initial_claim' : 'recovery_claim',
        });
      }
      const batch = freezeRunClaimBatch({ leases });
      await insertRecoveryOperation(
        client,
        command.claimId,
        'claim',
        commandHash,
        batch,
      );
      await client.query('COMMIT');
      return batch;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async renewRunLease(
    command: RenewAgentRunLeaseCommand,
  ): Promise<AgentRunExecutionLease> {
    this.assertNotDisposed();
    assertLeaseMutationCommand(command);
    const commandHash = hashRuntimeCommit(command);
    const leaseDurationMs = positiveDurationMs(
      command.now,
      command.leaseExpiresAt,
    );
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockRecoveryOperation(client, command.renewalId);
      const replay = await loadRecoveryOperation<AgentRunExecutionLease>(
        client,
        command.renewalId,
        'renew',
        commandHash,
      );
      if (replay) {
        await assertOwnedRunLease(client, command);
        await client.query('COMMIT');
        return freezeRunLease(replay);
      }
      const databaseNow = await readDatabaseNow(client);
      const updated = await client.query<RunLeaseRow>(
        `UPDATE agent_runtime.run_execution_leases
            SET renewed_at = $8,
                lease_expires_at = $8::timestamptz
                  + $9::double precision * interval '1 millisecond',
                row_version = row_version + 1
          WHERE tenant_id = $1 AND project_id = $2
            AND task_id = $3 AND run_id = $4
            AND owner_id = $5 AND lease_token = $6 AND fencing_token = $7
            AND lease_expires_at > $8
            AND $8::timestamptz
                  + $9::double precision * interval '1 millisecond'
                > lease_expires_at
        RETURNING *`,
        [
          command.tenantId,
          command.projectId,
          command.taskId,
          command.runId,
          command.ownerId,
          command.leaseToken,
          command.fencingToken,
          databaseNow,
          leaseDurationMs,
        ],
      );
      const row = updated.rows[0];
      if (!row) throw runLeaseLost();
      const lease = leaseFromRow(row);
      await insertRecoveryOperation(
        client,
        command.renewalId,
        'renew',
        commandHash,
        lease,
      );
      await client.query('COMMIT');
      return lease;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseRunLease(command: ReleaseAgentRunLeaseCommand): Promise<void> {
    this.assertNotDisposed();
    assertLeaseMutationCommand(command);
    const commandHash = hashRuntimeCommit(command);
    const delayMs = nonNegativeDurationMs(command.now, command.availableAt);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockRecoveryOperation(client, command.releaseId);
      const replay = await loadRecoveryOperation<unknown>(
        client,
        command.releaseId,
        'release',
        commandHash,
      );
      if (replay !== undefined) {
        await client.query('COMMIT');
        return;
      }
      const lease = await assertOwnedRunLease(client, command);
      const databaseNow = await readDatabaseNow(client);
      const updated = await client.query(
        `UPDATE agent_runtime.run_execution_leases
            SET owner_id = NULL,
                lease_token = NULL,
                claimed_at = NULL,
                renewed_at = NULL,
                lease_expires_at = NULL,
                available_at = $8::timestamptz
                  + $9::double precision * interval '1 millisecond',
                consecutive_failure_count = CASE
                  WHEN $10 = 'RECOVERY_TRANSIENT_FAILURE'
                    THEN LEAST(consecutive_failure_count + 1, 1000000)
                  ELSE 0
                END,
                last_failure_code = CASE
                  WHEN $10 = 'RECOVERY_TRANSIENT_FAILURE' THEN $10
                  ELSE NULL
                END,
                row_version = row_version + 1
          WHERE tenant_id = $1 AND project_id = $2
            AND task_id = $3 AND run_id = $4
            AND owner_id = $5 AND lease_token = $6 AND fencing_token = $7`,
        [
          command.tenantId,
          command.projectId,
          command.taskId,
          command.runId,
          command.ownerId,
          command.leaseToken,
          command.fencingToken,
          databaseNow,
          delayMs,
          command.reasonCode ?? null,
        ],
      );
      if (updated.rowCount !== 1) throw runLeaseLost();
      await insertRecoveryAudit(client, lease, {
        recoveryId: command.releaseId,
        action: command.action ?? 'released',
        reasonCode: command.reasonCode,
      });
      await insertRecoveryOperation(
        client,
        command.releaseId,
        'release',
        commandHash,
        { released: true },
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async readRunRecoveryAudit(
    query: ScopedRunQuery,
  ): Promise<readonly AgentRunRecoveryAuditSnapshot[]> {
    this.assertNotDisposed();
    const result = await this.pool.query<RecoveryAuditRow>(
      `SELECT * FROM agent_runtime.run_recovery_audit
        WHERE tenant_id = $1 AND project_id = $2
          AND task_id = $3 AND run_id = $4
        ORDER BY recovery_sequence`,
      [query.tenantId, query.projectId, query.taskId, query.runId],
    );
    return Object.freeze(result.rows.map(recoveryAuditFromRow));
  }

  async readRecoverySnapshot(
    command: ReadAgentRunRecoveryCommand,
  ): Promise<AgentRunRecoverySnapshot> {
    this.assertNotDisposed();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const lease = await assertOwnedRunLease(client, command, false);
      const task = await loadRuntimeTask(client, command, false);
      const checkpoint = await loadLatestCheckpoint(client, command);
      if (!task || !checkpoint)
        throw new AgentError(
          'AGENT_RECOVERY_STATE_INVALID',
          'Agent Run recovery state is incomplete',
        );
      const toolExecutions = await loadToolExecutionSnapshots(client, command);
      const approvals = await loadApprovalSnapshots(client, command);
      const events = await client.query<EventRow>(
        `SELECT event FROM agent_runtime.run_events
          WHERE tenant_id = $1 AND project_id = $2
            AND task_id = $3 AND run_id = $4
          ORDER BY sequence`,
        [command.tenantId, command.projectId, command.taskId, command.runId],
      );
      const snapshot = Object.freeze({
        tenantId: command.tenantId,
        projectId: command.projectId,
        taskId: command.taskId,
        runId: command.runId,
        task: snapshotRuntimeTask(task),
        checkpoint,
        toolExecutions,
        approvals,
        modelAttempts: snapshotModelAttempts(
          events.rows.map((row) => row.event),
        ),
        lastEventSequence: events.rows.at(-1)?.event.sequence ?? 0,
        lease: Object.freeze({
          ownerId: lease.ownerId,
          fencingToken: lease.fencingToken,
          leaseExpiresAt: lease.leaseExpiresAt,
        }),
      });
      await client.query('COMMIT');
      return snapshot;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async acknowledgeOutbox(
    command: AcknowledgeAgentOutboxCommand,
  ): Promise<AgentOutboxUpdateResult> {
    this.assertNotDisposed();
    if (command.outboxIds.length === 0)
      return Object.freeze({ updatedCount: 0 });
    const result = await this.pool.query(
      `UPDATE agent_runtime.event_outbox
          SET status = 'delivered',
              lease_owner = NULL,
              lease_expires_at = NULL,
              delivered_at = $3,
              updated_at = $3
        WHERE outbox_id = ANY($1::bigint[])
          AND status = 'delivering'
          AND lease_owner = $2`,
      [command.outboxIds, command.workerId, command.now],
    );
    return Object.freeze({ updatedCount: result.rowCount ?? 0 });
  }

  async releaseOutbox(
    command: ReleaseAgentOutboxCommand,
  ): Promise<AgentOutboxUpdateResult> {
    this.assertNotDisposed();
    if (command.outboxIds.length === 0)
      return Object.freeze({ updatedCount: 0 });
    const result = await this.pool.query(
      `UPDATE agent_runtime.event_outbox
          SET status = 'pending',
              lease_owner = NULL,
              lease_expires_at = NULL,
              available_at = $3,
              updated_at = $4
        WHERE outbox_id = ANY($1::bigint[])
          AND status = 'delivering'
          AND lease_owner = $2`,
      [command.outboxIds, command.workerId, command.availableAt, command.now],
    );
    return Object.freeze({ updatedCount: result.rowCount ?? 0 });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.ownsPool) await this.pool.end();
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new TypeError('Agent Runtime Store is disposed');
  }
}

function assertClaimCommand(command: ClaimRecoverableAgentRunsCommand): void {
  if (
    !hasBoundedUtf8(command.claimId, 256) ||
    !hasBoundedUtf8(command.ownerId, 256) ||
    !hasBoundedUtf8(command.configFingerprint, 512) ||
    !Number.isInteger(command.limit) ||
    command.limit < 1 ||
    command.limit > 100
  )
    throw new TypeError('Agent recovery claim is invalid');
  positiveDurationMs(command.now, command.leaseExpiresAt);
}

function assertLeaseMutationCommand(
  command: RenewAgentRunLeaseCommand | ReleaseAgentRunLeaseCommand,
): void {
  const operationId =
    'renewalId' in command ? command.renewalId : command.releaseId;
  const boundary =
    'leaseExpiresAt' in command ? command.leaseExpiresAt : command.availableAt;
  if (
    !hasBoundedUtf8(operationId, 256) ||
    !hasBoundedUtf8(command.ownerId, 256) ||
    !hasBoundedUtf8(command.leaseToken, 256) ||
    !Number.isSafeInteger(command.fencingToken) ||
    command.fencingToken < 1 ||
    ('reasonCode' in command &&
      command.reasonCode !== undefined &&
      !isReasonCode(command.reasonCode))
  )
    throw new TypeError('Agent Run lease command is invalid');
  if ('leaseExpiresAt' in command)
    positiveDurationMs(command.now, command.leaseExpiresAt);
  else nonNegativeDurationMs(command.now, boundary);
}

function positiveDurationMs(start: string, end: string): number {
  const duration = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new TypeError('Agent Run lease duration is invalid');
  return duration;
}

function nonNegativeDurationMs(start: string, end: string): number {
  const duration = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(duration) || duration < 0)
    throw new TypeError('Agent Run lease delay is invalid');
  return duration;
}

function isReasonCode(value: string): boolean {
  return value.length <= 128 && /^[A-Z][A-Z0-9_]*$/.test(value);
}

async function readDatabaseNow(client: PoolClient): Promise<string> {
  const result = await client.query<{ database_now: Date | string }>(
    'SELECT clock_timestamp() AS database_now',
  );
  return toIso(requireRow(result.rows[0]).database_now);
}

async function lockRecoveryOperation(
  client: PoolClient,
  operationId: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `agent-recovery:${operationId}`,
  ]);
}

async function loadRecoveryOperation<T>(
  client: PoolClient,
  operationId: string,
  operationType: RecoveryOperationType,
  commandHash: string,
): Promise<T | undefined> {
  const result = await client.query<RecoveryOperationRow>(
    `SELECT operation_type, command_hash, receipt
       FROM agent_runtime.run_recovery_operations
      WHERE operation_id = $1`,
    [operationId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  if (row.operation_type !== operationType || row.command_hash !== commandHash)
    throw new AgentError(
      'AGENT_COMMIT_MISMATCH',
      `Agent Run lease ${operationType} ID was reused with different content`,
    );
  return row.receipt as T;
}

async function insertRecoveryOperation(
  client: PoolClient,
  operationId: string,
  operationType: RecoveryOperationType,
  commandHash: string,
  receiptValue: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO agent_runtime.run_recovery_operations (
       operation_id, operation_type, command_hash, receipt
     ) VALUES ($1, $2, $3, $4::jsonb)`,
    [operationId, operationType, commandHash, JSON.stringify(receiptValue)],
  );
}

async function insertInitialRunLease(
  client: PoolClient,
  command: CreateAgentRuntimeTaskCommand,
  durationMs: number,
): Promise<AgentRunExecutionLease> {
  const initialLease = command.initialLease!;
  if (
    !hasBoundedUtf8(initialLease.ownershipId, 256) ||
    !hasBoundedUtf8(initialLease.ownerId, 256)
  )
    throw new TypeError('Initial Agent Run lease is invalid');
  const databaseNow = await readDatabaseNow(client);
  const result = await client.query<RunLeaseRow>(
    `INSERT INTO agent_runtime.run_execution_leases (
       tenant_id, project_id, task_id, run_id, owner_id, lease_token,
       fencing_token, claimed_at, renewed_at, lease_expires_at, available_at,
       config_fingerprint
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 1, $7, $7,
       $7::timestamptz + $8::double precision * interval '1 millisecond',
       $7, $9
     ) RETURNING *`,
    [
      command.scope.tenantId,
      command.scope.projectId,
      command.taskId,
      command.runId,
      initialLease.ownerId,
      randomUUID(),
      databaseNow,
      durationMs,
      command.checkpoint.configFingerprint,
    ],
  );
  const lease = leaseFromRow(requireRow(result.rows[0]));
  await insertRecoveryAudit(client, lease, {
    recoveryId: initialLease.ownershipId,
    action: 'initial_claim',
  });
  return lease;
}

async function assertRunLeaseInTransaction(
  client: PoolClient,
  command: ScopedRunQuery & {
    readonly lease?: {
      readonly leaseToken: string;
      readonly fencingToken: number;
    };
  },
): Promise<AgentRunExecutionLease | undefined> {
  const result = await client.query<RunLeaseRow>(
    `SELECT * FROM agent_runtime.run_execution_leases
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4
      FOR UPDATE`,
    [command.tenantId, command.projectId, command.taskId, command.runId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  if (
    !command.lease ||
    row.owner_id === null ||
    row.lease_token !== command.lease.leaseToken ||
    Number(row.fencing_token) !== command.lease.fencingToken ||
    row.lease_expires_at === null
  )
    throw runLeaseLost();
  const validity = await client.query<{ valid: boolean }>(
    'SELECT $1::timestamptz > clock_timestamp() AS valid',
    [row.lease_expires_at],
  );
  if (!validity.rows[0]?.valid) throw runLeaseLost();
  return leaseFromRow(row);
}

async function assertOwnedRunLease(
  client: PoolClient,
  command:
    | ReadAgentRunRecoveryCommand
    | RenewAgentRunLeaseCommand
    | ReleaseAgentRunLeaseCommand,
  forUpdate = true,
): Promise<AgentRunExecutionLease> {
  const result = await client.query<RunLeaseRow>(
    `SELECT * FROM agent_runtime.run_execution_leases
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4
        AND owner_id = $5 AND lease_token = $6 AND fencing_token = $7
        AND lease_expires_at > clock_timestamp()
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [
      command.tenantId,
      command.projectId,
      command.taskId,
      command.runId,
      command.ownerId,
      command.leaseToken,
      command.fencingToken,
    ],
  );
  const row = result.rows[0];
  if (!row) throw runLeaseLost();
  return leaseFromRow(row);
}

function leaseFromRow(row: RunLeaseRow): AgentRunExecutionLease {
  if (
    row.owner_id === null ||
    row.lease_token === null ||
    row.claimed_at === null ||
    row.lease_expires_at === null
  )
    throw new TypeError('Stored Agent Run lease has no owner');
  return Object.freeze({
    tenantId: row.tenant_id,
    projectId: row.project_id,
    taskId: row.task_id,
    runId: row.run_id,
    ownerId: row.owner_id,
    leaseToken: row.lease_token,
    fencingToken: Number(row.fencing_token),
    claimedAt: toIso(row.claimed_at),
    leaseExpiresAt: toIso(row.lease_expires_at),
  });
}

function freezeRunLease(lease: AgentRunExecutionLease): AgentRunExecutionLease {
  return Object.freeze({ ...lease });
}

function freezeRunClaimBatch(batch: AgentRunClaimBatch): AgentRunClaimBatch {
  return Object.freeze({
    leases: Object.freeze(batch.leases.map(freezeRunLease)),
  });
}

async function insertRecoveryAudit(
  client: PoolClient,
  lease: AgentRunExecutionLease,
  input: Pick<AgentRunRecoveryAuditSnapshot, 'recoveryId' | 'action'> & {
    readonly reasonCode?: string;
  },
): Promise<void> {
  if (
    !hasBoundedUtf8(input.recoveryId, 256) ||
    (input.reasonCode !== undefined && !isReasonCode(input.reasonCode))
  )
    throw new TypeError('Agent recovery audit is invalid');
  await client.query(
    `INSERT INTO agent_runtime.run_recovery_audit (
       tenant_id, project_id, task_id, run_id, recovery_sequence,
       recovery_id, owner_id, fencing_token, action, reason_code
     )
     SELECT $1, $2, $3, $4, COALESCE(MAX(recovery_sequence), 0) + 1,
            $5, $6, $7, $8, $9
       FROM agent_runtime.run_recovery_audit
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4`,
    [
      lease.tenantId,
      lease.projectId,
      lease.taskId,
      lease.runId,
      input.recoveryId,
      lease.ownerId,
      lease.fencingToken,
      input.action,
      input.reasonCode ?? null,
    ],
  );
}

function recoveryAuditFromRow(
  row: RecoveryAuditRow,
): AgentRunRecoveryAuditSnapshot {
  return Object.freeze({
    tenantId: row.tenant_id,
    projectId: row.project_id,
    taskId: row.task_id,
    runId: row.run_id,
    sequence: Number(row.recovery_sequence),
    recoveryId: row.recovery_id,
    ownerId: row.owner_id,
    fencingToken: Number(row.fencing_token),
    action: row.action as AgentRunRecoveryAuditSnapshot['action'],
    reasonCode: row.reason_code ?? undefined,
    occurredAt: toIso(row.occurred_at),
  });
}

function runLeaseLost(): AgentError {
  return new AgentError(
    'AGENT_RUN_LEASE_LOST',
    'Agent Run execution lease is no longer owned',
  );
}

function requireRow<T>(row: T | undefined): T {
  if (!row) throw new TypeError('PostgreSQL did not return the expected row');
  return row;
}

async function loadLatestCheckpoint(
  client: PoolClient,
  query: ScopedRunQuery,
): Promise<AgentRunCheckpointSnapshot | undefined> {
  const result = await client.query<CheckpointRow>(
    `SELECT checkpoint_version, kind, input, transcript, turn_index,
            execution_position, next_turn_index, resume_state,
            harness_protocol_version, checkpoint_schema_version,
            config_fingerprint, created_at
       FROM agent_runtime.run_checkpoints
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4
      ORDER BY checkpoint_version DESC
      LIMIT 1`,
    [query.tenantId, query.projectId, query.taskId, query.runId],
  );
  const row = result.rows[0];
  return row ? checkpointFromRow(query, row) : undefined;
}

async function loadToolExecutionSnapshots(
  client: PoolClient,
  query: ScopedRunQuery,
): Promise<readonly AgentToolExecutionSnapshot[]> {
  const executionResult = await client.query<ToolExecutionRow>(
    `SELECT * FROM agent_runtime.tool_executions
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4
      ORDER BY proposal_sequence`,
    [query.tenantId, query.projectId, query.taskId, query.runId],
  );
  const attemptResult = await client.query<ToolExecutionAttemptRow>(
    `SELECT * FROM agent_runtime.tool_execution_attempts
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4
      ORDER BY tool_execution_id, attempt`,
    [query.tenantId, query.projectId, query.taskId, query.runId],
  );
  const transitionResult = await client.query<ToolExecutionTransitionRow>(
    `SELECT * FROM agent_runtime.tool_execution_transitions
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4
      ORDER BY tool_execution_id, transition_sequence`,
    [query.tenantId, query.projectId, query.taskId, query.runId],
  );
  const attemptsByExecution = groupRows(
    attemptResult.rows,
    (row) => row.tool_execution_id,
  );
  const transitionsByExecution = groupRows(
    transitionResult.rows,
    (row) => row.tool_execution_id,
  );
  return Object.freeze(
    executionResult.rows.map((row) =>
      toolExecutionFromRows(
        query,
        row,
        attemptsByExecution.get(row.tool_execution_id) ?? [],
        transitionsByExecution.get(row.tool_execution_id) ?? [],
      ),
    ),
  );
}

async function loadApprovalSnapshots(
  client: PoolClient,
  query: ScopedRunQuery,
): Promise<readonly AgentApprovalSnapshot[]> {
  const approvalResult = await client.query<ApprovalRow>(
    `SELECT * FROM agent_runtime.approval_requests
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4
      ORDER BY proposal_sequence`,
    [query.tenantId, query.projectId, query.taskId, query.runId],
  );
  const transitionResult = await client.query<ApprovalTransitionRow>(
    `SELECT * FROM agent_runtime.approval_transitions
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4
      ORDER BY approval_id, transition_sequence`,
    [query.tenantId, query.projectId, query.taskId, query.runId],
  );
  const transitionsByApproval = groupRows(
    transitionResult.rows,
    (row) => row.approval_id,
  );
  return Object.freeze(
    approvalResult.rows.map((row) =>
      approvalFromRows(
        query,
        row,
        transitionsByApproval.get(row.approval_id) ?? [],
      ),
    ),
  );
}

function snapshotModelAttempts(
  events: readonly AgentHarnessEvent[],
): AgentRunRecoverySnapshot['modelAttempts'] {
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

async function applyToolExecutionMutation(
  client: PoolClient,
  command: CommitAgentRuntimeTaskCommand,
  mutation: AgentToolExecutionMutation,
): Promise<void> {
  const scope = [
    command.tenantId,
    command.projectId,
    command.taskId,
    command.runId,
  ] as const;
  if (mutation.type === 'tool_execution_proposed') {
    await client.query(
      `INSERT INTO agent_runtime.tool_executions (
         tenant_id, project_id, task_id, run_id, turn_id, turn_index,
         tool_execution_id, tool_call_id, proposal_sequence, tool_name,
         arguments_digest, status, proposed_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'proposed', $12
       )`,
      [
        ...scope,
        mutation.turnId,
        mutation.turnIndex,
        mutation.toolExecutionId,
        mutation.toolCallId,
        mutation.proposalSequence,
        mutation.toolName,
        mutation.argumentsDigest,
        command.now,
      ],
    );
    await insertToolTransition(client, command, {
      toolExecutionId: mutation.toolExecutionId,
      to: 'proposed',
    });
    return;
  }

  if (mutation.type === 'tool_execution_prepared') {
    if (
      (mutation.idempotency === 'keyed') !==
      (mutation.idempotencyKey !== undefined)
    )
      throw new TypeError('Agent tool idempotency key does not match mode');
    const previousStatus = await loadToolExecutionStatus(
      client,
      command,
      mutation.toolExecutionId,
    );
    if (previousStatus !== 'proposed' && previousStatus !== 'awaiting_approval')
      throw new TypeError(
        `Agent tool execution cannot transition from ${previousStatus}`,
      );
    const updated = await client.query(
      `UPDATE agent_runtime.tool_executions
          SET side_effect = $6,
              idempotency = $7,
              timeout_ms = $8,
              idempotency_key = $9,
              deadline = $10,
              status = 'prepared',
              prepared_at = $11,
              row_version = row_version + 1
        WHERE tenant_id = $1 AND project_id = $2
          AND task_id = $3 AND run_id = $4
          AND tool_execution_id = $5 AND status = $12`,
      [
        ...scope,
        mutation.toolExecutionId,
        mutation.sideEffect,
        mutation.idempotency,
        mutation.timeoutMs,
        mutation.idempotencyKey ?? null,
        mutation.deadline,
        command.now,
        previousStatus,
      ],
    );
    assertOneToolExecutionUpdated(updated.rowCount, 'prepared');
    await insertToolTransition(client, command, {
      toolExecutionId: mutation.toolExecutionId,
      from: previousStatus,
      to: 'prepared',
      reasonCode:
        previousStatus === 'awaiting_approval'
          ? 'APPROVAL_CONSUMED'
          : undefined,
    });
    return;
  }

  if (mutation.type === 'tool_execution_reprepared') {
    const updated = await client.query(
      `UPDATE agent_runtime.tool_executions
          SET deadline = $6,
              prepared_at = $7,
              row_version = row_version + 1
        WHERE tenant_id = $1 AND project_id = $2
          AND task_id = $3 AND run_id = $4
          AND tool_execution_id = $5 AND status = 'prepared'`,
      [...scope, mutation.toolExecutionId, mutation.deadline, command.now],
    );
    assertOneToolExecutionUpdated(updated.rowCount, 'reprepared');
    await insertToolTransition(client, command, {
      toolExecutionId: mutation.toolExecutionId,
      from: 'prepared',
      to: 'prepared',
      reasonCode: mutation.reasonCode,
    });
    return;
  }

  if (
    mutation.type === 'tool_execution_orphan_reprepared' ||
    mutation.type === 'tool_execution_orphan_quarantined'
  ) {
    const safeRetry = mutation.type === 'tool_execution_orphan_reprepared';
    const attemptUpdated = await client.query(
      `UPDATE agent_runtime.tool_execution_attempts AS attempt
          SET status = 'unknown',
              effect_outcome = $7,
              finished_at = $8,
              error_code = $9
         FROM agent_runtime.tool_executions AS execution
        WHERE attempt.tenant_id = $1 AND attempt.project_id = $2
          AND attempt.task_id = $3 AND attempt.run_id = $4
          AND attempt.tool_execution_id = $5 AND attempt.attempt_id = $6
          AND attempt.status = 'running'
          AND execution.tenant_id = attempt.tenant_id
          AND execution.project_id = attempt.project_id
          AND execution.task_id = attempt.task_id
          AND execution.run_id = attempt.run_id
          AND execution.tool_execution_id = attempt.tool_execution_id
          AND execution.status = 'running'
          AND execution.side_effect ${safeRetry ? "= 'none'" : "IN ('reversible', 'external')"}`,
      [
        ...scope,
        mutation.toolExecutionId,
        mutation.attemptId,
        safeRetry ? 'not_applied' : 'unknown',
        command.now,
        safeRetry ? 'OWNER_LEASE_EXPIRED' : mutation.reasonCode,
      ],
    );
    assertOneToolExecutionUpdated(
      attemptUpdated.rowCount,
      safeRetry ? 'orphan retry' : 'orphan quarantine',
    );
    const executionUpdated = safeRetry
      ? await client.query(
          `UPDATE agent_runtime.tool_executions
              SET status = 'prepared', effect_outcome = NULL,
                  retryable = NULL, deadline = $6, prepared_at = $7,
                  finished_at = NULL, row_version = row_version + 1
            WHERE tenant_id = $1 AND project_id = $2
              AND task_id = $3 AND run_id = $4
              AND tool_execution_id = $5 AND status = 'running'
              AND side_effect = 'none'`,
          [...scope, mutation.toolExecutionId, mutation.deadline, command.now],
        )
      : await client.query(
          `UPDATE agent_runtime.tool_executions
              SET status = 'unknown', effect_outcome = 'unknown',
                  retryable = false, finished_at = $6,
                  row_version = row_version + 1
            WHERE tenant_id = $1 AND project_id = $2
              AND task_id = $3 AND run_id = $4
              AND tool_execution_id = $5 AND status = 'running'
              AND side_effect IN ('reversible', 'external')`,
          [...scope, mutation.toolExecutionId, command.now],
        );
    assertOneToolExecutionUpdated(
      executionUpdated.rowCount,
      safeRetry ? 'prepared' : 'unknown',
    );
    await insertToolTransition(client, command, {
      toolExecutionId: mutation.toolExecutionId,
      from: 'running',
      to: safeRetry ? 'prepared' : 'unknown',
      attemptId: mutation.attemptId,
      reasonCode: mutation.reasonCode,
    });
    return;
  }

  if (mutation.type === 'tool_execution_rejected') {
    const updated = await client.query(
      `UPDATE agent_runtime.tool_executions
          SET status = 'failed',
              effect_outcome = 'not_applied',
              retryable = false,
              finished_at = $6,
              row_version = row_version + 1
        WHERE tenant_id = $1 AND project_id = $2
          AND task_id = $3 AND run_id = $4
          AND tool_execution_id = $5 AND status = 'proposed'`,
      [...scope, mutation.toolExecutionId, command.now],
    );
    assertOneToolExecutionUpdated(updated.rowCount, 'failed');
    await insertToolTransition(client, command, {
      toolExecutionId: mutation.toolExecutionId,
      from: 'proposed',
      to: 'failed',
      reasonCode: mutation.reasonCode,
    });
    return;
  }

  if (mutation.type === 'tool_execution_awaiting_approval') {
    const updated = await client.query(
      `UPDATE agent_runtime.tool_executions
          SET side_effect = $6,
              idempotency = $7,
              timeout_ms = $8,
              status = 'awaiting_approval',
              row_version = row_version + 1
        WHERE tenant_id = $1 AND project_id = $2
          AND task_id = $3 AND run_id = $4
          AND tool_execution_id = $5 AND status = 'proposed'`,
      [
        ...scope,
        mutation.toolExecutionId,
        mutation.sideEffect,
        mutation.idempotency,
        mutation.timeoutMs,
      ],
    );
    assertOneToolExecutionUpdated(updated.rowCount, 'awaiting_approval');
    await insertToolTransition(client, command, {
      toolExecutionId: mutation.toolExecutionId,
      from: 'proposed',
      to: 'awaiting_approval',
      reasonCode: 'APPROVAL_REQUIRED',
    });
    return;
  }

  if (mutation.type === 'tool_execution_approval_rejected') {
    const updated = await client.query(
      `UPDATE agent_runtime.tool_executions
          SET status = 'failed',
              effect_outcome = 'not_applied',
              retryable = false,
              finished_at = $6,
              row_version = row_version + 1
        WHERE tenant_id = $1 AND project_id = $2
          AND task_id = $3 AND run_id = $4
          AND tool_execution_id = $5 AND status = 'awaiting_approval'`,
      [...scope, mutation.toolExecutionId, command.now],
    );
    assertOneToolExecutionUpdated(updated.rowCount, 'failed');
    await insertToolTransition(client, command, {
      toolExecutionId: mutation.toolExecutionId,
      from: 'awaiting_approval',
      to: 'failed',
      reasonCode: mutation.reasonCode,
    });
    return;
  }

  if (mutation.type === 'tool_execution_started') {
    const updated = await client.query<{ deadline: Date | string }>(
      `UPDATE agent_runtime.tool_executions
          SET status = 'running',
              attempt_count = $6,
              started_at = $7,
              row_version = row_version + 1
        WHERE tenant_id = $1 AND project_id = $2
          AND task_id = $3 AND run_id = $4
          AND tool_execution_id = $5 AND status = 'prepared'
          AND attempt_count = $6 - 1
      RETURNING deadline`,
      [...scope, mutation.toolExecutionId, mutation.attempt, command.now],
    );
    assertOneToolExecutionUpdated(updated.rowCount, 'running');
    const deadline = updated.rows[0]?.deadline;
    if (!deadline)
      throw new TypeError('Prepared tool execution has no deadline');
    await client.query(
      `INSERT INTO agent_runtime.tool_execution_attempts (
         tenant_id, project_id, task_id, run_id, tool_execution_id,
         attempt_id, attempt, status, deadline, started_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'running', $8, $9)`,
      [
        ...scope,
        mutation.toolExecutionId,
        mutation.attemptId,
        mutation.attempt,
        deadline,
        command.now,
      ],
    );
    await insertToolTransition(client, command, {
      toolExecutionId: mutation.toolExecutionId,
      from: 'prepared',
      to: 'running',
      attemptId: mutation.attemptId,
    });
    return;
  }

  const attemptUpdated = await client.query(
    `UPDATE agent_runtime.tool_execution_attempts
        SET status = $7,
            effect_outcome = $8,
            finished_at = $9,
            error_code = $10,
            result_digest = $11
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4
        AND tool_execution_id = $5 AND attempt_id = $6
        AND status = 'running'`,
    [
      ...scope,
      mutation.toolExecutionId,
      mutation.attemptId,
      mutation.status,
      mutation.effectOutcome,
      command.now,
      mutation.errorCode ?? null,
      mutation.resultDigest ?? null,
    ],
  );
  assertOneToolExecutionUpdated(attemptUpdated.rowCount, 'terminal Attempt');
  const executionUpdated = await client.query(
    `UPDATE agent_runtime.tool_executions
        SET status = $6,
            effect_outcome = $7,
            retryable = $8,
            finished_at = $9,
            row_version = row_version + 1
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4
        AND tool_execution_id = $5 AND status = 'running'`,
    [
      ...scope,
      mutation.toolExecutionId,
      mutation.status,
      mutation.effectOutcome,
      mutation.retryable,
      command.now,
    ],
  );
  assertOneToolExecutionUpdated(executionUpdated.rowCount, mutation.status);
  await insertToolTransition(client, command, {
    toolExecutionId: mutation.toolExecutionId,
    from: 'running',
    to: mutation.status,
    attemptId: mutation.attemptId,
    reasonCode: mutation.reasonCode,
  });
}

async function insertToolTransition(
  client: PoolClient,
  command: CommitAgentRuntimeTaskCommand,
  transition: {
    readonly toolExecutionId: string;
    readonly from?: string;
    readonly to: string;
    readonly attemptId?: string;
    readonly reasonCode?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO agent_runtime.tool_execution_transitions (
       tenant_id, project_id, task_id, run_id, tool_execution_id,
       transition_sequence, from_status, to_status, attempt_id,
       commit_id, occurred_at, reason_code
     )
     SELECT $1, $2, $3, $4, $5, COALESCE(MAX(transition_sequence), 0) + 1,
            $6, $7, $8, $9, $10, $11
       FROM agent_runtime.tool_execution_transitions
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4 AND tool_execution_id = $5`,
    [
      command.tenantId,
      command.projectId,
      command.taskId,
      command.runId,
      transition.toolExecutionId,
      transition.from ?? null,
      transition.to,
      transition.attemptId ?? null,
      command.commitId,
      command.now,
      transition.reasonCode ?? null,
    ],
  );
}

async function loadToolExecutionStatus(
  client: PoolClient,
  query: ScopedRunQuery,
  toolExecutionId: string,
): Promise<string> {
  const result = await client.query<{ status: string }>(
    `SELECT status
       FROM agent_runtime.tool_executions
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4 AND tool_execution_id = $5
      FOR UPDATE`,
    [
      query.tenantId,
      query.projectId,
      query.taskId,
      query.runId,
      toolExecutionId,
    ],
  );
  const status = result.rows[0]?.status;
  if (!status) throw new TypeError('Agent tool execution not found');
  return status;
}

function assertOneToolExecutionUpdated(
  rowCount: number | null,
  target: string,
): void {
  if (rowCount !== 1)
    throw new TypeError(`Agent tool execution cannot transition to ${target}`);
}

async function applyApprovalMutation(
  client: PoolClient,
  command: CommitAgentRuntimeTaskCommand,
  task: MutableAgentTask,
  mutation: AgentApprovalMutation,
): Promise<void> {
  const run = task.runs.find((candidate) => candidate.runId === command.runId);
  if (!run) throw new TypeError('Agent run not found for Approval');
  if (mutation.type === 'approval_requested') {
    if (
      task.status !== 'waiting_for_approval' ||
      run.status !== 'waiting_for_approval'
    )
      throw new TypeError('Agent Approval requires a waiting run');
    if (
      mutation.approvalId.trim() === '' ||
      mutation.policyId.trim() === '' ||
      mutation.policyVersion.trim() === '' ||
      mutation.presentation.title.trim() === '' ||
      !Number.isFinite(Date.parse(mutation.expiresAt)) ||
      Date.parse(mutation.expiresAt) <= Date.parse(command.now) ||
      Buffer.byteLength(JSON.stringify(mutation.presentation), 'utf8') >
        32 * 1024
    )
      throw new TypeError('Agent Approval request is invalid');
    const inserted = await client.query(
      `INSERT INTO agent_runtime.approval_requests (
         tenant_id, project_id, task_id, run_id, turn_id,
         approval_id, tool_execution_id, proposal_sequence,
         policy_id, policy_version, arguments_digest, presentation,
         status, requested_at, expires_at
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
              $12::jsonb, 'pending', $13, $14
         FROM agent_runtime.tool_executions
        WHERE tenant_id = $1 AND project_id = $2
          AND task_id = $3 AND run_id = $4
          AND tool_execution_id = $7 AND turn_id = $5
          AND proposal_sequence = $8 AND arguments_digest = $11
          AND status = 'awaiting_approval'`,
      [
        command.tenantId,
        command.projectId,
        command.taskId,
        command.runId,
        mutation.turnId,
        mutation.approvalId,
        mutation.toolExecutionId,
        mutation.proposalSequence,
        mutation.policyId,
        mutation.policyVersion,
        mutation.argumentsDigest,
        JSON.stringify(mutation.presentation),
        command.now,
        mutation.expiresAt,
      ],
    );
    if (inserted.rowCount !== 1)
      throw new TypeError('Agent Approval does not match ToolExecution');
    await insertApprovalTransition(client, command, {
      approvalId: mutation.approvalId,
      to: 'pending',
      reasonCode: 'APPROVAL_REQUIRED',
    });
    return;
  }

  if (task.status !== 'running' || run.status !== 'running')
    throw new TypeError('Agent Approval consumption requires a running run');

  const result = await client.query<ApprovalConsumptionRow>(
    `SELECT approval.*, execution.status AS execution_status
       FROM agent_runtime.approval_requests AS approval
       JOIN agent_runtime.tool_executions AS execution
         ON execution.tenant_id = approval.tenant_id
        AND execution.project_id = approval.project_id
        AND execution.task_id = approval.task_id
        AND execution.run_id = approval.run_id
        AND execution.tool_execution_id = approval.tool_execution_id
      WHERE approval.tenant_id = $1 AND approval.project_id = $2
        AND approval.task_id = $3 AND approval.run_id = $4
        AND approval.approval_id = $5
        AND approval.tool_execution_id = $6
      FOR UPDATE OF approval`,
    [
      command.tenantId,
      command.projectId,
      command.taskId,
      command.runId,
      mutation.approvalId,
      mutation.toolExecutionId,
    ],
  );
  const approval = result.rows[0];
  if (
    !approval ||
    approval.status === 'pending' ||
    (approval.decision_id !== null &&
      approval.decision_id !== mutation.decisionId) ||
    approval.consumed_at !== null ||
    (approval.status === 'approved'
      ? approval.execution_status !== 'prepared'
      : approval.execution_status !== 'failed')
  )
    throw new TypeError('Agent Approval cannot be consumed');
  const updated = await client.query(
    `UPDATE agent_runtime.approval_requests
        SET consume_id = $6,
            consumed_at = $7,
            row_version = row_version + 1
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4 AND approval_id = $5
        AND consumed_at IS NULL`,
    [
      command.tenantId,
      command.projectId,
      command.taskId,
      command.runId,
      mutation.approvalId,
      mutation.consumeId,
      command.now,
    ],
  );
  if (updated.rowCount !== 1)
    throw new TypeError('Agent Approval cannot be consumed');
  await insertApprovalTransition(client, command, {
    approvalId: mutation.approvalId,
    from: approval.status,
    to: approval.status,
    reasonCode: 'CONSUMED',
    consumeId: mutation.consumeId,
  });
}

async function insertApprovalTransition(
  client: PoolClient,
  command: Pick<
    CommitAgentRuntimeTaskCommand,
    'tenantId' | 'projectId' | 'taskId' | 'runId' | 'commitId' | 'now'
  >,
  transition: {
    readonly approvalId: string;
    readonly from?: string;
    readonly to: string;
    readonly reasonCode?: string;
    readonly decisionId?: string;
    readonly consumeId?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO agent_runtime.approval_transitions (
       tenant_id, project_id, task_id, run_id, approval_id,
       transition_sequence, from_status, to_status, commit_id,
       occurred_at, reason_code, decision_id, consume_id
     )
     SELECT $1, $2, $3, $4, $5,
            COALESCE(MAX(transition_sequence), 0) + 1,
            $6, $7, $8, $9, $10, $11, $12
       FROM agent_runtime.approval_transitions
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4 AND approval_id = $5`,
    [
      command.tenantId,
      command.projectId,
      command.taskId,
      command.runId,
      transition.approvalId,
      transition.from ?? null,
      transition.to,
      command.commitId,
      command.now,
      transition.reasonCode ?? null,
      transition.decisionId ?? null,
      transition.consumeId ?? null,
    ],
  );
}

async function loadApprovalForUpdate(
  client: PoolClient,
  command: ScopedRunQuery & { readonly approvalId: string },
): Promise<ApprovalRow | undefined> {
  const result = await client.query<ApprovalRow>(
    `SELECT *
       FROM agent_runtime.approval_requests
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4 AND approval_id = $5
      FOR UPDATE`,
    [
      command.tenantId,
      command.projectId,
      command.taskId,
      command.runId,
      command.approvalId,
    ],
  );
  return result.rows[0];
}

async function loadApprovalByDecisionId(
  client: PoolClient,
  query: ScopedRunQuery,
  decisionId: string,
): Promise<ApprovalRow | undefined> {
  const result = await client.query<ApprovalRow>(
    `SELECT *
       FROM agent_runtime.approval_requests
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4 AND decision_id = $5
      FOR UPDATE`,
    [query.tenantId, query.projectId, query.taskId, query.runId, decisionId],
  );
  return result.rows[0];
}

async function loadApprovalTransitions(
  client: PoolClient,
  query: ScopedRunQuery,
  approvalId: string,
): Promise<ApprovalTransitionRow[]> {
  const result = await client.query<ApprovalTransitionRow>(
    `SELECT *
       FROM agent_runtime.approval_transitions
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4 AND approval_id = $5
      ORDER BY transition_sequence`,
    [query.tenantId, query.projectId, query.taskId, query.runId, approvalId],
  );
  return result.rows;
}

async function resolveApprovalInTransaction(
  client: PoolClient,
  command: (
    DecideAgentRuntimeApprovalCommand | ResolveAgentRuntimeApprovalCommand
  ) & {
    readonly commitId: string;
    readonly now: string;
  },
  task: MutableAgentTask,
  approval: ApprovalRow,
  resolution: 'expired' | 'cancelled',
): Promise<AgentApprovalDecisionReceipt> {
  const transitions = await loadApprovalTransitions(
    client,
    command,
    command.approvalId,
  );
  const run = task.runs.find((candidate) => candidate.runId === command.runId);
  if (!run) throw new TypeError('Agent Approval Run not found');
  task.version += 1;
  task.updatedAt = command.now;
  run.updatedAt = command.now;
  const updated = await client.query(
    `UPDATE agent_runtime.approval_requests
        SET status = $6,
            row_version = row_version + 1
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4 AND approval_id = $5
        AND status = 'pending'`,
    [
      command.tenantId,
      command.projectId,
      command.taskId,
      command.runId,
      command.approvalId,
      resolution,
    ],
  );
  if (updated.rowCount !== 1)
    throw new AgentError(
      'AGENT_APPROVAL_ALREADY_DECIDED',
      'Agent Approval is already decided',
    );
  await persistRuntimeTask(client, task, command.runId);
  const reasonCode =
    resolution === 'expired' ? 'APPROVAL_EXPIRED' : 'APPROVAL_CANCELLED';
  await insertApprovalTransition(client, command, {
    approvalId: command.approvalId,
    from: 'pending',
    to: resolution,
    reasonCode,
  });
  const nextApproval: ApprovalRow = {
    ...approval,
    status: resolution,
    row_version: Number(approval.row_version) + 1,
  };
  const transition: ApprovalTransitionRow = {
    approval_id: command.approvalId,
    transition_sequence: transitions.length + 1,
    from_status: 'pending',
    to_status: resolution,
    commit_id: command.commitId,
    occurred_at: command.now,
    reason_code: reasonCode,
    decision_id: null,
    consume_id: null,
  };
  return Object.freeze({
    approval: approvalFromRows(command, nextApproval, [
      ...transitions,
      transition,
    ]),
    version: task.version,
  });
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

async function loadRunDurabilityState(
  client: PoolClient,
  query: ScopedRunQuery,
): Promise<RunDurabilityRow> {
  const result = await client.query<RunDurabilityRow>(
    `SELECT next_event_sequence, latest_checkpoint_version
       FROM agent_runtime.runs
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND run_id = $4`,
    [query.tenantId, query.projectId, query.taskId, query.runId],
  );
  const row = result.rows[0];
  if (!row) throw new TypeError('Agent run not found');
  return row;
}

async function insertCheckpoint(
  client: PoolClient,
  input: {
    query: ScopedRunQuery;
    checkpoint: CreateAgentRuntimeTaskCommand['checkpoint'];
    version: number;
    now: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO agent_runtime.run_checkpoints (
       tenant_id, project_id, task_id, run_id, checkpoint_version,
       kind, input, transcript, turn_index, execution_position,
       next_turn_index, resume_state, harness_protocol_version,
       checkpoint_schema_version, config_fingerprint, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9,
       $10, $11, $12::jsonb, $13, $14, $15, $16
     )`,
    [
      input.query.tenantId,
      input.query.projectId,
      input.query.taskId,
      input.query.runId,
      input.version,
      input.checkpoint.kind,
      input.checkpoint.input === undefined
        ? null
        : JSON.stringify(input.checkpoint.input),
      JSON.stringify(input.checkpoint.transcript),
      input.checkpoint.turnIndex ?? null,
      input.checkpoint.executionPosition,
      input.checkpoint.nextTurnIndex ?? null,
      input.checkpoint.resumeState === undefined
        ? null
        : JSON.stringify(input.checkpoint.resumeState),
      input.checkpoint.harnessProtocolVersion,
      input.checkpoint.checkpointSchemaVersion,
      input.checkpoint.configFingerprint,
      input.now,
    ],
  );
}

async function insertEventAndOutbox(
  client: PoolClient,
  event: AgentHarnessEvent,
): Promise<void> {
  await client.query(
    `INSERT INTO agent_runtime.run_events (
       tenant_id, project_id, task_id, run_id, sequence,
       event_id, event, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      event.tenantId,
      event.projectId,
      event.taskId,
      event.runId,
      event.sequence,
      event.eventId,
      JSON.stringify(event),
      event.occurredAt,
    ],
  );
  await client.query(
    `INSERT INTO agent_runtime.event_outbox (
       tenant_id, project_id, task_id, run_id, sequence, event_id,
       available_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)`,
    [
      event.tenantId,
      event.projectId,
      event.taskId,
      event.runId,
      event.sequence,
      event.eventId,
      event.occurredAt,
    ],
  );
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

async function persistRuntimeTask(
  client: PoolClient,
  task: MutableAgentTask,
  runId: string,
): Promise<void> {
  const run = task.runs.find((candidate) => candidate.runId === runId);
  if (!run) throw new TypeError('Agent run not found');
  await client.query(
    `UPDATE agent_runtime.tasks
        SET status = $4,
            latest_run_id = $5,
            active_run_id = $6,
            version = $7,
            transcript = $8::jsonb,
            updated_at = $9
      WHERE tenant_id = $1 AND project_id = $2 AND task_id = $3`,
    [
      task.scope.tenantId,
      task.scope.projectId,
      task.taskId,
      task.status,
      task.latestRunId,
      task.activeRunId ?? null,
      task.version,
      JSON.stringify(task.transcript),
      task.updatedAt,
    ],
  );
  await client.query(
    `UPDATE agent_runtime.runs
        SET status = $5, updated_at = $6
      WHERE tenant_id = $1 AND project_id = $2 AND task_id = $3 AND run_id = $4`,
    [
      task.scope.tenantId,
      task.scope.projectId,
      task.taskId,
      run.runId,
      run.status,
      run.updatedAt,
    ],
  );
  for (const turn of run.turns) await persistTurn(client, task, run, turn);
}

async function persistTurn(
  client: PoolClient,
  task: MutableAgentTask,
  run: MutableAgentRun,
  turn: MutableAgentTurn,
): Promise<void> {
  await client.query(
    `INSERT INTO agent_runtime.turns (
       tenant_id, project_id, task_id, run_id, turn_id, turn_index,
       status, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id, project_id, task_id, run_id, turn_id)
     DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
    [
      task.scope.tenantId,
      task.scope.projectId,
      task.taskId,
      run.runId,
      turn.turnId,
      turn.turnIndex,
      turn.status,
      turn.createdAt,
      turn.updatedAt,
    ],
  );
}

async function loadRuntimeTask(
  client: PoolClient,
  query: ScopedTaskQuery,
  forUpdate: boolean,
): Promise<MutableAgentTask | undefined> {
  const taskResult = await client.query<TaskRow>(
    `SELECT tenant_id, project_id, task_id, origin_session_id, status,
            latest_run_id, active_run_id, version, transcript,
            created_at, updated_at
       FROM agent_runtime.tasks
      WHERE tenant_id = $1 AND project_id = $2 AND task_id = $3
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [query.tenantId, query.projectId, query.taskId],
  );
  const taskRow = taskResult.rows[0];
  if (!taskRow) return undefined;
  const runResult = await client.query<RunRow>(
    `SELECT run_id, status, created_at, updated_at
       FROM agent_runtime.runs
      WHERE tenant_id = $1 AND project_id = $2 AND task_id = $3
      ORDER BY created_at, run_id`,
    [query.tenantId, query.projectId, query.taskId],
  );
  const turnResult = await client.query<TurnRow>(
    `SELECT run_id, turn_id, turn_index, status, created_at, updated_at
       FROM agent_runtime.turns
      WHERE tenant_id = $1 AND project_id = $2 AND task_id = $3
      ORDER BY run_id, turn_index`,
    [query.tenantId, query.projectId, query.taskId],
  );
  const turnsByRun = new Map<string, MutableAgentTurn[]>();
  for (const row of turnResult.rows) {
    const turns = turnsByRun.get(row.run_id) ?? [];
    turns.push({
      turnId: row.turn_id,
      turnIndex: row.turn_index,
      status: row.status as AgentTurnStatus,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    });
    turnsByRun.set(row.run_id, turns);
  }
  const transcript = taskRow.transcript;
  if (!Array.isArray(transcript))
    throw new TypeError('Agent task transcript is invalid');
  const scope: AgentRequestScope = Object.freeze({
    tenantId: taskRow.tenant_id,
    projectId: taskRow.project_id,
    sessionId: taskRow.origin_session_id ?? undefined,
  });
  return {
    taskId: taskRow.task_id,
    scope,
    status: taskRow.status as AgentTaskStatus,
    latestRunId: taskRow.latest_run_id,
    activeRunId: taskRow.active_run_id ?? undefined,
    version: Number(taskRow.version),
    transcript: Object.freeze(transcript as Message[]),
    runs: runResult.rows.map((row) => ({
      runId: row.run_id,
      status: row.status as AgentRunStatus,
      turns: turnsByRun.get(row.run_id) ?? [],
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    })),
    createdAt: toIso(taskRow.created_at),
    updatedAt: toIso(taskRow.updated_at),
  };
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

async function lockCommit(
  client: PoolClient,
  scope: Pick<AgentRequestScope, 'tenantId' | 'projectId'>,
  taskId: string,
  commitId: string,
): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended($1, 0)
     )`,
    [JSON.stringify([scope.tenantId, scope.projectId, taskId, commitId])],
  );
}

async function loadStoredCommit(
  client: PoolClient,
  scope: Pick<AgentRequestScope, 'tenantId' | 'projectId'>,
  taskId: string,
  commitId: string,
  commandHash: string,
): Promise<AgentRuntimeCommitReceipt | undefined> {
  const result = await client.query<RuntimeCommitRow>(
    `SELECT command_hash, receipt
       FROM agent_runtime.runtime_commits
      WHERE tenant_id = $1 AND project_id = $2
        AND task_id = $3 AND commit_id = $4`,
    [scope.tenantId, scope.projectId, taskId, commitId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  if (row.command_hash !== commandHash)
    throw new AgentError(
      'AGENT_COMMIT_MISMATCH',
      'Agent commit ID was reused with different content',
    );
  return Object.freeze(row.receipt);
}

async function insertStoredCommit(
  client: PoolClient,
  command: CreateAgentRuntimeTaskCommand | CommitAgentRuntimeTaskCommand,
  commandHash: string,
  commitReceipt: AgentRuntimeCommitReceipt,
): Promise<void> {
  const scope = 'scope' in command ? command.scope : command;
  await client.query(
    `INSERT INTO agent_runtime.runtime_commits (
       tenant_id, project_id, task_id, run_id, commit_id,
       command_hash, receipt, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      scope.tenantId,
      scope.projectId,
      command.taskId,
      command.runId,
      command.commitId,
      commandHash,
      JSON.stringify(commitReceipt),
      command.now,
    ],
  );
}

function toIso(value: Date | string): string {
  return typeof value === 'string'
    ? new Date(value).toISOString()
    : value.toISOString();
}

function checkpointFromRow(
  query: ScopedRunQuery,
  row: CheckpointRow,
): AgentRunCheckpointSnapshot {
  if (!Array.isArray(row.transcript))
    throw new TypeError('Agent checkpoint transcript is invalid');
  return Object.freeze({
    ...query,
    version: Number(row.checkpoint_version),
    kind: row.kind as AgentRunCheckpointSnapshot['kind'],
    input: row.input ?? undefined,
    transcript: Object.freeze(row.transcript as Message[]),
    turnIndex: row.turn_index ?? undefined,
    executionPosition:
      row.execution_position as AgentRunCheckpointSnapshot['executionPosition'],
    nextTurnIndex: row.next_turn_index ?? undefined,
    resumeState: row.resume_state ? Object.freeze(row.resume_state) : undefined,
    harnessProtocolVersion: row.harness_protocol_version,
    checkpointSchemaVersion: row.checkpoint_schema_version,
    configFingerprint: row.config_fingerprint,
    createdAt: toIso(row.created_at),
  });
}

function toolExecutionFromRows(
  query: ScopedRunQuery,
  row: ToolExecutionRow,
  attemptRows: readonly ToolExecutionAttemptRow[],
  transitionRows: readonly ToolExecutionTransitionRow[],
): AgentToolExecutionSnapshot {
  return Object.freeze({
    ...query,
    turnId: row.turn_id,
    turnIndex: row.turn_index,
    toolExecutionId: row.tool_execution_id,
    toolCallId: row.tool_call_id,
    proposalSequence: row.proposal_sequence,
    toolName: row.tool_name,
    argumentsDigest: row.arguments_digest,
    sideEffect:
      (row.side_effect as AgentToolExecutionSnapshot['sideEffect']) ??
      undefined,
    idempotency:
      (row.idempotency as AgentToolExecutionSnapshot['idempotency']) ??
      undefined,
    timeoutMs: row.timeout_ms ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    deadline: row.deadline ? toIso(row.deadline) : undefined,
    status: row.status as AgentToolExecutionSnapshot['status'],
    effectOutcome:
      (row.effect_outcome as AgentToolExecutionSnapshot['effectOutcome']) ??
      undefined,
    retryable: row.retryable ?? undefined,
    attemptCount: row.attempt_count,
    attempts: Object.freeze(
      attemptRows.map((attempt): AgentToolExecutionAttemptSnapshot =>
        Object.freeze({
          attemptId: attempt.attempt_id,
          attempt: attempt.attempt,
          status: attempt.status as AgentToolExecutionAttemptSnapshot['status'],
          effectOutcome:
            (attempt.effect_outcome as AgentToolExecutionAttemptSnapshot['effectOutcome']) ??
            undefined,
          deadline: toIso(attempt.deadline),
          startedAt: toIso(attempt.started_at),
          finishedAt: attempt.finished_at
            ? toIso(attempt.finished_at)
            : undefined,
          errorCode: attempt.error_code ?? undefined,
          resultDigest: attempt.result_digest ?? undefined,
        }),
      ),
    ),
    transitions: Object.freeze(
      transitionRows.map((transition): AgentToolExecutionTransitionSnapshot =>
        Object.freeze({
          sequence: transition.transition_sequence,
          from:
            (transition.from_status as AgentToolExecutionTransitionSnapshot['from']) ??
            undefined,
          to: transition.to_status as AgentToolExecutionTransitionSnapshot['to'],
          attemptId: transition.attempt_id ?? undefined,
          commitId: transition.commit_id,
          occurredAt: toIso(transition.occurred_at),
          reasonCode: transition.reason_code ?? undefined,
        }),
      ),
    ),
    proposedAt: toIso(row.proposed_at),
    preparedAt: row.prepared_at ? toIso(row.prepared_at) : undefined,
    startedAt: row.started_at ? toIso(row.started_at) : undefined,
    finishedAt: row.finished_at ? toIso(row.finished_at) : undefined,
  });
}

function approvalFromRows(
  query: ScopedRunQuery,
  row: ApprovalRow,
  transitionRows: readonly ApprovalTransitionRow[],
): AgentApprovalSnapshot {
  return Object.freeze({
    tenantId: query.tenantId,
    projectId: query.projectId,
    taskId: query.taskId,
    runId: query.runId,
    turnId: row.turn_id,
    approvalId: row.approval_id,
    toolExecutionId: row.tool_execution_id,
    proposalSequence: row.proposal_sequence,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    argumentsDigest: row.arguments_digest,
    presentation: freezeApprovalPresentation(row.presentation),
    status: row.status as AgentApprovalSnapshot['status'],
    transitions: Object.freeze(
      transitionRows.map((transition): AgentApprovalTransitionSnapshot =>
        Object.freeze({
          sequence: transition.transition_sequence,
          from:
            (transition.from_status as AgentApprovalTransitionSnapshot['from']) ??
            undefined,
          to: transition.to_status as AgentApprovalTransitionSnapshot['to'],
          commitId: transition.commit_id,
          occurredAt: toIso(transition.occurred_at),
          reasonCode: transition.reason_code ?? undefined,
          decisionId: transition.decision_id ?? undefined,
          consumeId: transition.consume_id ?? undefined,
        }),
      ),
    ),
    requestedAt: toIso(row.requested_at),
    expiresAt: toIso(row.expires_at),
    rowVersion: Number(row.row_version),
    decisionId: row.decision_id ?? undefined,
    decision: (row.decision as AgentApprovalSnapshot['decision']) ?? undefined,
    decidedBy: row.decided_by ?? undefined,
    decisionReasonCode: row.decision_reason_code ?? undefined,
    decidedAt: row.decided_at ? toIso(row.decided_at) : undefined,
    consumeId: row.consume_id ?? undefined,
    consumedAt: row.consumed_at ? toIso(row.consumed_at) : undefined,
  });
}

function freezeApprovalPresentation(
  value: unknown,
): AgentApprovalSnapshot['presentation'] {
  if (typeof value !== 'object' || value === null)
    throw new TypeError('Stored Agent Approval presentation is invalid');
  const presentation = value as Partial<AgentApprovalSnapshot['presentation']>;
  if (typeof presentation.title !== 'string')
    throw new TypeError('Stored Agent Approval presentation is invalid');
  return Object.freeze({
    title: presentation.title,
    description:
      typeof presentation.description === 'string'
        ? presentation.description
        : undefined,
    fields: Array.isArray(presentation.fields)
      ? Object.freeze(
          presentation.fields.map((field) => Object.freeze({ ...field })),
        )
      : undefined,
  });
}

function freezeApprovalDecisionReceipt(
  value: unknown,
): AgentApprovalDecisionReceipt {
  if (typeof value !== 'object' || value === null)
    throw new TypeError('Stored Agent Approval decision receipt is invalid');
  const receipt = value as Partial<AgentApprovalDecisionReceipt>;
  if (
    typeof receipt.version !== 'number' ||
    typeof receipt.approval !== 'object' ||
    receipt.approval === null
  )
    throw new TypeError('Stored Agent Approval decision receipt is invalid');
  const approval = receipt.approval as AgentApprovalSnapshot;
  return Object.freeze({
    approval: Object.freeze({
      ...approval,
      presentation: freezeApprovalPresentation(approval.presentation),
      transitions: Object.freeze(
        approval.transitions.map((transition) =>
          Object.freeze({ ...transition }),
        ),
      ),
    }),
    version: receipt.version,
  });
}

function groupRows<TRow>(
  rows: readonly TRow[],
  key: (row: TRow) => string,
): Map<string, TRow[]> {
  const grouped = new Map<string, TRow[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const values = grouped.get(groupKey) ?? [];
    values.push(row);
    grouped.set(groupKey, values);
  }
  return grouped;
}

interface TaskRow extends QueryResultRow {
  tenant_id: string;
  project_id: string;
  task_id: string;
  origin_session_id: string | null;
  status: string;
  latest_run_id: string;
  active_run_id: string | null;
  version: string;
  transcript: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RunRow extends QueryResultRow {
  run_id: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TurnRow extends QueryResultRow {
  run_id: string;
  turn_id: string;
  turn_index: number;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RunDurabilityRow extends QueryResultRow {
  next_event_sequence: string;
  latest_checkpoint_version: string;
}

interface CheckpointRow extends QueryResultRow {
  checkpoint_version: string;
  kind: string;
  input: AgentRunCheckpointSnapshot['input'] | null;
  transcript: unknown;
  turn_index: number | null;
  execution_position: string;
  next_turn_index: number | null;
  resume_state: AgentRunCheckpointSnapshot['resumeState'] | null;
  harness_protocol_version: number;
  checkpoint_schema_version: number;
  config_fingerprint: string;
  created_at: Date | string;
}

interface EventRow extends QueryResultRow {
  event: AgentHarnessEvent;
}

interface ToolExecutionRow extends QueryResultRow {
  turn_id: string;
  turn_index: number;
  tool_execution_id: string;
  tool_call_id: string;
  proposal_sequence: number;
  tool_name: string;
  arguments_digest: string;
  side_effect: string | null;
  idempotency: string | null;
  timeout_ms: number | null;
  idempotency_key: string | null;
  deadline: Date | string | null;
  status: string;
  effect_outcome: string | null;
  retryable: boolean | null;
  attempt_count: number;
  proposed_at: Date | string;
  prepared_at: Date | string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

interface ToolExecutionAttemptRow extends QueryResultRow {
  tool_execution_id: string;
  attempt_id: string;
  attempt: number;
  status: string;
  effect_outcome: string | null;
  deadline: Date | string;
  started_at: Date | string;
  finished_at: Date | string | null;
  error_code: string | null;
  result_digest: string | null;
}

interface ToolExecutionTransitionRow extends QueryResultRow {
  tool_execution_id: string;
  transition_sequence: number;
  from_status: string | null;
  to_status: string;
  attempt_id: string | null;
  commit_id: string;
  occurred_at: Date | string;
  reason_code: string | null;
}

interface ApprovalRow extends QueryResultRow {
  turn_id: string;
  approval_id: string;
  tool_execution_id: string;
  proposal_sequence: number;
  policy_id: string;
  policy_version: string;
  arguments_digest: string;
  presentation: unknown;
  status: string;
  row_version: string | number;
  requested_at: Date | string;
  expires_at: Date | string;
  decision_id: string | null;
  decision: string | null;
  decided_by: string | null;
  decision_reason_code: string | null;
  decided_at: Date | string | null;
  decision_task_version: string | number | null;
  decision_receipt: unknown | null;
  consume_id: string | null;
  consumed_at: Date | string | null;
}

interface ApprovalConsumptionRow extends ApprovalRow {
  execution_status: string;
}

interface ApprovalTransitionRow extends QueryResultRow {
  approval_id: string;
  transition_sequence: number;
  from_status: string | null;
  to_status: string;
  commit_id: string;
  occurred_at: Date | string;
  reason_code: string | null;
  decision_id: string | null;
  consume_id: string | null;
}

interface ClaimedOutboxRow extends QueryResultRow {
  outbox_id: string;
  attempt: number;
  lease_owner: string;
  lease_expires_at: Date | string;
  event: AgentHarnessEvent;
}

interface RuntimeCommitRow extends QueryResultRow {
  command_hash: string;
  receipt: AgentRuntimeCommitReceipt;
}

type RecoveryOperationType = 'claim' | 'renew' | 'release';

interface RecoveryOperationRow extends QueryResultRow {
  operation_type: RecoveryOperationType;
  command_hash: string;
  receipt: unknown;
}

interface RunLeaseRow extends QueryResultRow {
  tenant_id: string;
  project_id: string;
  task_id: string;
  run_id: string;
  owner_id: string | null;
  lease_token: string | null;
  fencing_token: string | number;
  claimed_at: Date | string | null;
  renewed_at: Date | string | null;
  lease_expires_at: Date | string | null;
  available_at: Date | string;
  config_fingerprint: string;
}

interface RecoveryAuditRow extends QueryResultRow {
  tenant_id: string;
  project_id: string;
  task_id: string;
  run_id: string;
  recovery_sequence: string | number;
  recovery_id: string;
  owner_id: string;
  fencing_token: string | number;
  action: string;
  reason_code: string | null;
  occurred_at: Date | string;
}
