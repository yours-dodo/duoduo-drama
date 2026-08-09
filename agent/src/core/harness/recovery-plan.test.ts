import { describe, expect, it } from 'vitest';

import {
  planAgentRunRecovery,
  type AgentApprovalSnapshot,
  type AgentRunRecoverySnapshot,
  type AgentToolExecutionSnapshot,
} from '../index.js';

describe('planAgentRunRecovery', () => {
  it('continues the exact model Turn named by a compatible v3 checkpoint', () => {
    const snapshot = modelRecoverySnapshot();

    expect(
      planAgentRunRecovery(snapshot, {
        harnessProtocolVersion: 2,
        checkpointSchemaVersion: 3,
        configFingerprint: 'recovery-config',
      }),
    ).toEqual({ kind: 'continue_model', nextTurnIndex: 2 });
  });

  it('conservatively adapts an unambiguous legacy v2 model checkpoint', () => {
    const snapshot = modelRecoverySnapshot();

    expect(
      planAgentRunRecovery(
        {
          ...snapshot,
          task: {
            ...snapshot.task,
            runs: [{ ...snapshot.task.runs[0]!, turns: [] }],
          },
          checkpoint: {
            ...snapshot.checkpoint,
            kind: 'input_accepted',
            turnIndex: undefined,
            nextTurnIndex: 1,
            checkpointSchemaVersion: 2,
            configFingerprint: 'legacy-v2-config',
            resumeState: undefined,
          },
        },
        {
          ...recoveryCompatibility(),
          legacyConfigFingerprints: { 2: 'legacy-v2-config' },
        },
      ),
    ).toEqual({ kind: 'continue_model', nextTurnIndex: 1 });
  });

  it('blocks a legacy terminal checkpoint that has no exact durable result', () => {
    const snapshot = modelRecoverySnapshot();

    expect(
      planAgentRunRecovery(
        {
          ...snapshot,
          checkpoint: {
            ...snapshot.checkpoint,
            kind: 'run_terminal',
            executionPosition: 'terminal',
            nextTurnIndex: undefined,
            checkpointSchemaVersion: 2,
            configFingerprint: 'legacy-v2-config',
            resumeState: undefined,
          },
        },
        {
          ...recoveryCompatibility(),
          legacyConfigFingerprints: { 2: 'legacy-v2-config' },
        },
      ),
    ).toEqual({
      kind: 'blocked',
      reasonCode: 'RECOVERY_CHECKPOINT_UNSUPPORTED',
    });
  });

  it('blocks a checkpoint whose full Run scope does not match the snapshot', () => {
    const snapshot = modelRecoverySnapshot();

    expect(
      planAgentRunRecovery(
        {
          ...snapshot,
          checkpoint: {
            ...snapshot.checkpoint,
            projectId: 'foreign-project',
          },
        },
        {
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 3,
          configFingerprint: 'recovery-config',
        },
      ),
    ).toEqual({ kind: 'blocked', reasonCode: 'RECOVERY_SCOPE_INVALID' });
  });

  it('ignores an already terminal Task and Run without inspecting resume work', () => {
    const snapshot = modelRecoverySnapshot();
    const run = snapshot.task.runs[0]!;

    expect(
      planAgentRunRecovery(
        {
          ...snapshot,
          task: {
            ...snapshot.task,
            status: 'completed',
            activeRunId: undefined,
            runs: [{ ...run, status: 'completed' }],
          },
        },
        {
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 3,
          configFingerprint: 'recovery-config',
        },
      ),
    ).toEqual({ kind: 'ignore_terminal' });
  });

  it('blocks an invalid recovery lease projection', () => {
    const snapshot = modelRecoverySnapshot();

    expect(
      planAgentRunRecovery(
        {
          ...snapshot,
          lease: { ...snapshot.lease, fencingToken: 0 },
        },
        {
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 3,
          configFingerprint: 'recovery-config',
        },
      ),
    ).toEqual({ kind: 'blocked', reasonCode: 'RECOVERY_LEASE_INVALID' });
  });

  it.each([
    [{ configFingerprint: 'foreign-config' }, 'RECOVERY_CONFIG_MISMATCH'],
    [{ harnessProtocolVersion: 99 }, 'RECOVERY_PROTOCOL_UNSUPPORTED'],
    [{ checkpointSchemaVersion: 99 }, 'RECOVERY_CHECKPOINT_UNSUPPORTED'],
  ] as const)(
    'blocks an incompatible checkpoint with %s',
    (checkpointPatch, reasonCode) => {
      const snapshot = modelRecoverySnapshot();

      expect(
        planAgentRunRecovery(
          {
            ...snapshot,
            checkpoint: { ...snapshot.checkpoint, ...checkpointPatch },
          },
          recoveryCompatibility(),
        ),
      ).toEqual({ kind: 'blocked', reasonCode });
    },
  );

  it('blocks a non-contiguous durable event position', () => {
    const snapshot = modelRecoverySnapshot();

    expect(
      planAgentRunRecovery(
        { ...snapshot, lastEventSequence: -1 },
        recoveryCompatibility(),
      ),
    ).toEqual({
      kind: 'blocked',
      reasonCode: 'RECOVERY_EVENT_POSITION_INVALID',
    });
  });

  it('blocks an interrupted model Turn with no durable Attempt correlation', () => {
    const snapshot = modelRecoverySnapshot();
    const turn = snapshot.task.runs[0]!.turns[0]!;

    expect(
      planAgentRunRecovery(
        {
          ...snapshot,
          task: {
            ...snapshot.task,
            runs: [
              {
                ...snapshot.task.runs[0]!,
                turns: [{ ...turn, status: 'running' }],
              },
            ],
          },
          checkpoint: {
            ...snapshot.checkpoint,
            nextTurnIndex: 1,
            resumeState: { kind: 'model', nextTurnIndex: 1 },
          },
        },
        recoveryCompatibility(),
      ),
    ).toEqual({
      kind: 'blocked',
      reasonCode: 'RECOVERY_EVENT_POSITION_INVALID',
    });
  });

  it('blocks a Run whose Turn indexes contain a gap', () => {
    const snapshot = modelRecoverySnapshot();
    const turn = snapshot.task.runs[0]!.turns[0]!;

    expect(
      planAgentRunRecovery(
        {
          ...snapshot,
          task: {
            ...snapshot.task,
            runs: [
              {
                ...snapshot.task.runs[0]!,
                turns: [{ ...turn, turnIndex: 2 }],
              },
            ],
          },
        },
        recoveryCompatibility(),
      ),
    ).toEqual({
      kind: 'blocked',
      reasonCode: 'RECOVERY_TURN_ORDER_INVALID',
    });
  });

  it('continues tool proposal processing from the explicit v3 sequence', () => {
    const snapshot = modelRecoverySnapshot();

    expect(
      planAgentRunRecovery(
        {
          ...snapshot,
          checkpoint: {
            ...snapshot.checkpoint,
            kind: 'model_completed',
            turnIndex: 1,
            executionPosition: 'tool',
            nextTurnIndex: 1,
            resumeState: {
              kind: 'tool',
              turnIndex: 1,
              nextProposalSequence: 1,
            },
          },
          task: {
            ...snapshot.task,
            runs: [
              {
                ...snapshot.task.runs[0]!,
                turns: [
                  { ...snapshot.task.runs[0]!.turns[0]!, status: 'running' },
                ],
              },
            ],
          },
        },
        {
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 3,
          configFingerprint: 'recovery-config',
        },
      ),
    ).toEqual({
      kind: 'continue_tools',
      turnIndex: 1,
      nextProposalSequence: 1,
    });
  });

  it('reprepares a prepared ToolExecution without inventing a new identity', () => {
    const snapshot = toolRecoverySnapshot();
    const execution = toolExecutionSnapshot({ status: 'prepared' });

    expect(
      planAgentRunRecovery(
        { ...snapshot, toolExecutions: [execution] },
        {
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 3,
          configFingerprint: 'recovery-config',
        },
      ),
    ).toEqual({
      kind: 'reprepare_tool',
      toolExecutionId: 'tool-execution-1',
    });
  });

  it('blocks duplicate ToolExecution proposal identities', () => {
    const snapshot = toolRecoverySnapshot();
    const execution = toolExecutionSnapshot({ status: 'prepared' });

    expect(
      planAgentRunRecovery(
        {
          ...snapshot,
          toolExecutions: [
            execution,
            {
              ...execution,
              toolExecutionId: 'tool-execution-duplicate',
            },
          ],
        },
        recoveryCompatibility(),
      ),
    ).toEqual({ kind: 'blocked', reasonCode: 'RECOVERY_LEDGER_INVALID' });
  });

  it('retries only an orphaned running ToolExecution declared side-effect-free', () => {
    const snapshot = toolRecoverySnapshot();
    const execution: AgentToolExecutionSnapshot = Object.freeze({
      ...toolExecutionSnapshot({ status: 'running' }),
      attemptCount: 1,
      attempts: Object.freeze([
        Object.freeze({
          attemptId: 'attempt-1',
          attempt: 1,
          status: 'running',
          deadline: '2026-08-01T00:00:32.000Z',
          startedAt: '2026-08-01T00:00:02.000Z',
        }),
      ]),
      startedAt: '2026-08-01T00:00:02.000Z',
    });

    expect(
      planAgentRunRecovery(
        { ...snapshot, toolExecutions: [execution] },
        {
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 3,
          configFingerprint: 'recovery-config',
        },
      ),
    ).toEqual({
      kind: 'retry_safe_tool',
      toolExecutionId: 'tool-execution-1',
    });
  });

  it('quarantines an orphaned running external Attempt for reconciliation', () => {
    const snapshot = toolRecoverySnapshot();
    const execution: AgentToolExecutionSnapshot = Object.freeze({
      ...toolExecutionSnapshot({ status: 'running' }),
      sideEffect: 'external',
      idempotency: 'keyed',
      idempotencyKey: 'stable-key',
      attemptCount: 1,
      attempts: Object.freeze([
        Object.freeze({
          attemptId: 'attempt-external-running',
          attempt: 1,
          status: 'running',
          deadline: '2026-08-01T00:00:32.000Z',
          startedAt: '2026-08-01T00:00:02.000Z',
        }),
      ]),
    });

    expect(
      planAgentRunRecovery(
        { ...snapshot, toolExecutions: [execution] },
        recoveryCompatibility(),
      ),
    ).toEqual({
      kind: 'wait_for_reconciliation',
      toolExecutionId: 'tool-execution-1',
      attemptId: 'attempt-external-running',
    });
  });

  it('waits on the exact pending Approval named by the v3 cursor', () => {
    const snapshot = approvalRecoverySnapshot('pending');

    expect(
      planAgentRunRecovery(snapshot, {
        harnessProtocolVersion: 2,
        checkpointSchemaVersion: 3,
        configFingerprint: 'recovery-config',
      }),
    ).toEqual({ kind: 'wait_for_approval', approvalId: 'approval-1' });
  });

  it('consumes one decided but unconsumed Approval', () => {
    expect(
      planAgentRunRecovery(
        approvalRecoverySnapshot('approved'),
        recoveryCompatibility(),
      ),
    ).toEqual({ kind: 'consume_approval', approvalId: 'approval-1' });
  });

  it('blocks an Approval with only one consumption marker', () => {
    const snapshot = approvalRecoverySnapshot('approved');
    const approval = snapshot.approvals[0]!;

    expect(
      planAgentRunRecovery(
        {
          ...snapshot,
          approvals: [{ ...approval, consumeId: 'consume-1' }],
        },
        recoveryCompatibility(),
      ),
    ).toEqual({ kind: 'blocked', reasonCode: 'RECOVERY_APPROVAL_INVALID' });
  });

  it('finalizes from the exact durable result without planning new model work', () => {
    const snapshot = modelRecoverySnapshot();
    const result = Object.freeze({
      status: 'failed' as const,
      turns: 1,
      error: Object.freeze({
        code: 'AGENT_MODEL_FAILED',
        category: 'model' as const,
        message: 'Model failed',
        retryable: false,
      }),
      transcript: Object.freeze([]),
    });

    expect(
      planAgentRunRecovery(
        {
          ...snapshot,
          checkpoint: {
            ...snapshot.checkpoint,
            kind: 'run_terminal',
            executionPosition: 'terminal',
            resumeState: { kind: 'finalize', result },
          },
        },
        {
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 3,
          configFingerprint: 'recovery-config',
        },
      ),
    ).toEqual({ kind: 'finalize', result });
  });

  it('waits for reconciliation at the exact external Attempt cursor', () => {
    const snapshot = toolRecoverySnapshot();
    const execution: AgentToolExecutionSnapshot = Object.freeze({
      ...toolExecutionSnapshot({ status: 'unknown' }),
      sideEffect: 'external',
      effectOutcome: 'unknown',
      retryable: false,
      attemptCount: 1,
      attempts: Object.freeze([
        Object.freeze({
          attemptId: 'attempt-external-1',
          attempt: 1,
          status: 'unknown',
          effectOutcome: 'unknown',
          deadline: '2026-08-01T00:00:32.000Z',
          startedAt: '2026-08-01T00:00:02.000Z',
          finishedAt: '2026-08-01T00:00:32.000Z',
        }),
      ]),
      startedAt: '2026-08-01T00:00:02.000Z',
      finishedAt: '2026-08-01T00:00:32.000Z',
    });

    expect(
      planAgentRunRecovery(
        {
          ...snapshot,
          task: {
            ...snapshot.task,
            status: 'waiting_for_reconciliation',
            runs: [
              {
                ...snapshot.task.runs[0]!,
                status: 'waiting_for_reconciliation',
              },
            ],
          },
          checkpoint: {
            ...snapshot.checkpoint,
            kind: 'reconciliation_waiting',
            executionPosition: 'reconciliation',
            resumeState: {
              kind: 'reconciliation',
              toolExecutionId: 'tool-execution-1',
              attemptId: 'attempt-external-1',
            },
          },
          toolExecutions: [execution],
        },
        {
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 3,
          configFingerprint: 'recovery-config',
        },
      ),
    ).toEqual({
      kind: 'wait_for_reconciliation',
      toolExecutionId: 'tool-execution-1',
      attemptId: 'attempt-external-1',
    });
  });
});

