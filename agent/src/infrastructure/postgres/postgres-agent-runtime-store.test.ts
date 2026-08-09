import { randomUUID } from 'node:crypto';

import {
  createFauxProvider,
  fauxTextResponse,
  fauxToolResponse,
} from '@duoduo/ai/testing';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { createAgentHarness, type AgentTool } from '../../index.js';
import {
  createPostgresAgentRuntimeStore,
  getAgentRuntimeMigrationStatus,
  migrateAgentRuntime,
} from './index.js';

const databaseUrl = process.env.AGENT_TEST_POSTGRES_URL;
if (process.env.AGENT_TEST_POSTGRES_REQUIRED === '1' && !databaseUrl)
  throw new TypeError(
    'AGENT_TEST_POSTGRES_URL is required by the dedicated PostgreSQL test command',
  );

describe.skipIf(!databaseUrl)('PostgreSQL Agent Runtime Store', () => {
  it('loads a completed Task from a separate Store instance', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    await migrateAgentRuntime({ connectionString });
    await expect(
      getAgentRuntimeMigrationStatus({ connectionString }),
    ).resolves.toMatchObject({
      migrations: [
        { version: '0001', state: 'applied' },
        { version: '0002', state: 'applied' },
        { version: '0003', state: 'applied' },
        { version: '0004', state: 'applied' },
        { version: '0005', state: 'applied' },
        { version: '0006', state: 'applied' },
        { version: '0007', state: 'applied' },
      ],
    });
    const firstStore = createPostgresAgentRuntimeStore({ connectionString });
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('persisted in PostgreSQL')],
    });
    const firstHarness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: firstStore,
    });
    let taskId: string | undefined;
    let runId: string | undefined;

    try {
      const handle = await firstHarness.startTask({
        scope: { tenantId: 'tenant-pg', projectId: 'project-pg' },
        input: 'persist this PostgreSQL Task',
      });
      taskId = handle.taskId;
      runId = handle.runId;
      await Promise.all([collect(handle.events), handle.result()]);
    } finally {
      await firstHarness.dispose();
      await firstStore.dispose();
    }

    const secondStore = createPostgresAgentRuntimeStore({ connectionString });
    const secondHarness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: secondStore,
    });

    try {
      await expect(
        secondHarness.getTask({
          tenantId: 'tenant-pg',
          projectId: 'project-pg',
          taskId: requireTaskId(taskId),
        }),
      ).resolves.toMatchObject({
        taskId,
        status: 'completed',
        transcript: [
          { role: 'user' },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'persisted in PostgreSQL' }],
          },
        ],
      });
      await expect(
        secondHarness.readEvents({
          tenantId: 'tenant-pg',
          projectId: 'project-pg',
          taskId: requireTaskId(taskId),
          runId: requireRunId(runId),
        }),
      ).resolves.toMatchObject({
        hasMore: false,
        events: [
          { sequence: 1, payload: { type: 'run_start' } },
          { sequence: 2, payload: { type: 'turn_start' } },
          { sequence: 3, payload: { type: 'model_start' } },
          { sequence: 4, payload: { type: 'text_delta' } },
          { sequence: 5, payload: { type: 'model_end' } },
          { sequence: 6, payload: { type: 'turn_end' } },
          { sequence: 7, payload: { type: 'run_end' } },
        ],
      });
    } finally {
      await secondHarness.dispose();
      await secondStore.dispose();
    }
  });

  it('fences competing recovery Workers and returns one consistent v3 snapshot', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const firstStore = createPostgresAgentRuntimeStore({ connectionString });
    const secondStore = createPostgresAgentRuntimeStore({ connectionString });
    const inspectionPool = new Pool({ connectionString });
    const suffix = randomUUID();
    const scope = { tenantId: 'tenant-pg', projectId: 'project-pg' };
    const query = {
      ...scope,
      taskId: `task-recovery-${suffix}`,
      runId: `run-recovery-${suffix}`,
    };
    const configFingerprint = `recovery-config-${suffix}`;
    const foreignConfigFingerprint = `foreign-recovery-config-${suffix}`;
    const foreignQuery = {
      ...scope,
      taskId: `task-foreign-recovery-${suffix}`,
      runId: `run-foreign-recovery-${suffix}`,
    };
    const now = new Date().toISOString();
    const later = new Date(Date.parse(now) + 30_000).toISOString();

    try {
      expect(firstStore.runLeaseSupport).toBe('v1');
      expect(firstStore.checkpointResumeSupport).toBe('v3');
      await firstStore.createTask({
        scope,
        taskId: foreignQuery.taskId,
        runId: foreignQuery.runId,
        commitId: `create-foreign-recovery-${suffix}`,
        checkpoint: {
          kind: 'input_accepted',
          input: 'do not materialize this foreign Run lease',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          resumeState: { kind: 'model', nextTurnIndex: 1 },
          harnessProtocolVersion: 3,
          checkpointSchemaVersion: 3,
          configFingerprint: foreignConfigFingerprint,
        },
        now,
      });
      const created = await firstStore.createTask({
        scope,
        taskId: query.taskId,
        runId: query.runId,
        commitId: `create-recovery-${suffix}`,
        checkpoint: {
          kind: 'input_accepted',
          input: 'recover this PostgreSQL Run',
          transcript: [
            { role: 'user', content: 'recover this PostgreSQL Run' },
          ],
          executionPosition: 'model',
          nextTurnIndex: 1,
          resumeState: { kind: 'model', nextTurnIndex: 1 },
          harnessProtocolVersion: 3,
          checkpointSchemaVersion: 3,
          configFingerprint,
        },
        initialLease: {
          ownershipId: `initial-ownership-${suffix}`,
          ownerId: `initial-worker-${suffix}`,
          leaseExpiresAt: later,
        },
        now,
      });
      expect(created.lease).toMatchObject({
        ownerId: `initial-worker-${suffix}`,
        fencingToken: 1,
      });
      await firstStore.releaseRunLease({
        ...query,
        releaseId: `initial-release-${suffix}`,
        ownerId: created.lease!.ownerId,
        leaseToken: created.lease!.leaseToken,
        fencingToken: created.lease!.fencingToken,
        now,
        availableAt: now,
      });

      const firstClaim = {
        claimId: `claim-a-${suffix}`,
        ownerId: `worker-a-${suffix}`,
        configFingerprint,
        limit: 1,
        now,
        leaseExpiresAt: later,
      };
      const secondClaim = {
        ...firstClaim,
        claimId: `claim-b-${suffix}`,
        ownerId: `worker-b-${suffix}`,
      };
      const claims = await Promise.all([
        firstStore.claimRecoverableRuns(firstClaim),
        secondStore.claimRecoverableRuns(secondClaim),
      ]);
      expect(claims.flatMap((batch) => batch.leases)).toHaveLength(1);
      await expect(
        inspectionPool.query(
          `SELECT 1
             FROM agent_runtime.run_execution_leases
            WHERE tenant_id = $1 AND project_id = $2
              AND task_id = $3 AND run_id = $4`,
          [
            foreignQuery.tenantId,
            foreignQuery.projectId,
            foreignQuery.taskId,
            foreignQuery.runId,
          ],
        ),
      ).resolves.toMatchObject({ rowCount: 0 });
      const winnerIndex = claims[0]!.leases.length === 1 ? 0 : 1;
      const winnerStore = winnerIndex === 0 ? firstStore : secondStore;
      const winnerCommand = winnerIndex === 0 ? firstClaim : secondClaim;
      const claimedLease = claims[winnerIndex]!.leases[0]!;
      expect(claimedLease.fencingToken).toBe(2);
      await expect(
        winnerStore.claimRecoverableRuns(winnerCommand),
      ).resolves.toEqual(claims[winnerIndex]);
      const renewal = {
        ...query,
        renewalId: `renewal-${suffix}`,
        ownerId: claimedLease.ownerId,
        leaseToken: claimedLease.leaseToken,
        fencingToken: claimedLease.fencingToken,
        now,
        leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
      };
      const lease = await winnerStore.renewRunLease(renewal);
      await expect(winnerStore.renewRunLease(renewal)).resolves.toEqual(lease);
      await expect(
        winnerStore.renewRunLease({
          ...renewal,
          leaseExpiresAt: new Date(Date.parse(now) + 90_000).toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'AGENT_COMMIT_MISMATCH' });

      const snapshot = await winnerStore.readRecoverySnapshot({
        ...query,
        ownerId: lease.ownerId,
        leaseToken: lease.leaseToken,
        fencingToken: lease.fencingToken,
        now,
      });
      expect(snapshot).toMatchObject({
        task: { version: created.version, status: 'queued' },
        checkpoint: {
          checkpointSchemaVersion: 3,
          resumeState: { kind: 'model', nextTurnIndex: 1 },
        },
        lastEventSequence: 0,
        lease: { ownerId: lease.ownerId, fencingToken: 2 },
      });

      await expect(
        firstStore.commitTask({
          ...query,
          commitId: `stale-commit-${suffix}`,
          expectedVersion: created.version,
          mutations: [{ type: 'run_started' }],
          lease: {
            leaseToken: created.lease!.leaseToken,
            fencingToken: created.lease!.fencingToken,
          },
          now,
        }),
      ).rejects.toMatchObject({ code: 'AGENT_RUN_LEASE_LOST' });
      await expect(firstStore.getTask(query)).resolves.toMatchObject({
        version: created.version,
        status: 'queued',
      });

      await winnerStore.commitTask({
        ...query,
        commitId: `resume-commit-${suffix}`,
        expectedVersion: created.version,
        mutations: [{ type: 'run_started' }],
        lease: {
          leaseToken: lease.leaseToken,
          fencingToken: lease.fencingToken,
        },
        recoveryAudit: {
          recoveryId: `recovery-${suffix}`,
          action: 'resumed',
          reasonCode: 'RECOVERY_RESUME',
        },
        now,
      });
      const release = {
        ...query,
        releaseId: `release-winner-${suffix}`,
        ownerId: lease.ownerId,
        leaseToken: lease.leaseToken,
        fencingToken: lease.fencingToken,
        now,
        availableAt: now,
      };
      await winnerStore.releaseRunLease(release);
      await expect(
        winnerStore.releaseRunLease(release),
      ).resolves.toBeUndefined();
      await expect(
        firstStore.readRunRecoveryAudit(query),
      ).resolves.toMatchObject([
        { sequence: 1, action: 'initial_claim', fencingToken: 1 },
        { sequence: 2, action: 'released', fencingToken: 1 },
        { sequence: 3, action: 'recovery_claim', fencingToken: 2 },
        { sequence: 4, action: 'resumed', fencingToken: 2 },
        { sequence: 5, action: 'released', fencingToken: 2 },
      ]);
    } finally {
      await inspectionPool.end();
      await firstStore.dispose();
      await secondStore.dispose();
    }
  });

  it('atomically retries safe orphan tools and quarantines external effects', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const store = createPostgresAgentRuntimeStore({ connectionString });
    const suffix = randomUUID();
    const scope = { tenantId: 'tenant-pg', projectId: 'project-pg' };
    const query = {
      ...scope,
      taskId: `task-orphan-${suffix}`,
      runId: `run-orphan-${suffix}`,
    };
    const now = new Date().toISOString();
    const deadline = new Date(Date.parse(now) + 30_000).toISOString();
    const configFingerprint = `orphan-config-${suffix}`;

    try {
      let receipt = await store.createTask({
        scope,
        taskId: query.taskId,
        runId: query.runId,
        commitId: `create-orphan-${suffix}`,
        checkpoint: {
          kind: 'input_accepted',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          resumeState: { kind: 'model', nextTurnIndex: 1 },
          harnessProtocolVersion: 3,
          checkpointSchemaVersion: 3,
          configFingerprint,
        },
        initialLease: {
          ownershipId: `ownership-orphan-${suffix}`,
          ownerId: `worker-orphan-a-${suffix}`,
          leaseExpiresAt: deadline,
        },
        now,
      });
      const initialGuard = {
        leaseToken: receipt.lease!.leaseToken,
        fencingToken: receipt.lease!.fencingToken,
      };
      receipt = await store.commitTask({
        ...query,
        commitId: `propose-orphan-${suffix}`,
        expectedVersion: receipt.version,
        mutations: [
          { type: 'run_started' },
          { type: 'turn_started', turnId: `turn-${suffix}`, turnIndex: 1 },
        ],
        toolExecutions: [
          {
            type: 'tool_execution_proposed',
            toolExecutionId: `safe-execution-${suffix}`,
            toolCallId: `safe-call-${suffix}`,
            turnId: `turn-${suffix}`,
            turnIndex: 1,
            proposalSequence: 1,
            toolName: 'safe-tool',
            argumentsDigest: 'safe-digest',
          },
          {
            type: 'tool_execution_proposed',
            toolExecutionId: `external-execution-${suffix}`,
            toolCallId: `external-call-${suffix}`,
            turnId: `turn-${suffix}`,
            turnIndex: 1,
            proposalSequence: 2,
            toolName: 'external-tool',
            argumentsDigest: 'external-digest',
          },
        ],
        lease: initialGuard,
        now,
      });
      receipt = await store.commitTask({
        ...query,
        commitId: `prepare-orphan-${suffix}`,
        expectedVersion: receipt.version,
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_prepared',
            toolExecutionId: `safe-execution-${suffix}`,
            sideEffect: 'none',
            idempotency: 'none',
            timeoutMs: 30_000,
            deadline,
          },
          {
            type: 'tool_execution_prepared',
            toolExecutionId: `external-execution-${suffix}`,
            sideEffect: 'external',
            idempotency: 'keyed',
            timeoutMs: 30_000,
            idempotencyKey: `external-key-${suffix}`,
            deadline,
          },
        ],
        lease: initialGuard,
        now,
      });
      receipt = await store.commitTask({
        ...query,
        commitId: `start-orphan-${suffix}`,
        expectedVersion: receipt.version,
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_started',
            toolExecutionId: `safe-execution-${suffix}`,
            attemptId: `safe-attempt-${suffix}`,
            attempt: 1,
          },
          {
            type: 'tool_execution_started',
            toolExecutionId: `external-execution-${suffix}`,
            attemptId: `external-attempt-${suffix}`,
            attempt: 1,
          },
        ],
        lease: initialGuard,
        now,
      });
      await store.releaseRunLease({
        ...query,
        releaseId: `release-orphan-${suffix}`,
        ownerId: receipt.lease?.ownerId ?? `worker-orphan-a-${suffix}`,
        leaseToken: initialGuard.leaseToken,
        fencingToken: initialGuard.fencingToken,
        now,
        availableAt: now,
      });
      const claimed = await store.claimRecoverableRuns({
        claimId: `claim-orphan-${suffix}`,
        ownerId: `worker-orphan-b-${suffix}`,
        configFingerprint,
        limit: 1,
        now,
        leaseExpiresAt: deadline,
      });
      const recoveryLease = claimed.leases[0]!;
      const recoveryGuard = {
        leaseToken: recoveryLease.leaseToken,
        fencingToken: recoveryLease.fencingToken,
      };
      await expect(
        store.commitTask({
          ...query,
          commitId: `invalid-orphan-${suffix}`,
          expectedVersion: receipt.version,
          mutations: [],
          toolExecutions: [
            {
              type: 'tool_execution_orphan_reprepared',
              toolExecutionId: `safe-execution-${suffix}`,
              attemptId: `safe-attempt-${suffix}`,
              deadline,
              reasonCode: 'SAFE_RECOVERY_RETRY',
            },
            {
              type: 'tool_execution_orphan_reprepared',
              toolExecutionId: `external-execution-${suffix}`,
              attemptId: `external-attempt-${suffix}`,
              deadline,
              reasonCode: 'SAFE_RECOVERY_RETRY',
            },
          ],
          lease: recoveryGuard,
          now,
        }),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(store.readToolExecutions(query)).resolves.toMatchObject([
        { status: 'running', attempts: [{ status: 'running' }] },
        { status: 'running', attempts: [{ status: 'running' }] },
      ]);

      await store.commitTask({
        ...query,
        commitId: `resolve-orphan-${suffix}`,
        expectedVersion: receipt.version,
        mutations: [{ type: 'reconciliation_wait_started' }],
        toolExecutions: [
          {
            type: 'tool_execution_orphan_reprepared',
            toolExecutionId: `safe-execution-${suffix}`,
            attemptId: `safe-attempt-${suffix}`,
            deadline,
            reasonCode: 'SAFE_RECOVERY_RETRY',
          },
          {
            type: 'tool_execution_orphan_quarantined',
            toolExecutionId: `external-execution-${suffix}`,
            attemptId: `external-attempt-${suffix}`,
            reasonCode: 'OWNER_LEASE_EXPIRED',
          },
        ],
        lease: recoveryGuard,
        recoveryAudit: {
          recoveryId: `resolve-orphan-${suffix}`,
          action: 'resumed',
          reasonCode: 'RECOVERY_RESUME',
        },
        checkpoint: {
          kind: 'reconciliation_waiting',
          transcript: [],
          turnIndex: 1,
          executionPosition: 'reconciliation',
          nextTurnIndex: 1,
          resumeState: {
            kind: 'reconciliation',
            toolExecutionId: `external-execution-${suffix}`,
            attemptId: `external-attempt-${suffix}`,
          },
          harnessProtocolVersion: 3,
          checkpointSchemaVersion: 3,
          configFingerprint,
        },
        now,
      });
      await expect(store.getTask(query)).resolves.toMatchObject({
        status: 'waiting_for_reconciliation',
        runs: [{ status: 'waiting_for_reconciliation' }],
      });
      await expect(store.readToolExecutions(query)).resolves.toMatchObject([
        {
          status: 'prepared',
          attempts: [
            {
              status: 'unknown',
              effectOutcome: 'not_applied',
              errorCode: 'OWNER_LEASE_EXPIRED',
            },
          ],
        },
        {
          status: 'unknown',
          effectOutcome: 'unknown',
          retryable: false,
          attempts: [{ status: 'unknown', effectOutcome: 'unknown' }],
        },
      ]);
    } finally {
      await store.dispose();
    }
  });

  it('persists a pending Approval and its decision across Store instances', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const firstStore = createPostgresAgentRuntimeStore({ connectionString });
    const secondStore = createPostgresAgentRuntimeStore({ connectionString });
    const suffix = randomUUID();
    const scope = { tenantId: 'tenant-pg', projectId: 'project-pg' };
    const query = {
      ...scope,
      taskId: `task-approval-${suffix}`,
      runId: `run-approval-${suffix}`,
    };
    const approvalId = `approval-${suffix}`;
    const toolExecutionId = `execution-${suffix}`;

    try {
      let receipt = await firstStore.createTask({
        scope,
        taskId: query.taskId,
        runId: query.runId,
        commitId: `create-approval-${suffix}`,
        checkpoint: {
          kind: 'input_accepted',
          input: 'persist PostgreSQL Approval',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 2,
          configFingerprint: 'test-config',
        },
        now: '2026-08-01T00:00:00.000Z',
      });
      receipt = await firstStore.commitTask({
        ...query,
        commitId: `propose-approval-${suffix}`,
        expectedVersion: receipt.version,
        mutations: [
          { type: 'run_started' },
          { type: 'turn_started', turnId: `turn-${suffix}`, turnIndex: 1 },
        ],
        toolExecutions: [
          {
            type: 'tool_execution_proposed',
            toolExecutionId,
            toolCallId: `call-${suffix}`,
            turnId: `turn-${suffix}`,
            turnIndex: 1,
            proposalSequence: 1,
            toolName: 'approval-tool',
            argumentsDigest: 'safe-arguments-digest',
          },
        ],
        now: '2026-08-01T00:00:01.000Z',
      });
      const waiting = await firstStore.commitTask({
        ...query,
        commitId: `wait-approval-${suffix}`,
        expectedVersion: receipt.version,
        mutations: [{ type: 'approval_wait_started' }],
        toolExecutions: [
          {
            type: 'tool_execution_awaiting_approval',
            toolExecutionId,
            sideEffect: 'external',
            idempotency: 'keyed',
            timeoutMs: 30_000,
          },
        ],
        approvals: [
          {
            type: 'approval_requested',
            approvalId,
            toolExecutionId,
            turnId: `turn-${suffix}`,
            proposalSequence: 1,
            policyId: 'postgres-approval-policy',
            policyVersion: 'v1',
            argumentsDigest: 'safe-arguments-digest',
            expiresAt: '2026-08-01T00:01:00.000Z',
            presentation: { title: 'Approve PostgreSQL action' },
          },
        ],
        checkpoint: {
          kind: 'approval_waiting',
          transcript: [],
          turnIndex: 1,
          executionPosition: 'approval',
          nextTurnIndex: 1,
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 2,
          configFingerprint: 'test-config',
        },
        now: '2026-08-01T00:00:02.000Z',
      });

      await expect(secondStore.readApprovals(query)).resolves.toMatchObject([
        {
          approvalId,
          toolExecutionId,
          status: 'pending',
          rowVersion: 1,
          presentation: { title: 'Approve PostgreSQL action' },
          transitions: [{ sequence: 1, to: 'pending' }],
        },
      ]);
      const decisionCommand = {
        ...query,
        approvalId,
        commitId: `decide-approval-${suffix}`,
        decisionId: `decision-${suffix}`,
        decision: 'approved' as const,
        decidedBy: 'user-pg',
        reasonCode: 'HUMAN_APPROVED',
        now: '2026-08-01T00:00:03.000Z',
      };
      const decided = await secondStore.decideApproval(decisionCommand);

      expect(decided).toMatchObject({
        version: waiting.version + 1,
        approval: {
          status: 'approved',
          decisionId: `decision-${suffix}`,
          decidedBy: 'user-pg',
          rowVersion: 2,
        },
      });
      await expect(firstStore.readApprovals(query)).resolves.toMatchObject([
        {
          status: 'approved',
          transitions: [
            { sequence: 1, to: 'pending' },
            {
              sequence: 2,
              from: 'pending',
              to: 'approved',
              decisionId: `decision-${suffix}`,
            },
          ],
        },
      ]);
      await expect(
        firstStore.decideApproval({
          ...decisionCommand,
          commitId: `replay-approval-${suffix}`,
          now: '2026-08-01T00:00:04.000Z',
        }),
      ).resolves.toEqual(decided);
      await expect(
        firstStore.decideApproval({
          ...decisionCommand,
          commitId: `mismatch-approval-${suffix}`,
          decidedBy: 'different-user-pg',
        }),
      ).rejects.toMatchObject({
        code: 'AGENT_APPROVAL_DECISION_MISMATCH',
      });
    } finally {
      await firstStore.dispose();
      await secondStore.dispose();
    }
  });

  it('wakes Harness A after Harness B decides a PostgreSQL Approval', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const firstStore = createPostgresAgentRuntimeStore({ connectionString });
    const secondPool = new Pool({ connectionString });
    const ambiguity = createAmbiguousCommitPool(secondPool);
    const secondStore = createPostgresAgentRuntimeStore({
      pool: ambiguity.pool,
    });
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'pg-cross-instance-call',
          name: 'pg-cross-instance-tool',
          rawArguments: '{}',
        }),
        fauxTextResponse('cross-instance approval complete'),
      ],
    });
    const scheduled = new Map<number, Set<() => void>>();
    const timer = {
      schedule(delayMs: number, callback: () => void) {
        const callbacks = scheduled.get(delayMs) ?? new Set();
        callbacks.add(callback);
        scheduled.set(delayMs, callbacks);
        return () => {
          callbacks.delete(callback);
          if (callbacks.size === 0) scheduled.delete(delayMs);
        };
      },
    };
    let invocationCount = 0;
    const tool: AgentTool = {
      definition: {
        name: 'pg-cross-instance-tool',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: {
        sideEffect: 'external',
        idempotency: 'keyed',
        timeoutMs: 30_000,
      },
      execute: async () => {
        invocationCount += 1;
        return { content: [{ type: 'text', text: 'approved remotely' }] };
      },
    };
    const approvalPolicy = {
      policyId: 'postgres-cross-instance-policy',
      version: 'v1',
      evaluate: () => ({
        decision: 'require_approval' as const,
        expiresAt: '2026-08-01T00:01:00.000Z',
        presentation: { title: 'Approve cross-instance action' },
      }),
    };
    const firstHarness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: firstStore,
      tools: [tool],
      approvalPolicy,
      timer,
      durableEventBatch: { maxEvents: 1 },
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });
    const secondHarness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: secondStore,
      tools: [tool],
      approvalPolicy,
      clock: { now: () => '2026-08-01T00:00:01.000Z' },
    });

    try {
      const handle = await firstHarness.startTask({
        scope: { tenantId: 'tenant-pg', projectId: 'project-pg' },
        input: 'wait for another Harness',
      });
      const iterator = handle.events[Symbol.asyncIterator]();
      let approvalId: string | undefined;
      const observedEvents = [];
      for (;;) {
        const next = await iterator.next();
        if (next.done) throw new Error('Expected a PostgreSQL Approval');
        observedEvents.push(next.value);
        if (next.value.payload.type === 'approval_requested') {
          approvalId = next.value.payload.approvalId;
          break;
        }
      }
      for (let index = 0; index < 10 && !scheduled.has(1_000); index += 1)
        await Promise.resolve();
      const poll = [...(scheduled.get(1_000) ?? [])][0];
      expect(poll).toEqual(expect.any(Function));

      const remoteDecisionId = `remote-decision-${randomUUID()}`;
      const remoteDecision = {
        tenantId: 'tenant-pg',
        projectId: 'project-pg',
        taskId: handle.taskId,
        runId: handle.runId,
        approvalId: approvalId!,
        decisionId: remoteDecisionId,
        decision: 'approved' as const,
        decidedBy: 'remote-reviewer',
      };
      ambiguity.arm();
      await secondHarness.decideApproval(remoteDecision);
      scheduled.get(1_000)?.delete(poll!);
      poll!();
      const remainingEvents = collectIterator(iterator);
      const [result, remaining] = await Promise.all([
        handle.result(),
        remainingEvents,
      ]);
      observedEvents.push(...remaining);
      const query = {
        tenantId: 'tenant-pg',
        projectId: 'project-pg',
        taskId: handle.taskId,
        runId: handle.runId,
      };
      const [approvals, executions] = await Promise.all([
        firstStore.readApprovals(query),
        firstStore.readToolExecutions(query),
      ]);

      expect(result).toMatchObject({
        status: 'completed',
        execution: {
          response: {
            content: [
              { type: 'text', text: 'cross-instance approval complete' },
            ],
          },
        },
      });
      expect(invocationCount).toBe(1);
      expect(approvals).toMatchObject([
        {
          status: 'approved',
          decidedBy: 'remote-reviewer',
          consumeId: expect.any(String),
          consumedAt: expect.any(String),
        },
      ]);
      expect(executions).toMatchObject([
        {
          status: 'succeeded',
          attemptCount: 1,
          attempts: [{ attempt: 1, status: 'succeeded' }],
        },
      ]);
      const replayedDecision =
        await secondHarness.decideApproval(remoteDecision);
      expect(replayedDecision).toMatchObject({
        status: 'approved',
        decisionId: remoteDecisionId,
      });
      expect(replayedDecision).not.toHaveProperty('consumedAt');
      expect(replayedDecision).not.toHaveProperty('consumeId');
      await expect(
        secondHarness.decideApproval({
          ...remoteDecision,
          decisionId: `competing-decision-${randomUUID()}`,
          decision: 'denied',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_APPROVAL_ALREADY_DECIDED' });
      expect(
        observedEvents
          .map((event) => event.payload.type)
          .filter(
            (type) =>
              type.startsWith('approval_') ||
              type.startsWith('tool_execution_'),
          ),
      ).toEqual([
        'approval_requested',
        'approval_decided',
        'tool_execution_start',
        'tool_execution_end',
      ]);
    } finally {
      await firstHarness.dispose();
      await secondHarness.dispose();
      await firstStore.dispose();
      await secondStore.dispose();
      await secondPool.end();
    }
  });

  it('reads a successful tool execution from a separate Store instance', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const firstStore = createPostgresAgentRuntimeStore({ connectionString });
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'pg-ledger-call',
          name: 'pg-ledger-tool',
          rawArguments: '{}',
        }),
        fauxTextResponse('PostgreSQL ledger complete'),
      ],
    });
    const tool: AgentTool = {
      definition: {
        name: 'pg-ledger-tool',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: {
        sideEffect: 'external',
        idempotency: 'keyed',
        timeoutMs: 30_000,
      },
      execute: async () => ({
        content: [{ type: 'text', text: 'PostgreSQL ledger result' }],
      }),
    };
    const firstHarness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: firstStore,
      tools: [tool],
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });
    let taskId: string | undefined;
    let runId: string | undefined;

    try {
      const handle = await firstHarness.startTask({
        scope: { tenantId: 'tenant-pg', projectId: 'project-pg' },
        input: 'persist the PostgreSQL tool ledger',
      });
      taskId = handle.taskId;
      runId = handle.runId;
      await Promise.all([collect(handle.events), handle.result()]);
    } finally {
      await firstHarness.dispose();
      await firstStore.dispose();
    }

    const secondStore = createPostgresAgentRuntimeStore({ connectionString });
    const secondHarness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: secondStore,
      tools: [tool],
    });

    try {
      await expect(
        secondHarness.readToolExecutions({
          tenantId: 'tenant-pg',
          projectId: 'project-pg',
          taskId: requireTaskId(taskId),
          runId: requireRunId(runId),
        }),
      ).resolves.toMatchObject({
        hasMore: false,
        executions: [
          {
            toolCallId: 'pg-ledger-call',
            status: 'succeeded',
            effectOutcome: 'applied',
            attemptCount: 1,
            attempts: [{ attempt: 1, status: 'succeeded' }],
            transitions: [
              { sequence: 1, to: 'proposed' },
              { sequence: 2, to: 'prepared' },
              { sequence: 3, to: 'running' },
              { sequence: 4, to: 'succeeded' },
            ],
          },
        ],
      });
    } finally {
      await secondHarness.dispose();
      await secondStore.dispose();
    }
  });

  it('persists rejected and uncertain tool outcomes without extra attempts', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const store = createPostgresAgentRuntimeStore({ connectionString });
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'pg-missing-call',
          name: 'pg-missing-tool',
          rawArguments: '{}',
        }),
        fauxToolResponse({
          id: 'pg-uncertain-call',
          name: 'pg-uncertain-tool',
          rawArguments: '{}',
        }),
        fauxTextResponse('PostgreSQL failures complete'),
      ],
    });
    const uncertainTool: AgentTool = {
      definition: {
        name: 'pg-uncertain-tool',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: {
        sideEffect: 'external',
        idempotency: 'none',
        timeoutMs: 30_000,
      },
      execute: async () => {
        throw new Error('postgres-secret-canary');
      },
    };
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: store,
      tools: [uncertainTool],
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-pg', projectId: 'project-pg' },
        input: 'persist rejected and uncertain outcomes',
      });
      const [, result] = await Promise.all([
        collect(handle.events),
        handle.result(),
      ]);
      const executions = await store.readToolExecutions({
        tenantId: 'tenant-pg',
        projectId: 'project-pg',
        taskId: handle.taskId,
        runId: handle.runId,
      });

      expect(executions).toMatchObject([
        {
          toolCallId: 'pg-missing-call',
          status: 'failed',
          effectOutcome: 'not_applied',
          attemptCount: 0,
          attempts: [],
        },
        {
          toolCallId: 'pg-uncertain-call',
          status: 'unknown',
          effectOutcome: 'unknown',
          attemptCount: 1,
          attempts: [{ status: 'unknown' }],
        },
      ]);
      expect(JSON.stringify({ executions, result })).not.toContain(
        'postgres-secret-canary',
      );
    } finally {
      await harness.dispose();
      await store.dispose();
    }
  });

  it('commits checkpoint, events, and outbox with terminal Task state', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const store = createPostgresAgentRuntimeStore({ connectionString });
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('PostgreSQL atomic commit')],
    });
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: store,
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-pg', projectId: 'project-pg' },
        input: 'commit PostgreSQL state atomically',
      });
      await Promise.all([collect(handle.events), handle.result()]);
      const query = {
        tenantId: 'tenant-pg',
        projectId: 'project-pg',
        taskId: handle.taskId,
        runId: handle.runId,
      };
      const [task, checkpoint, eventPage, outbox] = await Promise.all([
        store.getTask(query),
        store.getCheckpoint(query),
        store.readEvents({ ...query, afterSequence: 0, limit: 100 }),
        store.claimOutbox({
          workerId: 'postgres-worker-1',
          limit: 100,
          now: '2026-08-01T00:00:01.000Z',
          leaseExpiresAt: '2026-08-01T00:01:01.000Z',
        }),
      ]);

      expect(task).toMatchObject({ status: 'completed' });
      expect(checkpoint).toMatchObject({
        kind: 'run_terminal',
        version: 3,
        transcript: [
          { role: 'user' },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'PostgreSQL atomic commit' }],
          },
        ],
      });
      expect(eventPage.events.map((event) => event.payload.type)).toEqual([
        'run_start',
        'turn_start',
        'model_start',
        'text_delta',
        'model_end',
        'turn_end',
        'run_end',
      ]);
      expect(
        outbox.messages
          .filter((message) => message.event.taskId === handle.taskId)
          .map((message) => message.event.eventId),
      ).toEqual(eventPage.events.map((event) => event.eventId));
      const taskMessages = outbox.messages.filter(
        (message) => message.event.taskId === handle.taskId,
      );
      const deliveredIds = taskMessages
        .slice(0, 2)
        .map((message) => message.outboxId);
      const releasedId = taskMessages[2]?.outboxId;
      if (!releasedId) throw new TypeError('Expected PostgreSQL outbox rows');
      await expect(
        store.acknowledgeOutbox({
          workerId: 'postgres-worker-1',
          outboxIds: deliveredIds,
          now: '2026-08-01T00:00:02.000Z',
        }),
      ).resolves.toEqual({ updatedCount: 2 });
      await expect(
        store.acknowledgeOutbox({
          workerId: 'postgres-worker-1',
          outboxIds: deliveredIds,
          now: '2026-08-01T00:00:03.000Z',
        }),
      ).resolves.toEqual({ updatedCount: 0 });
      await expect(
        store.releaseOutbox({
          workerId: 'postgres-worker-1',
          outboxIds: [releasedId],
          now: '2026-08-01T00:00:04.000Z',
          availableAt: '2026-08-01T00:02:00.000Z',
        }),
      ).resolves.toEqual({ updatedCount: 1 });
      const early = await store.claimOutbox({
        workerId: 'postgres-worker-2',
        limit: 10_000,
        now: '2026-08-01T00:00:30.000Z',
        leaseExpiresAt: '2026-08-01T00:01:30.000Z',
      });
      expect(
        early.messages.filter(
          (message) => message.event.taskId === handle.taskId,
        ),
      ).toHaveLength(0);
      const reclaimed = await store.claimOutbox({
        workerId: 'postgres-worker-2',
        limit: 10_000,
        now: '2026-08-01T00:02:01.000Z',
        leaseExpiresAt: '2026-08-01T00:03:01.000Z',
      });
      const reclaimedTaskMessages = reclaimed.messages.filter(
        (message) => message.event.taskId === handle.taskId,
      );
      expect(reclaimedTaskMessages).toHaveLength(5);
      expect(reclaimedTaskMessages.map((message) => message.attempt)).toEqual(
        Array(5).fill(2),
      );
    } finally {
      await harness.dispose();
      await store.dispose();
    }
  });

  it('reconciles retries and rejects concurrent stale commits', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const store = createPostgresAgentRuntimeStore({ connectionString });
    const suffix = randomUUID();
    const scope = { tenantId: 'tenant-pg', projectId: 'project-pg' };
    const taskId = `task-commit-${suffix}`;
    const runId = `run-commit-${suffix}`;

    try {
      const createCommand = {
        scope,
        taskId,
        runId,
        commitId: `create-${suffix}`,
        checkpoint: {
          kind: 'input_accepted' as const,
          input: 'PostgreSQL commit protocol',
          transcript: [],
          executionPosition: 'model' as const,
          nextTurnIndex: 1,
          harnessProtocolVersion: 1,
          checkpointSchemaVersion: 1,
          configFingerprint: 'test-config',
        },
        now: '2026-08-01T00:00:00.000Z',
      };
      const created = await store.createTask(createCommand);
      await expect(store.createTask(createCommand)).resolves.toEqual(created);

      const baseCommand = {
        ...scope,
        taskId,
        runId,
        expectedVersion: created.version,
        mutations: [{ type: 'run_started' as const }],
        now: '2026-08-01T00:00:01.000Z',
      };
      const outcomes = await Promise.allSettled([
        store.commitTask({ ...baseCommand, commitId: `start-a-${suffix}` }),
        store.commitTask({ ...baseCommand, commitId: `start-b-${suffix}` }),
      ]);
      const succeeded = outcomes.find(
        (outcome) => outcome.status === 'fulfilled',
      );
      const failed = outcomes.find((outcome) => outcome.status === 'rejected');

      expect(succeeded).toMatchObject({ status: 'fulfilled' });
      expect(failed).toMatchObject({
        status: 'rejected',
        reason: { code: 'AGENT_STATE_CONFLICT' },
      });
      if (!succeeded || succeeded.status !== 'fulfilled')
        throw new TypeError('Expected one PostgreSQL commit to succeed');
      const successfulCommand =
        succeeded.value.commitId === `start-a-${suffix}`
          ? { ...baseCommand, commitId: `start-a-${suffix}` }
          : { ...baseCommand, commitId: `start-b-${suffix}` };
      await expect(store.commitTask(successfulCommand)).resolves.toEqual(
        succeeded.value,
      );
      await expect(
        store.commitTask({
          ...successfulCommand,
          now: '2026-08-01T00:00:02.000Z',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_COMMIT_MISMATCH' });
    } finally {
      await store.dispose();
    }
  });

  it('reconciles a Ledger Attempt and rolls back an invalid atomic terminal commit', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const store = createPostgresAgentRuntimeStore({ connectionString });
    const suffix = randomUUID();
    const scope = { tenantId: 'tenant-pg', projectId: 'project-pg' };
    const query = {
      ...scope,
      taskId: `task-ledger-atomic-${suffix}`,
      runId: `run-ledger-atomic-${suffix}`,
    };

    try {
      let receipt = await store.createTask({
        scope,
        taskId: query.taskId,
        runId: query.runId,
        commitId: `create-ledger-atomic-${suffix}`,
        checkpoint: {
          kind: 'input_accepted',
          input: 'PostgreSQL Ledger atomicity',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          harnessProtocolVersion: 1,
          checkpointSchemaVersion: 1,
          configFingerprint: 'test-config',
        },
        now: '2026-08-01T00:00:00.000Z',
      });
      receipt = await store.commitTask({
        ...query,
        commitId: `propose-ledger-atomic-${suffix}`,
        expectedVersion: receipt.version,
        mutations: [
          { type: 'run_started' },
          { type: 'turn_started', turnId: 'turn-ledger', turnIndex: 1 },
        ],
        toolExecutions: [
          {
            type: 'tool_execution_proposed',
            toolExecutionId: 'execution-ledger',
            toolCallId: 'call-ledger',
            turnId: 'turn-ledger',
            turnIndex: 1,
            proposalSequence: 1,
            toolName: 'ledger-tool',
            argumentsDigest: 'ledger-arguments',
          },
        ],
        now: '2026-08-01T00:00:01.000Z',
      });
      receipt = await store.commitTask({
        ...query,
        commitId: `prepare-ledger-atomic-${suffix}`,
        expectedVersion: receipt.version,
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_prepared',
            toolExecutionId: 'execution-ledger',
            sideEffect: 'external',
            idempotency: 'keyed',
            timeoutMs: 30_000,
            idempotencyKey: 'opaque-ledger-key',
            deadline: '2026-08-01T00:00:31.000Z',
          },
        ],
        now: '2026-08-01T00:00:02.000Z',
      });
      const startedCommand = {
        ...query,
        commitId: `start-ledger-atomic-${suffix}`,
        expectedVersion: receipt.version,
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_started' as const,
            toolExecutionId: 'execution-ledger',
            attemptId: 'attempt-ledger',
            attempt: 1,
          },
        ],
        now: '2026-08-01T00:00:03.000Z',
      };
      const started = await store.commitTask(startedCommand);
      await expect(store.commitTask(startedCommand)).resolves.toEqual(started);

      await expect(
        store.commitTask({
          ...query,
          commitId: `invalid-terminal-ledger-${suffix}`,
          expectedVersion: started.version,
          mutations: [],
          toolExecutions: [
            {
              type: 'tool_execution_finished',
              toolExecutionId: 'execution-ledger',
              attemptId: 'wrong-attempt-ledger',
              status: 'succeeded',
              effectOutcome: 'applied',
              retryable: false,
            },
          ],
          events: [
            {
              eventId: `invalid-event-${suffix}`,
              ...query,
              turnId: 'turn-ledger',
              turnIndex: 1,
              sequence: 1,
              occurredAt: '2026-08-01T00:00:04.000Z',
              payload: {
                type: 'tool_execution_end',
                toolCallId: 'call-ledger',
                result: {
                  role: 'tool_result',
                  toolCallId: 'call-ledger',
                  toolName: 'ledger-tool',
                  isError: false,
                  content: [],
                },
              },
            },
          ],
          now: '2026-08-01T00:00:04.000Z',
        }),
      ).rejects.toThrow();

      const [executions, events, outbox] = await Promise.all([
        store.readToolExecutions(query),
        store.readEvents({ ...query, afterSequence: 0, limit: 100 }),
        store.claimOutbox({
          workerId: `ledger-atomic-worker-${suffix}`,
          limit: 10_000,
          now: '2026-08-01T00:01:00.000Z',
          leaseExpiresAt: '2026-08-01T00:02:00.000Z',
        }),
      ]);
      expect(executions).toMatchObject([
        {
          status: 'running',
          attemptCount: 1,
          attempts: [{ attemptId: 'attempt-ledger', status: 'running' }],
          transitions: [
            { sequence: 1, to: 'proposed' },
            { sequence: 2, to: 'prepared' },
            { sequence: 3, to: 'running' },
          ],
        },
      ]);
      expect(events.events).toHaveLength(0);
      expect(
        outbox.messages.filter(
          (message) => message.event.taskId === query.taskId,
        ),
      ).toHaveLength(0);
    } finally {
      await store.dispose();
    }
  });

  it('rolls back every Approval consumption write and leaves no commit receipt', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const store = createPostgresAgentRuntimeStore({ connectionString });
    const suffix = randomUUID();
    const scope = { tenantId: 'tenant-pg', projectId: 'project-pg' };
    const query = {
      ...scope,
      taskId: `task-approval-atomic-${suffix}`,
      runId: `run-approval-atomic-${suffix}`,
    };
    const turnId = `turn-approval-atomic-${suffix}`;
    const toolExecutionId = `execution-approval-atomic-${suffix}`;
    const approvalId = `approval-atomic-${suffix}`;
    const decisionId = `decision-approval-atomic-${suffix}`;
    const commitId = `consume-approval-atomic-${suffix}`;

    try {
      let receipt = await store.createTask({
        scope,
        taskId: query.taskId,
        runId: query.runId,
        commitId: `create-approval-atomic-${suffix}`,
        checkpoint: {
          kind: 'input_accepted',
          input: 'PostgreSQL Approval atomicity',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 2,
          configFingerprint: 'test-config',
        },
        now: '2026-08-01T00:00:00.000Z',
      });
      receipt = await store.commitTask({
        ...query,
        commitId: `propose-approval-atomic-${suffix}`,
        expectedVersion: receipt.version,
        mutations: [
          { type: 'run_started' },
          { type: 'turn_started', turnId, turnIndex: 1 },
        ],
        toolExecutions: [
          {
            type: 'tool_execution_proposed',
            toolExecutionId,
            toolCallId: `call-approval-atomic-${suffix}`,
            turnId,
            turnIndex: 1,
            proposalSequence: 1,
            toolName: 'approval-atomic-tool',
            argumentsDigest: 'approval-atomic-arguments',
          },
        ],
        now: '2026-08-01T00:00:01.000Z',
      });
      await store.commitTask({
        ...query,
        commitId: `wait-approval-atomic-${suffix}`,
        expectedVersion: receipt.version,
        mutations: [{ type: 'approval_wait_started' }],
        toolExecutions: [
          {
            type: 'tool_execution_awaiting_approval',
            toolExecutionId,
            sideEffect: 'external',
            idempotency: 'keyed',
            timeoutMs: 30_000,
          },
        ],
        approvals: [
          {
            type: 'approval_requested',
            approvalId,
            toolExecutionId,
            turnId,
            proposalSequence: 1,
            policyId: 'postgres-atomic-policy',
            policyVersion: 'v1',
            argumentsDigest: 'approval-atomic-arguments',
            expiresAt: '2026-08-01T00:01:00.000Z',
            presentation: { title: 'Approve atomic action' },
          },
        ],
        checkpoint: {
          kind: 'approval_waiting',
          transcript: [],
          turnIndex: 1,
          executionPosition: 'approval',
          nextTurnIndex: 1,
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 2,
          configFingerprint: 'test-config',
        },
        now: '2026-08-01T00:00:02.000Z',
      });
      const decided = await store.decideApproval({
        ...query,
        approvalId,
        commitId: `decide-approval-atomic-${suffix}`,
        decisionId,
        decision: 'approved',
        decidedBy: 'atomic-reviewer',
        now: '2026-08-01T00:00:03.000Z',
      });
      const validCommand = {
        ...query,
        commitId,
        expectedVersion: decided.version,
        mutations: [{ type: 'approval_wait_resumed' as const }],
        toolExecutions: [
          {
            type: 'tool_execution_prepared' as const,
            toolExecutionId,
            sideEffect: 'external' as const,
            idempotency: 'keyed' as const,
            timeoutMs: 30_000,
            idempotencyKey: `approval-atomic-key-${suffix}`,
            deadline: '2026-08-01T00:00:34.000Z',
          },
        ],
        approvals: [
          {
            type: 'approval_consumed' as const,
            approvalId,
            toolExecutionId,
            decisionId,
            consumeId: `consume-id-${suffix}`,
          },
        ],
        events: [
          {
            eventId: `approval-decided-event-${suffix}`,
            ...query,
            turnId,
            turnIndex: 1,
            sequence: 1,
            occurredAt: '2026-08-01T00:00:04.000Z',
            payload: {
              type: 'approval_decided' as const,
              approvalId,
              toolExecutionId,
              decision: 'approved' as const,
              decidedBy: 'atomic-reviewer',
            },
          },
        ],
        checkpoint: {
          kind: 'approval_resolved' as const,
          transcript: [],
          turnIndex: 1,
          executionPosition: 'tool' as const,
          nextTurnIndex: 1,
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 2,
          configFingerprint: 'test-config',
        },
        now: '2026-08-01T00:00:04.000Z',
      };

      await expect(
        store.commitTask({
          ...validCommand,
          checkpoint: {
            ...validCommand.checkpoint,
            kind: 'invalid_checkpoint' as 'approval_resolved',
          },
        }),
      ).rejects.toThrow();

      const [rolledBackTask, rolledBackApprovals, rolledBackExecutions] =
        await Promise.all([
          store.getTask(query),
          store.readApprovals(query),
          store.readToolExecutions(query),
        ]);
      const [rolledBackCheckpoints, rolledBackEvents, rolledBackOutbox] =
        await Promise.all([
          store.readCheckpoints(query),
          store.readEvents({ ...query, afterSequence: 0, limit: 100 }),
          store.claimOutbox({
            workerId: `approval-rollback-worker-${suffix}`,
            limit: 10_000,
            now: '2026-08-01T00:00:05.000Z',
            leaseExpiresAt: '2026-08-01T00:01:05.000Z',
          }),
        ]);

      expect(rolledBackTask).toMatchObject({
        status: 'waiting_for_approval',
        version: decided.version,
        runs: [{ status: 'waiting_for_approval' }],
      });
      expect(rolledBackApprovals).toMatchObject([
        {
          status: 'approved',
          rowVersion: 2,
          decisionId,
          transitions: [
            { sequence: 1, to: 'pending' },
            { sequence: 2, to: 'approved', decisionId },
          ],
        },
      ]);
      expect(rolledBackApprovals[0]?.consumeId).toBeUndefined();
      expect(rolledBackApprovals[0]?.consumedAt).toBeUndefined();
      expect(rolledBackExecutions).toMatchObject([
        {
          status: 'awaiting_approval',
          attemptCount: 0,
          attempts: [],
        },
      ]);
      expect(
        rolledBackCheckpoints.map((checkpoint) => checkpoint.kind),
      ).toEqual(['input_accepted', 'approval_waiting']);
      expect(rolledBackEvents.events).toHaveLength(0);
      expect(
        rolledBackOutbox.messages.filter(
          (message) => message.event.taskId === query.taskId,
        ),
      ).toHaveLength(0);

      const committed = await store.commitTask(validCommand);
      await expect(store.commitTask(validCommand)).resolves.toEqual(committed);
      const [task, approvals, executions, checkpoints, events, outbox] =
        await Promise.all([
          store.getTask(query),
          store.readApprovals(query),
          store.readToolExecutions(query),
          store.readCheckpoints(query),
          store.readEvents({ ...query, afterSequence: 0, limit: 100 }),
          store.claimOutbox({
            workerId: `approval-commit-worker-${suffix}`,
            limit: 10_000,
            now: '2026-08-01T00:00:06.000Z',
            leaseExpiresAt: '2026-08-01T00:01:06.000Z',
          }),
        ]);

      expect(task).toMatchObject({
        status: 'running',
        version: decided.version + 1,
        runs: [{ status: 'running' }],
      });
      expect(approvals).toMatchObject([
        {
          status: 'approved',
          rowVersion: 3,
          consumeId: `consume-id-${suffix}`,
          transitions: [
            { sequence: 1, to: 'pending' },
            { sequence: 2, to: 'approved', decisionId },
            {
              sequence: 3,
              to: 'approved',
              consumeId: `consume-id-${suffix}`,
            },
          ],
        },
      ]);
      expect(executions).toMatchObject([
        { status: 'prepared', attemptCount: 0, attempts: [] },
      ]);
      expect(checkpoints.map((checkpoint) => checkpoint.kind)).toEqual([
        'input_accepted',
        'approval_waiting',
        'approval_resolved',
      ]);
      expect(events.events).toHaveLength(1);
      expect(events.events[0]?.payload).toMatchObject({
        type: 'approval_decided',
        approvalId,
      });
      expect(
        outbox.messages.filter(
          (message) => message.event.taskId === query.taskId,
        ),
      ).toHaveLength(1);
    } finally {
      await store.dispose();
    }
  });

  it('persists every model and tool-result checkpoint in a two-Turn loop', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const store = createPostgresAgentRuntimeStore({ connectionString });
    const fixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'pg-tool-checkpoint',
          name: 'pg-checkpoint',
          rawArguments: '{}',
        }),
        fauxTextResponse('PostgreSQL checkpoint complete'),
      ],
    });
    const tool: AgentTool = {
      definition: {
        name: 'pg-checkpoint',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: {
        sideEffect: 'none',
        idempotency: 'none',
        timeoutMs: 30_000,
      },
      execute: async () => ({
        content: [{ type: 'text', text: 'PostgreSQL tool result' }],
      }),
    };
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: store,
      tools: [tool],
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-pg', projectId: 'project-pg' },
        input: 'persist every checkpoint',
      });
      await Promise.all([collect(handle.events), handle.result()]);
      const checkpoints = await store.readCheckpoints({
        tenantId: 'tenant-pg',
        projectId: 'project-pg',
        taskId: handle.taskId,
        runId: handle.runId,
      });

      expect(checkpoints.map((checkpoint) => checkpoint.kind)).toEqual([
        'input_accepted',
        'model_completed',
        'tool_result_appended',
        'model_completed',
        'run_terminal',
      ]);
      expect(checkpoints[2]?.transcript.at(-1)).toMatchObject({
        role: 'tool_result',
        toolCallId: 'pg-tool-checkpoint',
      });
    } finally {
      await harness.dispose();
      await store.dispose();
    }
  });

  it('keeps a PostgreSQL Task running after its live observer overflows', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const store = createPostgresAgentRuntimeStore({ connectionString });
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('replay after observer overflow')],
    });
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: store,
      eventBuffer: { maxEvents: 1 },
    });

    try {
      const handle = await harness.startTask({
        scope: { tenantId: 'tenant-pg', projectId: 'project-pg' },
        input: 'detach the PostgreSQL observer',
      });

      await expect(handle.result()).resolves.toMatchObject({
        status: 'completed',
        task: { status: 'completed' },
      });
      await expect(collect(handle.events)).rejects.toMatchObject({
        code: 'AGENT_OBSERVER_OVERFLOW',
      });
      await expect(
        harness.readEvents({
          tenantId: 'tenant-pg',
          projectId: 'project-pg',
          taskId: handle.taskId,
          runId: handle.runId,
        }),
      ).resolves.toMatchObject({
        hasMore: false,
        events: [
          { sequence: 1, payload: { type: 'run_start' } },
          { sequence: 2, payload: { type: 'turn_start' } },
          { sequence: 3, payload: { type: 'model_start' } },
          { sequence: 4, payload: { type: 'text_delta' } },
          { sequence: 5, payload: { type: 'model_end' } },
          { sequence: 6, payload: { type: 'turn_end' } },
          { sequence: 7, payload: { type: 'run_end' } },
        ],
      });
    } finally {
      await harness.dispose();
      await store.dispose();
    }
  });
});

