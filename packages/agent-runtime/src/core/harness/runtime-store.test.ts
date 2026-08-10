import { describe, expect, it } from 'vitest';

import { createInMemoryAgentRuntimeStore } from '../index.js';

describe('AgentRuntimeStore commit protocol', () => {
  it('reconciles decision replay and rejects mismatched or competing decisions', async () => {
    const fixture = await createPendingApprovalStore('decision-race');
    const { store, query, waiting } = fixture;

    try {
      await expect(
        store.decideApproval({
          ...query,
          approvalId: fixture.approvalId,
          commitId: 'commit-decision-oversized',
          decisionId: '决'.repeat(100),
          decision: 'approved',
          decidedBy: 'user-1',
          now: '2026-08-01T00:00:03.000Z',
        }),
      ).rejects.toThrow('Agent Approval decision is invalid');

      const command = {
        ...query,
        approvalId: fixture.approvalId,
        commitId: 'commit-decision-first',
        decisionId: 'decision-idempotent-1',
        decision: 'approved' as const,
        decidedBy: 'user-1',
        reasonCode: 'HUMAN_APPROVED',
        now: '2026-08-01T00:00:03.000Z',
      };
      const first = await store.decideApproval(command);
      const replay = await store.decideApproval({
        ...command,
        commitId: 'commit-decision-replay',
        now: '2026-08-01T00:00:04.000Z',
      });

      expect(first.version).toBe(waiting.version + 1);
      expect(replay).toEqual(first);
      await expect(
        store.decideApproval({
          ...command,
          commitId: 'commit-decision-mismatch',
          decidedBy: 'user-2',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_APPROVAL_DECISION_MISMATCH' });
      await expect(
        store.decideApproval({
          ...command,
          commitId: 'commit-decision-competing',
          decisionId: 'decision-competing-2',
          decision: 'denied',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_APPROVAL_ALREADY_DECIDED' });

      const consumeCommand = {
        ...query,
        commitId: 'commit-consume-first',
        expectedVersion: first.version,
        mutations: [{ type: 'approval_wait_resumed' as const }],
        toolExecutions: [
          {
            type: 'tool_execution_prepared' as const,
            toolExecutionId: fixture.toolExecutionId,
            sideEffect: 'external' as const,
            idempotency: 'none' as const,
            timeoutMs: 30_000,
            deadline: '2026-08-01T00:00:35.000Z',
          },
        ],
        approvals: [
          {
            type: 'approval_consumed' as const,
            approvalId: fixture.approvalId,
            toolExecutionId: fixture.toolExecutionId,
            decisionId: command.decisionId,
            consumeId: 'consume-idempotent-1',
          },
        ],
        now: '2026-08-01T00:00:05.000Z',
      };
      const consumed = await store.commitTask(consumeCommand);
      await expect(store.commitTask(consumeCommand)).resolves.toEqual(consumed);
      await expect(
        store.decideApproval({
          ...command,
          commitId: 'commit-decision-after-consumption',
          now: '2026-08-01T00:00:06.000Z',
        }),
      ).resolves.toEqual(first);
      await expect(
        store.commitTask({
          ...consumeCommand,
          commitId: 'commit-consume-competing',
          expectedVersion: consumed.version,
          mutations: [],
          toolExecutions: [],
          approvals: consumeCommand.approvals.map((approval) => ({
            ...approval,
            consumeId: 'consume-competing-2',
          })),
        }),
      ).rejects.toThrow('Agent Approval cannot be consumed');
      await expect(store.readApprovals(query)).resolves.toMatchObject([
        {
          status: 'approved',
          consumeId: 'consume-idempotent-1',
          transitions: [
            { sequence: 1, to: 'pending' },
            { sequence: 2, to: 'approved' },
            { sequence: 3, to: 'approved', consumeId: 'consume-idempotent-1' },
          ],
        },
      ]);
    } finally {
      await store.dispose();
    }
  });

  it('keeps decision and expiry races first-writer-wins', async () => {
    const decisionRace = await createPendingApprovalStore('decision-first');
    const approveFirst = await createPendingApprovalStore('approve-first');
    const expireFirst = await createPendingApprovalStore('expire-first');

    try {
      const competingDecisions = await Promise.allSettled([
        decisionRace.store.decideApproval({
          ...decisionRace.query,
          approvalId: decisionRace.approvalId,
          commitId: 'commit-decision-winner',
          decisionId: 'decision-winner',
          decision: 'approved',
          decidedBy: 'user-1',
          now: '2026-08-01T00:00:09.000Z',
        }),
        decisionRace.store.decideApproval({
          ...decisionRace.query,
          approvalId: decisionRace.approvalId,
          commitId: 'commit-decision-loser',
          decisionId: 'decision-loser',
          decision: 'denied',
          decidedBy: 'user-2',
          now: '2026-08-01T00:00:09.000Z',
        }),
      ]);
      expect(competingDecisions).toMatchObject([
        { status: 'fulfilled', value: { approval: { status: 'approved' } } },
        {
          status: 'rejected',
          reason: { code: 'AGENT_APPROVAL_ALREADY_DECIDED' },
        },
      ]);

      const approvedRace = await Promise.allSettled([
        approveFirst.store.decideApproval({
          ...approveFirst.query,
          approvalId: approveFirst.approvalId,
          commitId: 'commit-approve-first',
          decisionId: 'decision-approve-first',
          decision: 'approved',
          decidedBy: 'user-1',
          now: '2026-08-01T00:00:09.000Z',
        }),
        approveFirst.store.resolveApproval({
          ...approveFirst.query,
          approvalId: approveFirst.approvalId,
          commitId: 'commit-expire-second',
          resolution: 'expired',
          now: '2026-08-01T00:00:10.000Z',
        }),
      ]);
      expect(approvedRace).toMatchObject([
        { status: 'fulfilled', value: { approval: { status: 'approved' } } },
        { status: 'fulfilled', value: { approval: { status: 'approved' } } },
      ]);

      const expiredRace = await Promise.allSettled([
        expireFirst.store.resolveApproval({
          ...expireFirst.query,
          approvalId: expireFirst.approvalId,
          commitId: 'commit-expire-first',
          resolution: 'expired',
          now: '2026-08-01T00:00:10.000Z',
        }),
        expireFirst.store.decideApproval({
          ...expireFirst.query,
          approvalId: expireFirst.approvalId,
          commitId: 'commit-approve-second',
          decisionId: 'decision-approve-second',
          decision: 'approved',
          decidedBy: 'user-1',
          now: '2026-08-01T00:00:09.000Z',
        }),
      ]);
      expect(expiredRace[0]).toMatchObject({
        status: 'fulfilled',
        value: { approval: { status: 'expired' } },
      });
      expect(expiredRace[1]).toMatchObject({
        status: 'rejected',
        reason: { code: 'AGENT_APPROVAL_ALREADY_DECIDED' },
      });
      await expect(
        expireFirst.store.readApprovals(expireFirst.query),
      ).resolves.toMatchObject([
        {
          status: 'expired',
          transitions: [
            { sequence: 1, to: 'pending' },
            { sequence: 2, from: 'pending', to: 'expired' },
          ],
        },
      ]);
    } finally {
      await decisionRace.store.dispose();
      await approveFirst.store.dispose();
      await expireFirst.store.dispose();
    }
  });

  it('atomically commits one pending Approval before any tool Attempt', async () => {
    const store = createInMemoryAgentRuntimeStore();

    try {
      const scope = { tenantId: 'tenant-1', projectId: 'project-1' };
      const query = {
        ...scope,
        taskId: 'task-approval-pending',
        runId: 'run-approval-pending',
      };
      let receipt = await store.createTask({
        scope,
        taskId: query.taskId,
        runId: query.runId,
        commitId: 'commit-create-approval-pending',
        checkpoint: {
          kind: 'input_accepted',
          input: 'request approval',
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
        commitId: 'commit-propose-approval-pending',
        expectedVersion: receipt.version,
        mutations: [
          { type: 'run_started' },
          { type: 'turn_started', turnId: 'turn-approval-1', turnIndex: 1 },
        ],
        toolExecutions: [
          {
            type: 'tool_execution_proposed',
            toolExecutionId: 'tool-execution-approval-1',
            toolCallId: 'tool-call-approval-1',
            turnId: 'turn-approval-1',
            turnIndex: 1,
            proposalSequence: 1,
            toolName: 'publish-story',
            argumentsDigest: 'arguments-approval-sha256',
          },
        ],
        now: '2026-08-01T00:00:01.000Z',
      } as Parameters<typeof store.commitTask>[0]);
      const waitingCommand = {
        ...query,
        commitId: 'commit-wait-approval-pending',
        expectedVersion: receipt.version,
        mutations: [{ type: 'approval_wait_started' as const }],
        toolExecutions: [
          {
            type: 'tool_execution_awaiting_approval' as const,
            toolExecutionId: 'tool-execution-approval-1',
            sideEffect: 'external' as const,
            idempotency: 'keyed' as const,
            timeoutMs: 30_000,
          },
        ],
        approvals: [
          {
            type: 'approval_requested' as const,
            approvalId: 'approval-1',
            toolExecutionId: 'tool-execution-approval-1',
            turnId: 'turn-approval-1',
            proposalSequence: 1,
            policyId: 'story-publish-policy',
            policyVersion: 'v1',
            argumentsDigest: 'arguments-approval-sha256',
            expiresAt: '2026-08-01T01:00:00.000Z',
            presentation: {
              title: 'Publish story',
              fields: [{ label: 'Target', value: 'Production' }],
            },
          },
        ],
        checkpoint: {
          kind: 'approval_waiting' as const,
          transcript: [],
          turnIndex: 1,
          executionPosition: 'approval' as const,
          nextTurnIndex: 1,
          harnessProtocolVersion: 1,
          checkpointSchemaVersion: 1,
          configFingerprint: 'test-config',
        },
        events: [
          {
            eventId: 'event-approval-requested-1',
            ...query,
            turnId: 'turn-approval-1',
            turnIndex: 1,
            sequence: 1,
            occurredAt: '2026-08-01T00:00:02.000Z',
            payload: {
              type: 'approval_requested' as const,
              turn: 1,
              approvalId: 'approval-1',
              toolExecutionId: 'tool-execution-approval-1',
              policyId: 'story-publish-policy',
              policyVersion: 'v1',
              expiresAt: '2026-08-01T01:00:00.000Z',
              presentation: {
                title: 'Publish story',
                fields: [{ label: 'Target', value: 'Production' }],
              },
            },
          },
        ],
        now: '2026-08-01T00:00:02.000Z',
      };
      await expect(
        store.commitTask({
          ...waitingCommand,
          commitId: 'commit-invalid-approval-pending',
          approvals: waitingCommand.approvals.map((approval) => ({
            ...approval,
            argumentsDigest: 'mismatched-arguments-digest',
          })),
        }),
      ).rejects.toThrow('Agent Approval does not match ToolExecution');
      const [rolledBackTask, rolledBackExecutions, rolledBackApprovals] =
        await Promise.all([
          store.getTask(query),
          store.readToolExecutions(query),
          store.readApprovals(query),
        ]);
      expect(rolledBackTask).toMatchObject({
        status: 'running',
        runs: [{ status: 'running' }],
      });
      expect(rolledBackExecutions).toMatchObject([
        { status: 'proposed', attemptCount: 0 },
      ]);
      expect(rolledBackApprovals).toEqual([]);
      await expect(
        store.readEvents({ ...query, afterSequence: 0, limit: 100 }),
      ).resolves.toEqual({ events: [], hasMore: false });

      const waiting = await store.commitTask(waitingCommand);
      const [task, checkpoint, executions, approvals, events, outbox] =
        await Promise.all([
          store.getTask(query),
          store.getCheckpoint(query),
          store.readToolExecutions(query),
          store.readApprovals(query),
          store.readEvents({ ...query, afterSequence: 0, limit: 100 }),
          store.claimOutbox({
            workerId: 'approval-worker',
            limit: 100,
            now: '2026-08-01T00:00:03.000Z',
            leaseExpiresAt: '2026-08-01T00:01:03.000Z',
          }),
        ]);

      expect(waiting.task).toMatchObject({
        status: 'waiting_for_approval',
        runs: [{ status: 'waiting_for_approval' }],
      });
      expect(task).toEqual(waiting.task);
      expect(checkpoint).toMatchObject({
        kind: 'approval_waiting',
        executionPosition: 'approval',
      });
      expect(executions).toMatchObject([
        {
          toolExecutionId: 'tool-execution-approval-1',
          status: 'awaiting_approval',
          attemptCount: 0,
          attempts: [],
          transitions: [
            { sequence: 1, to: 'proposed' },
            {
              sequence: 2,
              from: 'proposed',
              to: 'awaiting_approval',
              reasonCode: 'APPROVAL_REQUIRED',
            },
          ],
        },
      ]);
      expect(approvals).toMatchObject([
        {
          approvalId: 'approval-1',
          toolExecutionId: 'tool-execution-approval-1',
          status: 'pending',
          policyId: 'story-publish-policy',
          policyVersion: 'v1',
          argumentsDigest: 'arguments-approval-sha256',
          requestedAt: '2026-08-01T00:00:02.000Z',
          expiresAt: '2026-08-01T01:00:00.000Z',
          transitions: [{ sequence: 1, to: 'pending' }],
        },
      ]);
      expect(events.events).toHaveLength(1);
      expect(events.events[0]?.payload.type).toBe('approval_requested');
      expect(outbox.messages).toMatchObject([
        { event: { payload: { type: 'approval_requested' } } },
      ]);

      await expect(store.commitTask(waitingCommand)).resolves.toEqual(waiting);
      const decision = await store.decideApproval({
        ...query,
        approvalId: 'approval-1',
        commitId: 'commit-decide-approval-1',
        decisionId: 'decision-approval-1',
        decision: 'approved',
        decidedBy: 'user-1',
        reasonCode: 'HUMAN_APPROVED',
        now: '2026-08-01T00:00:04.000Z',
      });
      expect(decision).toMatchObject({
        version: waiting.version + 1,
        approval: {
          status: 'approved',
          decisionId: 'decision-approval-1',
          decision: 'approved',
          decidedBy: 'user-1',
        },
      });
      await expect(store.getTask(query)).resolves.toMatchObject({
        status: 'waiting_for_approval',
        runs: [{ status: 'waiting_for_approval' }],
      });
      await expect(
        store.readEvents({ ...query, afterSequence: 0, limit: 100 }),
      ).resolves.toMatchObject({
        events: [{ payload: { type: 'approval_requested' } }],
      });
    } finally {
      await store.dispose();
    }
  });

  it('commits one successful tool execution lifecycle with one attempt', async () => {
    const store = createInMemoryAgentRuntimeStore();

    try {
      const scope = { tenantId: 'tenant-1', projectId: 'project-1' };
      const query = {
        ...scope,
        taskId: 'task-tool-success',
        runId: 'run-tool-success',
      };
      let receipt = await store.createTask({
        scope,
        taskId: query.taskId,
        runId: query.runId,
        commitId: 'commit-create-tool-success',
        checkpoint: {
          kind: 'input_accepted',
          input: 'lookup',
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
        commitId: 'commit-propose-tool-success',
        expectedVersion: receipt.version,
        mutations: [
          { type: 'run_started' },
          { type: 'turn_started', turnId: 'turn-1', turnIndex: 1 },
        ],
        toolExecutions: [
          {
            type: 'tool_execution_proposed',
            toolExecutionId: 'tool-execution-1',
            toolCallId: 'tool-call-1',
            turnId: 'turn-1',
            turnIndex: 1,
            proposalSequence: 1,
            toolName: 'lookup',
            argumentsDigest: 'arguments-sha256',
          },
        ],
        now: '2026-08-01T00:00:01.000Z',
      } as Parameters<typeof store.commitTask>[0]);
      receipt = await store.commitTask({
        ...query,
        commitId: 'commit-prepare-tool-success',
        expectedVersion: receipt.version,
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_prepared',
            toolExecutionId: 'tool-execution-1',
            sideEffect: 'none',
            idempotency: 'keyed',
            timeoutMs: 30_000,
            idempotencyKey: 'opaque-key-1',
            deadline: '2026-08-01T00:00:31.000Z',
          },
        ],
        now: '2026-08-01T00:00:02.000Z',
      } as Parameters<typeof store.commitTask>[0]);
      receipt = await store.commitTask({
        ...query,
        commitId: 'commit-run-tool-success',
        expectedVersion: receipt.version,
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_started',
            toolExecutionId: 'tool-execution-1',
            attemptId: 'tool-attempt-1',
            attempt: 1,
          },
        ],
        now: '2026-08-01T00:00:03.000Z',
      } as Parameters<typeof store.commitTask>[0]);
      await store.commitTask({
        ...query,
        commitId: 'commit-finish-tool-success',
        expectedVersion: receipt.version,
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_finished',
            toolExecutionId: 'tool-execution-1',
            attemptId: 'tool-attempt-1',
            status: 'succeeded',
            effectOutcome: 'not_applied',
            retryable: false,
            resultDigest: 'result-sha256',
          },
        ],
        now: '2026-08-01T00:00:04.000Z',
      } as Parameters<typeof store.commitTask>[0]);

      await expect(store.readToolExecutions(query)).resolves.toMatchObject([
        {
          toolExecutionId: 'tool-execution-1',
          status: 'succeeded',
          effectOutcome: 'not_applied',
          attemptCount: 1,
          idempotencyKey: 'opaque-key-1',
          attempts: [
            {
              attemptId: 'tool-attempt-1',
              attempt: 1,
              status: 'succeeded',
            },
          ],
          transitions: [
            { sequence: 1, to: 'proposed' },
            { sequence: 2, from: 'proposed', to: 'prepared' },
            { sequence: 3, from: 'prepared', to: 'running' },
            { sequence: 4, from: 'running', to: 'succeeded' },
          ],
        },
      ]);
    } finally {
      await store.dispose();
    }
  });

  it('refreshes a prepared tool execution behind the current fence without changing its identity', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const query = {
      tenantId: 'tenant-tool-recovery',
      projectId: 'project-tool-recovery',
      taskId: 'task-tool-recovery',
      runId: 'run-tool-recovery',
    };

    try {
      let receipt = await store.createTask({
        scope: query,
        taskId: query.taskId,
        runId: query.runId,
        commitId: 'commit-create-tool-recovery',
        checkpoint: {
          kind: 'input_accepted',
          input: 'recover the prepared tool',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          resumeState: { kind: 'model', nextTurnIndex: 1 },
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 3,
          configFingerprint: 'tool-recovery-config',
        },
        initialLease: {
          ownershipId: 'ownership-tool-recovery-a',
          ownerId: 'worker-tool-recovery-a',
          leaseExpiresAt: '2026-08-01T00:00:31.000Z',
        },
        now: '2026-08-01T00:00:00.000Z',
      });
      const firstLease = receipt.lease!;
      receipt = await store.commitTask({
        ...query,
        commitId: 'commit-propose-tool-recovery',
        expectedVersion: receipt.version,
        mutations: [
          { type: 'run_started' },
          { type: 'turn_started', turnId: 'turn-tool-recovery', turnIndex: 1 },
        ],
        toolExecutions: [
          {
            type: 'tool_execution_proposed',
            toolExecutionId: 'tool-execution-stable',
            toolCallId: 'tool-call-stable',
            turnId: 'turn-tool-recovery',
            turnIndex: 1,
            proposalSequence: 1,
            toolName: 'stable-tool',
            argumentsDigest: 'stable-arguments-digest',
          },
        ],
        lease: firstLease,
        now: '2026-08-01T00:00:01.000Z',
      });
      receipt = await store.commitTask({
        ...query,
        commitId: 'commit-prepare-tool-recovery',
        expectedVersion: receipt.version,
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_prepared',
            toolExecutionId: 'tool-execution-stable',
            sideEffect: 'external',
            idempotency: 'keyed',
            timeoutMs: 30_000,
            idempotencyKey: 'stable-idempotency-key',
            deadline: '2026-08-01T00:00:32.000Z',
          },
        ],
        lease: firstLease,
        now: '2026-08-01T00:00:02.000Z',
      });

      const secondLease = (
        await store.claimRecoverableRuns({
          claimId: 'claim-tool-recovery-b',
          ownerId: 'worker-tool-recovery-b',
          configFingerprint: 'tool-recovery-config',
          limit: 1,
          now: '2026-08-01T00:00:31.000Z',
          leaseExpiresAt: '2026-08-01T00:01:01.000Z',
        })
      ).leases[0]!;

      const refresh = {
        ...query,
        commitId: 'commit-refresh-tool-recovery',
        expectedVersion: receipt.version,
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_reprepared' as const,
            toolExecutionId: 'tool-execution-stable',
            deadline: '2026-08-01T00:01:02.000Z',
            reasonCode: 'RECOVERY_RESUME' as const,
          },
        ],
        now: '2026-08-01T00:00:32.000Z',
      };
      await expect(
        store.commitTask({ ...refresh, lease: firstLease }),
      ).rejects.toMatchObject({ code: 'AGENT_RUN_LEASE_LOST' });

      receipt = await store.commitTask({ ...refresh, lease: secondLease });
      await store.commitTask({
        ...query,
        commitId: 'commit-start-refreshed-tool-recovery',
        expectedVersion: receipt.version,
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_started',
            toolExecutionId: 'tool-execution-stable',
            attemptId: 'tool-attempt-after-recovery',
            attempt: 1,
          },
        ],
        lease: secondLease,
        now: '2026-08-01T00:00:33.000Z',
      });

      await expect(store.readToolExecutions(query)).resolves.toMatchObject([
        {
          toolExecutionId: 'tool-execution-stable',
          toolCallId: 'tool-call-stable',
          idempotencyKey: 'stable-idempotency-key',
          deadline: '2026-08-01T00:01:02.000Z',
          preparedAt: '2026-08-01T00:00:32.000Z',
          status: 'running',
          attemptCount: 1,
          transitions: [
            { sequence: 1, to: 'proposed' },
            { sequence: 2, from: 'proposed', to: 'prepared' },
            {
              sequence: 3,
              from: 'prepared',
              to: 'prepared',
              reasonCode: 'RECOVERY_RESUME',
            },
            {
              sequence: 4,
              from: 'prepared',
              to: 'running',
              attemptId: 'tool-attempt-after-recovery',
            },
          ],
        },
      ]);
    } finally {
      await store.dispose();
    }
  });

  it('reconciles an Attempt commit and rolls back an invalid terminal commit', async () => {
    const store = createInMemoryAgentRuntimeStore();

    try {
      const scope = { tenantId: 'tenant-1', projectId: 'project-1' };
      const query = {
        ...scope,
        taskId: 'task-tool-atomic',
        runId: 'run-tool-atomic',
      };
      let receipt = await store.createTask({
        scope,
        taskId: query.taskId,
        runId: query.runId,
        commitId: 'commit-create-tool-atomic',
        checkpoint: {
          kind: 'input_accepted',
          input: 'atomic tool',
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
        commitId: 'commit-propose-tool-atomic',
        expectedVersion: receipt.version,
        mutations: [
          { type: 'run_started' },
          { type: 'turn_started', turnId: 'turn-atomic', turnIndex: 1 },
        ],
        toolExecutions: [
          {
            type: 'tool_execution_proposed',
            toolExecutionId: 'tool-execution-atomic',
            toolCallId: 'tool-call-atomic',
            turnId: 'turn-atomic',
            turnIndex: 1,
            proposalSequence: 1,
            toolName: 'atomic-tool',
            argumentsDigest: 'atomic-arguments',
          },
        ],
        now: '2026-08-01T00:00:01.000Z',
      });
      receipt = await store.commitTask({
        ...query,
        commitId: 'commit-prepare-tool-atomic',
        expectedVersion: receipt.version,
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_prepared',
            toolExecutionId: 'tool-execution-atomic',
            sideEffect: 'external',
            idempotency: 'keyed',
            timeoutMs: 30_000,
            idempotencyKey: 'atomic-key',
            deadline: '2026-08-01T00:00:31.000Z',
          },
        ],
        now: '2026-08-01T00:00:02.000Z',
      });
      const startedCommand = {
        ...query,
        commitId: 'commit-start-tool-atomic',
        expectedVersion: receipt.version,
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_started' as const,
            toolExecutionId: 'tool-execution-atomic',
            attemptId: 'tool-attempt-atomic',
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
          commitId: 'commit-invalid-terminal-atomic',
          expectedVersion: started.version,
          mutations: [],
          toolExecutions: [
            {
              type: 'tool_execution_finished',
              toolExecutionId: 'tool-execution-atomic',
              attemptId: 'wrong-attempt',
              status: 'succeeded',
              effectOutcome: 'applied',
              retryable: false,
            },
          ],
          events: [
            {
              eventId: 'event-invalid-terminal',
              ...query,
              turnId: 'turn-atomic',
              turnIndex: 1,
              sequence: 1,
              occurredAt: '2026-08-01T00:00:04.000Z',
              payload: {
                type: 'tool_execution_end',
                toolCallId: 'tool-call-atomic',
                result: {
                  role: 'tool_result',
                  toolCallId: 'tool-call-atomic',
                  toolName: 'atomic-tool',
                  isError: false,
                  content: [],
                },
              },
            },
          ],
          now: '2026-08-01T00:00:04.000Z',
        }),
      ).rejects.toThrow('Active Agent tool execution attempt not found');

      const [executions, events, outbox] = await Promise.all([
        store.readToolExecutions(query),
        store.readEvents({ ...query, afterSequence: 0, limit: 100 }),
        store.claimOutbox({
          workerId: 'atomic-worker',
          limit: 100,
          now: '2026-08-01T00:01:00.000Z',
          leaseExpiresAt: '2026-08-01T00:02:00.000Z',
        }),
      ]);
      expect(executions).toMatchObject([
        {
          status: 'running',
          attemptCount: 1,
          attempts: [{ attemptId: 'tool-attempt-atomic', status: 'running' }],
          transitions: [
            { sequence: 1, to: 'proposed' },
            { sequence: 2, to: 'prepared' },
            { sequence: 3, to: 'running' },
          ],
        },
      ]);
      expect(events.events).toHaveLength(0);
      expect(outbox.messages).toHaveLength(0);
    } finally {
      await store.dispose();
    }
  });

  it('returns the original receipt when the same commitId is retried', async () => {
    const store = createInMemoryAgentRuntimeStore();

    try {
      const created = await store.createTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        taskId: 'task-1',
        runId: 'run-1',
        commitId: 'commit-create',
        checkpoint: {
          kind: 'input_accepted',
          input: 'hello',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          harnessProtocolVersion: 1,
          checkpointSchemaVersion: 1,
          configFingerprint: 'test-config',
        },
        now: '2026-08-01T00:00:00.000Z',
      });
      const command = {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runId: 'run-1',
        commitId: 'commit-start',
        expectedVersion: created.version,
        mutations: [{ type: 'run_started' as const }],
        now: '2026-08-01T00:00:01.000Z',
      };

      const first = await store.commitTask(command);
      const retried = await store.commitTask(command);

      expect(retried).toEqual(first);
      await expect(
        store.getTask({
          tenantId: 'tenant-1',
          projectId: 'project-1',
          taskId: 'task-1',
        }),
      ).resolves.toMatchObject({ version: 2, status: 'running' });
    } finally {
      await store.dispose();
    }
  });

  it('rejects reuse of a commitId with different content', async () => {
    const store = createInMemoryAgentRuntimeStore();

    try {
      const created = await store.createTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        taskId: 'task-mismatch',
        runId: 'run-mismatch',
        commitId: 'commit-create-mismatch',
        checkpoint: {
          kind: 'input_accepted',
          input: 'hello',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          harnessProtocolVersion: 1,
          checkpointSchemaVersion: 1,
          configFingerprint: 'test-config',
        },
        now: '2026-08-01T00:00:00.000Z',
      });
      const command = {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: 'task-mismatch',
        runId: 'run-mismatch',
        commitId: 'commit-mismatch',
        expectedVersion: created.version,
        mutations: [{ type: 'run_started' as const }],
        now: '2026-08-01T00:00:01.000Z',
      };
      await store.commitTask(command);

      await expect(
        store.commitTask({
          ...command,
          now: '2026-08-01T00:00:02.000Z',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_COMMIT_MISMATCH' });
    } finally {
      await store.dispose();
    }
  });

  it('allows only one different commit to advance an expected version', async () => {
    const store = createInMemoryAgentRuntimeStore();

    try {
      const created = await store.createTask({
        scope: { tenantId: 'tenant-1', projectId: 'project-1' },
        taskId: 'task-concurrent',
        runId: 'run-concurrent',
        commitId: 'commit-create-concurrent',
        checkpoint: {
          kind: 'input_accepted',
          input: 'hello',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          harnessProtocolVersion: 1,
          checkpointSchemaVersion: 1,
          configFingerprint: 'test-config',
        },
        now: '2026-08-01T00:00:00.000Z',
      });
      const baseCommand = {
        tenantId: 'tenant-1',
        projectId: 'project-1',
        taskId: 'task-concurrent',
        runId: 'run-concurrent',
        expectedVersion: created.version,
        mutations: [{ type: 'run_started' as const }],
        now: '2026-08-01T00:00:01.000Z',
      };
      const outcomes = await Promise.allSettled([
        store.commitTask({ ...baseCommand, commitId: 'commit-concurrent-a' }),
        store.commitTask({ ...baseCommand, commitId: 'commit-concurrent-b' }),
      ]);

      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome.status === 'rejected'),
      ).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({ code: 'AGENT_STATE_CONFLICT' }),
        }),
      ]);
    } finally {
      await store.dispose();
    }
  });
});