function approvalRecoverySnapshot(
  status: AgentApprovalSnapshot['status'],
): AgentRunRecoverySnapshot {
  const snapshot = toolRecoverySnapshot();
  const execution = toolExecutionSnapshot({ status: 'awaiting_approval' });
  const approval: AgentApprovalSnapshot = Object.freeze({
    tenantId: 'tenant-recovery',
    projectId: 'project-recovery',
    taskId: 'task-recovery',
    runId: 'run-recovery',
    turnId: 'turn-1',
    approvalId: 'approval-1',
    toolExecutionId: 'tool-execution-1',
    proposalSequence: 1,
    policyId: 'recovery-policy',
    policyVersion: 'v1',
    argumentsDigest: 'arguments-digest',
    presentation: Object.freeze({ title: 'Approve recovery tool' }),
    status,
    transitions: Object.freeze([]),
    requestedAt: '2026-08-01T00:00:02.000Z',
    expiresAt: '2026-08-01T01:00:00.000Z',
    rowVersion: 1,
    decisionId:
      status === 'approved' || status === 'denied' ? 'decision-1' : undefined,
    decision: status === 'approved' || status === 'denied' ? status : undefined,
    decidedBy:
      status === 'approved' || status === 'denied'
        ? 'recovery-reviewer'
        : undefined,
    decidedAt:
      status === 'approved' || status === 'denied'
        ? '2026-08-01T00:00:03.000Z'
        : undefined,
  });
  return {
    ...snapshot,
    task: {
      ...snapshot.task,
      status: 'waiting_for_approval',
      runs: [{ ...snapshot.task.runs[0]!, status: 'waiting_for_approval' }],
    },
    checkpoint: {
      ...snapshot.checkpoint,
      kind: 'approval_waiting',
      executionPosition: 'approval',
      resumeState: {
        kind: 'approval',
        turnIndex: 1,
        approvalId: 'approval-1',
        toolExecutionId: 'tool-execution-1',
      },
    },
    toolExecutions: [execution],
    approvals: [approval],
  };
}