async function collect<T>(events: AsyncIterable<T>): Promise<readonly T[]> {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

async function collectIterator<T>(
  iterator: AsyncIterator<T>,
): Promise<readonly T[]> {
  const collected: T[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) return collected;
    collected.push(next.value);
  }
}

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) throw new TypeError('AGENT_TEST_POSTGRES_URL is required');
  return value;
}

function requireTaskId(value: string | undefined): string {
  if (!value) throw new TypeError('Task ID was not assigned');
  return value;
}

function requireRunId(value: string | undefined): string {
  if (!value) throw new TypeError('Run ID was not assigned');
  return value;
}

function createAmbiguousCommitPool(pool: Pool): {
  readonly pool: Pool;
  arm(): void;
} {
  let armed = false;
  return {
    pool: new Proxy(pool, {
      get(target, property) {
        if (property === 'connect')
          return async (): Promise<PoolClient> => {
            const client = await target.connect();
            return new Proxy(client, {
              get(clientTarget, clientProperty) {
                if (clientProperty === 'query')
                  return async (...args: unknown[]): Promise<unknown> => {
                    const result = await Reflect.apply(
                      clientTarget.query,
                      clientTarget,
                      args,
                    );
                    const input = args[0];
                    const text =
                      typeof input === 'string'
                        ? input
                        : typeof input === 'object' &&
                            input !== null &&
                            'text' in input &&
                            typeof input.text === 'string'
                          ? input.text
                          : '';
                    if (armed && text.trim().toUpperCase() === 'COMMIT') {
                      armed = false;
                      throw new Error(
                        'simulated connection loss after PostgreSQL COMMIT',
                      );
                    }
                    return result;
                  };
                const value = Reflect.get(
                  clientTarget,
                  clientProperty,
                  clientTarget,
                );
                return typeof value === 'function'
                  ? value.bind(clientTarget)
                  : value;
              },
            });
          };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
    arm() {
      armed = true;
    },
  };
}