describe('AgentRuntimeStore Run lease protocol', () => {
  it('reads one immutable fenced recovery snapshot for the current owner', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const query = {
      tenantId: 'tenant-recovery-snapshot',
      projectId: 'project-recovery-snapshot',
      taskId: 'task-recovery-snapshot',
      runId: 'run-recovery-snapshot',
    };

    try {
      const created = await store.createTask({
        scope: query,
        taskId: query.taskId,
        runId: query.runId,
        commitId: 'commit-create-recovery-snapshot',
        checkpoint: {
          kind: 'input_accepted',
          input: 'recover atomically',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          resumeState: { kind: 'model', nextTurnIndex: 1 },
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 3,
          configFingerprint: 'recovery-snapshot-config',
        },
        initialLease: {
          ownershipId: 'ownership-recovery-snapshot',
          ownerId: 'worker-recovery-snapshot',
          leaseExpiresAt: '2026-08-01T00:01:00.000Z',
        },
        now: '2026-08-01T00:00:00.000Z',
      });
      const lease = created.lease!;
      const command = {
        ...query,
        ownerId: lease.ownerId,
        leaseToken: lease.leaseToken,
        fencingToken: lease.fencingToken,
        now: '2026-08-01T00:00:01.000Z',
      };

      const snapshot = await store.readRecoverySnapshot(command);

      expect(snapshot).toMatchObject({
        ...query,
        lastEventSequence: 0,
        checkpoint: {
          checkpointSchemaVersion: 3,
          resumeState: { kind: 'model', nextTurnIndex: 1 },
        },
        lease: {
          ownerId: lease.ownerId,
          fencingToken: lease.fencingToken,
          leaseExpiresAt: lease.leaseExpiresAt,
        },
      });
      expect(snapshot.lease).not.toHaveProperty('leaseToken');
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.task)).toBe(true);
      expect(Object.isFrozen(snapshot.checkpoint.resumeState)).toBe(true);
      await expect(store.readRecoverySnapshot(command)).resolves.toEqual(
        snapshot,
      );
      await expect(
        store.readRecoverySnapshot({
          ...command,
          now: lease.leaseExpiresAt,
        }),
      ).rejects.toMatchObject({ code: 'AGENT_RUN_LEASE_LOST' });
      await expect(
        store.readRecoverySnapshot({
          ...command,
          projectId: 'foreign-project',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_RUN_LEASE_LOST' });
    } finally {
      await store.dispose();
    }
  });

  it('claims, renews, releases, and reclaims a Run with a higher fence', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const query = {
      tenantId: 'tenant-lease',
      projectId: 'project-lease',
      taskId: 'task-lease-lifecycle',
      runId: 'run-lease-lifecycle',
    };

    try {
      const created = await store.createTask({
        scope: query,
        taskId: query.taskId,
        runId: query.runId,
        commitId: 'commit-create-lease-lifecycle',
        checkpoint: {
          kind: 'input_accepted',
          input: 'resume me',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 2,
          configFingerprint: 'lease-config',
        },
        now: '2026-08-01T00:00:00.000Z',
      });

      const firstClaim = await store.claimRecoverableRuns({
        claimId: 'claim-worker-a-1',
        ownerId: 'worker-a',
        configFingerprint: 'lease-config',
        limit: 1,
        now: '2026-08-01T00:00:01.000Z',
        leaseExpiresAt: '2026-08-01T00:00:31.000Z',
      });
      const firstLease = firstClaim.leases[0]!;
      expect(firstClaim.leases).toHaveLength(1);
      expect(firstLease).toMatchObject({
        ...query,
        ownerId: 'worker-a',
        fencingToken: 1,
        claimedAt: '2026-08-01T00:00:01.000Z',
        leaseExpiresAt: '2026-08-01T00:00:31.000Z',
      });
      expect(firstLease.leaseToken).toEqual(expect.any(String));
      await expect(store.getTask(query)).resolves.toMatchObject({
        version: created.version,
      });

      const renewed = await store.renewRunLease({
        ...query,
        renewalId: 'renew-worker-a-1',
        ownerId: firstLease.ownerId,
        leaseToken: firstLease.leaseToken,
        fencingToken: firstLease.fencingToken,
        now: '2026-08-01T00:00:10.000Z',
        leaseExpiresAt: '2026-08-01T00:00:40.000Z',
      });
      expect(renewed).toMatchObject({
        ...firstLease,
        leaseExpiresAt: '2026-08-01T00:00:40.000Z',
      });
      await expect(store.getTask(query)).resolves.toMatchObject({
        version: created.version,
      });

      await expect(
        store.claimRecoverableRuns({
          claimId: 'claim-worker-b-too-early',
          ownerId: 'worker-b',
          configFingerprint: 'lease-config',
          limit: 1,
          now: '2026-08-01T00:00:11.000Z',
          leaseExpiresAt: '2026-08-01T00:00:41.000Z',
        }),
      ).resolves.toEqual({ leases: [] });

      await store.releaseRunLease({
        ...query,
        releaseId: 'release-worker-a-1',
        ownerId: renewed.ownerId,
        leaseToken: renewed.leaseToken,
        fencingToken: renewed.fencingToken,
        now: '2026-08-01T00:00:12.000Z',
        availableAt: '2026-08-01T00:00:20.000Z',
      });
      await expect(
        store.claimRecoverableRuns({
          claimId: 'claim-worker-b-before-availability',
          ownerId: 'worker-b',
          configFingerprint: 'lease-config',
          limit: 1,
          now: '2026-08-01T00:00:19.999Z',
          leaseExpiresAt: '2026-08-01T00:00:49.999Z',
        }),
      ).resolves.toEqual({ leases: [] });

      const reclaimed = await store.claimRecoverableRuns({
        claimId: 'claim-worker-b-1',
        ownerId: 'worker-b',
        configFingerprint: 'lease-config',
        limit: 1,
        now: '2026-08-01T00:00:20.000Z',
        leaseExpiresAt: '2026-08-01T00:00:50.000Z',
      });
      expect(reclaimed.leases).toHaveLength(1);
      expect(reclaimed.leases[0]).toMatchObject({
        ...query,
        ownerId: 'worker-b',
        fencingToken: 2,
      });
      expect(reclaimed.leases[0]?.leaseToken).not.toBe(firstLease.leaseToken);
    } finally {
      await store.dispose();
    }
  });

  it('fences stale and missing owners before any runtime state becomes visible', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const query = {
      tenantId: 'tenant-lease',
      projectId: 'project-lease',
      taskId: 'task-lease-fencing',
      runId: 'run-lease-fencing',
    };

    try {
      const created = await store.createTask({
        scope: query,
        taskId: query.taskId,
        runId: query.runId,
        commitId: 'commit-create-lease-fencing',
        checkpoint: {
          kind: 'input_accepted',
          input: 'fence me',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 2,
          configFingerprint: 'lease-config',
        },
        now: '2026-08-01T00:00:00.000Z',
      });
      const firstLease = (
        await store.claimRecoverableRuns({
          claimId: 'claim-fencing-a',
          ownerId: 'worker-a',
          configFingerprint: 'lease-config',
          limit: 1,
          now: '2026-08-01T00:00:01.000Z',
          leaseExpiresAt: '2026-08-01T00:00:31.000Z',
        })
      ).leases[0]!;
      const startCommand = {
        ...query,
        commitId: 'commit-fencing-start',
        expectedVersion: created.version,
        mutations: [{ type: 'run_started' as const }],
        lease: {
          leaseToken: firstLease.leaseToken,
          fencingToken: firstLease.fencingToken,
        },
        now: '2026-08-01T00:00:02.000Z',
      };
      const started = await store.commitTask(startCommand);

      await expect(
        store.commitTask({
          ...query,
          commitId: 'commit-fencing-expired-owner',
          expectedVersion: started.version,
          mutations: [
            {
              type: 'turn_started',
              turnId: 'turn-must-not-exist',
              turnIndex: 1,
            },
          ],
          checkpoint: {
            kind: 'model_completed',
            transcript: [],
            turnIndex: 1,
            executionPosition: 'tool',
            harnessProtocolVersion: 2,
            checkpointSchemaVersion: 2,
            configFingerprint: 'lease-config',
          },
          lease: startCommand.lease,
          now: '2026-08-01T00:00:31.000Z',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_RUN_LEASE_LOST' });

      const secondLease = (
        await store.claimRecoverableRuns({
          claimId: 'claim-fencing-b',
          ownerId: 'worker-b',
          configFingerprint: 'lease-config',
          limit: 1,
          now: '2026-08-01T00:00:31.000Z',
          leaseExpiresAt: '2026-08-01T00:01:01.000Z',
        })
      ).leases[0]!;
      expect(secondLease.fencingToken).toBe(2);

      await expect(store.commitTask(startCommand)).resolves.toEqual(started);
      for (const lease of [undefined, startCommand.lease]) {
        await expect(
          store.commitTask({
            ...query,
            commitId: `commit-fencing-rejected-${lease ? 'stale' : 'missing'}`,
            expectedVersion: started.version,
            mutations: [
              {
                type: 'turn_started',
                turnId: 'turn-must-not-exist',
                turnIndex: 1,
              },
            ],
            checkpoint: {
              kind: 'model_completed',
              transcript: [],
              turnIndex: 1,
              executionPosition: 'tool',
              harnessProtocolVersion: 2,
              checkpointSchemaVersion: 2,
              configFingerprint: 'lease-config',
            },
            lease,
            now: '2026-08-01T00:00:32.000Z',
          }),
        ).rejects.toMatchObject({ code: 'AGENT_RUN_LEASE_LOST' });
      }

      await expect(store.getTask(query)).resolves.toMatchObject({
        version: started.version,
        runs: [{ turns: [] }],
      });
      await expect(store.readCheckpoints(query)).resolves.toHaveLength(1);

      await expect(
        store.commitTask({
          ...query,
          commitId: 'commit-fencing-current-owner',
          expectedVersion: started.version,
          mutations: [
            { type: 'turn_started', turnId: 'turn-current', turnIndex: 1 },
          ],
          lease: {
            leaseToken: secondLease.leaseToken,
            fencingToken: secondLease.fencingToken,
          },
          now: '2026-08-01T00:00:33.000Z',
        }),
      ).resolves.toMatchObject({ version: started.version + 1 });
    } finally {
      await store.dispose();
    }
  });

  it('replays lease operations idempotently and records bounded recovery audit', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const query = {
      tenantId: 'tenant-lease',
      projectId: 'project-lease',
      taskId: 'task-lease-replay',
      runId: 'run-lease-replay',
    };

    try {
      await store.createTask({
        scope: query,
        taskId: query.taskId,
        runId: query.runId,
        commitId: 'commit-create-lease-replay',
        checkpoint: {
          kind: 'input_accepted',
          input: 'replay lease operations',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 2,
          configFingerprint: 'lease-config',
        },
        now: '2026-08-01T00:00:00.000Z',
      });
      const claimCommand = {
        claimId: 'claim-replay-a',
        ownerId: 'worker-a',
        configFingerprint: 'lease-config',
        limit: 1,
        now: '2026-08-01T00:00:01.000Z',
        leaseExpiresAt: '2026-08-01T00:00:31.000Z',
      };
      const claimed = await store.claimRecoverableRuns(claimCommand);
      await expect(store.claimRecoverableRuns(claimCommand)).resolves.toEqual(
        claimed,
      );
      await expect(
        store.claimRecoverableRuns({
          ...claimCommand,
          ownerId: 'worker-b',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_COMMIT_MISMATCH' });
      const lease = claimed.leases[0]!;

      const renewCommand = {
        ...query,
        renewalId: 'renew-replay-a',
        ownerId: lease.ownerId,
        leaseToken: lease.leaseToken,
        fencingToken: lease.fencingToken,
        now: '2026-08-01T00:00:10.000Z',
        leaseExpiresAt: '2026-08-01T00:00:40.000Z',
      };
      const renewed = await store.renewRunLease(renewCommand);
      await expect(store.renewRunLease(renewCommand)).resolves.toEqual(renewed);

      const releaseCommand = {
        ...query,
        releaseId: 'release-replay-a',
        ownerId: renewed.ownerId,
        leaseToken: renewed.leaseToken,
        fencingToken: renewed.fencingToken,
        now: '2026-08-01T00:00:11.000Z',
        availableAt: '2026-08-01T00:00:11.000Z',
      };
      await store.releaseRunLease(releaseCommand);
      await expect(
        store.releaseRunLease(releaseCommand),
      ).resolves.toBeUndefined();

      const reclaimed = await store.claimRecoverableRuns({
        claimId: 'claim-replay-b',
        ownerId: 'worker-b',
        configFingerprint: 'lease-config',
        limit: 1,
        now: '2026-08-01T00:00:12.000Z',
        leaseExpiresAt: '2026-08-01T00:00:42.000Z',
      });
      expect(reclaimed.leases[0]).toMatchObject({
        ownerId: 'worker-b',
        fencingToken: 2,
      });

      const audit = await store.readRunRecoveryAudit(query);
      expect(audit).toMatchObject([
        {
          sequence: 1,
          recoveryId: 'claim-replay-a',
          ownerId: 'worker-a',
          fencingToken: 1,
          action: 'initial_claim',
        },
        {
          sequence: 2,
          recoveryId: 'release-replay-a',
          ownerId: 'worker-a',
          fencingToken: 1,
          action: 'released',
        },
        {
          sequence: 3,
          recoveryId: 'claim-replay-b',
          ownerId: 'worker-b',
          fencingToken: 2,
          action: 'recovery_claim',
        },
      ]);
      expect(JSON.stringify(audit)).not.toContain(lease.leaseToken);
      await expect(
        store.readRunRecoveryAudit({
          ...query,
          tenantId: 'foreign-tenant',
        }),
      ).resolves.toEqual([]);
    } finally {
      await store.dispose();
    }
  });

  it('rejects a renewal that would shorten the current lease', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const query = {
      tenantId: 'tenant-lease',
      projectId: 'project-lease',
      taskId: 'task-lease-shortening',
      runId: 'run-lease-shortening',
    };

    try {
      await store.createTask({
        scope: query,
        taskId: query.taskId,
        runId: query.runId,
        commitId: 'commit-create-lease-shortening',
        checkpoint: {
          kind: 'input_accepted',
          input: 'do not shorten',
          transcript: [],
          executionPosition: 'model',
          nextTurnIndex: 1,
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 2,
          configFingerprint: 'lease-config',
        },
        now: '2026-08-01T00:00:00.000Z',
      });
      const lease = (
        await store.claimRecoverableRuns({
          claimId: 'claim-shortening-a',
          ownerId: 'worker-a',
          configFingerprint: 'lease-config',
          limit: 1,
          now: '2026-08-01T00:00:01.000Z',
          leaseExpiresAt: '2026-08-01T00:00:31.000Z',
        })
      ).leases[0]!;

      await expect(
        store.renewRunLease({
          ...query,
          renewalId: 'renew-shortening-a',
          ownerId: lease.ownerId,
          leaseToken: lease.leaseToken,
          fencingToken: lease.fencingToken,
          now: '2026-08-01T00:00:10.000Z',
          leaseExpiresAt: '2026-08-01T00:00:30.000Z',
        }),
      ).rejects.toThrow('Agent Run lease renewal must extend expiry');

      await expect(
        store.claimRecoverableRuns({
          claimId: 'claim-shortening-b-too-early',
          ownerId: 'worker-b',
          configFingerprint: 'lease-config',
          limit: 1,
          now: '2026-08-01T00:00:30.000Z',
          leaseExpiresAt: '2026-08-01T00:01:00.000Z',
        }),
      ).resolves.toEqual({ leases: [] });
    } finally {
      await store.dispose();
    }
  });

  it('fences executor-owned Approval resolution while leaving the decision port lease-free', async () => {
    const fixture = await createPendingApprovalStore('lease-resolution');
    const { store, query } = fixture;

    try {
      const lease = (
        await store.claimRecoverableRuns({
          claimId: 'claim-lease-resolution',
          ownerId: 'approval-worker',
          configFingerprint: 'test-config',
          limit: 1,
          now: '2026-08-01T00:00:03.000Z',
          leaseExpiresAt: '2026-08-01T00:00:33.000Z',
        })
      ).leases[0]!;
      const resolution = {
        ...query,
        approvalId: fixture.approvalId,
        commitId: 'commit-lease-resolution',
        resolution: 'cancelled' as const,
        now: '2026-08-01T00:00:04.000Z',
      };

      await expect(store.resolveApproval(resolution)).rejects.toMatchObject({
        code: 'AGENT_RUN_LEASE_LOST',
      });
      await expect(store.readApprovals(query)).resolves.toMatchObject([
        { status: 'pending' },
      ]);
      await expect(
        store.resolveApproval({
          ...resolution,
          lease: {
            leaseToken: lease.leaseToken,
            fencingToken: lease.fencingToken,
          },
        }),
      ).resolves.toMatchObject({ approval: { status: 'cancelled' } });
    } finally {
      await store.dispose();
    }
  });
});

async function createPendingApprovalStore(name: string) {
  const store = createInMemoryAgentRuntimeStore();
  const scope = { tenantId: 'tenant-1', projectId: 'project-1' };
  const query = {
    ...scope,
    taskId: `task-${name}`,
    runId: `run-${name}`,
  };
  const approvalId = `approval-${name}`;
  const toolExecutionId = `tool-execution-${name}`;
  let receipt = await store.createTask({
    scope,
    taskId: query.taskId,
    runId: query.runId,
    commitId: `commit-create-${name}`,
    checkpoint: {
      kind: 'input_accepted',
      input: 'approval race',
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
    commitId: `commit-propose-${name}`,
    expectedVersion: receipt.version,
    mutations: [
      { type: 'run_started' },
      { type: 'turn_started', turnId: `turn-${name}`, turnIndex: 1 },
    ],
    toolExecutions: [
      {
        type: 'tool_execution_proposed',
        toolExecutionId,
        toolCallId: `tool-call-${name}`,
        turnId: `turn-${name}`,
        turnIndex: 1,
        proposalSequence: 1,
        toolName: 'race-tool',
        argumentsDigest: `arguments-${name}`,
      },
    ],
    now: '2026-08-01T00:00:01.000Z',
  } as Parameters<typeof store.commitTask>[0]);
  const waiting = await store.commitTask({
    ...query,
    commitId: `commit-wait-${name}`,
    expectedVersion: receipt.version,
    mutations: [{ type: 'approval_wait_started' }],
    toolExecutions: [
      {
        type: 'tool_execution_awaiting_approval',
        toolExecutionId,
        sideEffect: 'external',
        idempotency: 'none',
        timeoutMs: 30_000,
      },
    ],
    approvals: [
      {
        type: 'approval_requested',
        approvalId,
        toolExecutionId,
        turnId: `turn-${name}`,
        proposalSequence: 1,
        policyId: 'race-policy',
        policyVersion: 'v1',
        argumentsDigest: `arguments-${name}`,
        expiresAt: '2026-08-01T00:00:10.000Z',
        presentation: { title: 'Race approval' },
      },
    ],
    now: '2026-08-01T00:00:02.000Z',
  } as Parameters<typeof store.commitTask>[0]);
  return { store, query, approvalId, toolExecutionId, waiting };
}