function toolRecoverySnapshot(): AgentRunRecoverySnapshot {
  const snapshot = modelRecoverySnapshot();
  return {
    ...snapshot,
    checkpoint: {
      ...snapshot.checkpoint,
      kind: 'model_completed',
      turnIndex: 1,
      executionPosition: 'tool',
      nextTurnIndex: 1,
      resumeState: {
        kind: 'tool',
        turnIndex: 1,
        nextProposalSequence: 1,
      },
    },
    task: {
      ...snapshot.task,
      runs: [
        {
          ...snapshot.task.runs[0]!,
          turns: [{ ...snapshot.task.runs[0]!.turns[0]!, status: 'running' }],
        },
      ],
    },
  };
}

function toolExecutionSnapshot(
  input: Pick<AgentToolExecutionSnapshot, 'status'>,
): AgentToolExecutionSnapshot {
  return Object.freeze({
    tenantId: 'tenant-recovery',
    projectId: 'project-recovery',
    taskId: 'task-recovery',
    runId: 'run-recovery',
    turnId: 'turn-1',
    turnIndex: 1,
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
    proposalSequence: 1,
    toolName: 'test-tool',
    argumentsDigest: 'arguments-digest',
    sideEffect: 'none',
    idempotency: 'none',
    timeoutMs: 30_000,
    deadline: '2026-08-01T00:00:32.000Z',
    status: input.status,
    attemptCount: 0,
    attempts: Object.freeze([]),
    transitions: Object.freeze([]),
    proposedAt: '2026-08-01T00:00:02.000Z',
    preparedAt: '2026-08-01T00:00:02.000Z',
  });
}

function modelRecoverySnapshot(): AgentRunRecoverySnapshot {
  return Object.freeze({
    tenantId: 'tenant-recovery',
    projectId: 'project-recovery',
    taskId: 'task-recovery',
    runId: 'run-recovery',
    task: Object.freeze({
      taskId: 'task-recovery',
      tenantId: 'tenant-recovery',
      projectId: 'project-recovery',
      status: 'running',
      latestRunId: 'run-recovery',
      activeRunId: 'run-recovery',
      runs: Object.freeze([
        Object.freeze({
          runId: 'run-recovery',
          status: 'running',
          turns: Object.freeze([
            Object.freeze({
              turnId: 'turn-1',
              turnIndex: 1,
              status: 'completed',
              createdAt: '2026-08-01T00:00:01.000Z',
              updatedAt: '2026-08-01T00:00:02.000Z',
            }),
          ]),
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:02.000Z',
        }),
      ]),
      transcript: Object.freeze([]),
      version: 3,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:02.000Z',
    }),
    checkpoint: Object.freeze({
      tenantId: 'tenant-recovery',
      projectId: 'project-recovery',
      taskId: 'task-recovery',
      runId: 'run-recovery',
      version: 2,
      kind: 'tool_result_appended',
      transcript: Object.freeze([]),
      turnIndex: 1,
      executionPosition: 'model',
      nextTurnIndex: 2,
      resumeState: Object.freeze({ kind: 'model', nextTurnIndex: 2 }),
      harnessProtocolVersion: 2,
      checkpointSchemaVersion: 3,
      configFingerprint: 'recovery-config',
      createdAt: '2026-08-01T00:00:02.000Z',
    }),
    toolExecutions: Object.freeze([]),
    approvals: Object.freeze([]),
    modelAttempts: Object.freeze([]),
    lastEventSequence: 7,
    lease: Object.freeze({
      ownerId: 'recovery-worker',
      fencingToken: 2,
      leaseExpiresAt: '2026-08-01T00:01:00.000Z',
    }),
  });
}

function recoveryCompatibility() {
  return {
    harnessProtocolVersion: 2,
    checkpointSchemaVersion: 3,
    configFingerprint: 'recovery-config',
  } as const;
}
