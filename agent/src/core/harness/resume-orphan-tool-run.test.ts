import type { Message, ToolCallContent } from '@duoduo/ai';
import { createFauxProvider } from '@duoduo/ai/testing';
import { describe, expect, it } from 'vitest';

import type { AgentTool, AgentToolExecutionContext } from '../types.js';
import { hashRuntimeCommit } from './commit-hash.js';
import { createInMemoryAgentRuntimeStore } from './in-memory-state.js';
import { planAgentRunRecovery } from './recovery-plan.js';
import { resumeAgentOrphanToolRun } from './resume-orphan-tool-run.js';
import type {
  AgentRunExecutionLease,
  AgentRunRecoverySnapshot,
  AgentRuntimeStore,
} from './runtime-store.js';

describe('resumeAgentOrphanToolRun', () => {
  it('closes a side-effect-free orphan and invokes only Attempt N+1 with the stable identity and key', async () => {
    const store = createInMemoryAgentRuntimeStore();
    let invocations = 0;
    let observedContext: AgentToolExecutionContext | undefined;

    try {
      const fixture = await orphanToolRecoveryState(store, 'none');
      const plan = recoveryPlan(fixture.snapshot);
      if (plan.kind !== 'retry_safe_tool')
        throw new TypeError('Expected safe orphan retry');
      let id = 0;

      const result = await resumeAgentOrphanToolRun({
        runtimeStore: store,
        snapshot: fixture.snapshot,
        lease: fixture.lease,
        plan,
        recoveryId: 'recover-safe-orphan',
        tools: [
          orphanTool('none', (context) => {
            invocations += 1;
            observedContext = context;
          }),
        ],
        ids: { next: (kind) => `${kind}-safe-orphan-${++id}` },
        clock: { now: () => '2026-08-01T00:00:10.000Z' },
        timer: { schedule: () => () => undefined },
      });

      expect(result.plan).toEqual({
        kind: 'continue_model',
        nextTurnIndex: 2,
      });
      expect(invocations).toBe(1);
      const [execution] = await store.readToolExecutions(fixture.snapshot);
      expect(execution).toMatchObject({
        toolExecutionId: 'tool-execution-orphan',
        idempotencyKey: 'stable-orphan-key',
        status: 'succeeded',
        attemptCount: 2,
        attempts: [
          {
            attemptId: 'tool-attempt-orphan-1',
            attempt: 1,
            status: 'unknown',
            effectOutcome: 'not_applied',
            errorCode: 'OWNER_LEASE_EXPIRED',
          },
          {
            attemptId: expect.any(String),
            attempt: 2,
            status: 'succeeded',
            effectOutcome: 'not_applied',
          },
        ],
        transitions: [
          { sequence: 1, to: 'proposed' },
          { sequence: 2, from: 'proposed', to: 'prepared' },
          {
            sequence: 3,
            from: 'prepared',
            to: 'running',
            attemptId: 'tool-attempt-orphan-1',
          },
          {
            sequence: 4,
            from: 'running',
            to: 'prepared',
            attemptId: 'tool-attempt-orphan-1',
            reasonCode: 'SAFE_RECOVERY_RETRY',
          },
          {
            sequence: 5,
            from: 'prepared',
            to: 'prepared',
            reasonCode: 'RECOVERY_RESUME',
          },
          { sequence: 6, from: 'prepared', to: 'running' },
          { sequence: 7, from: 'running', to: 'succeeded' },
        ],
      });
      expect(observedContext).toMatchObject({
        toolCallId: 'tool-call-orphan',
        toolExecutionId: 'tool-execution-orphan',
        attempt: 2,
        idempotencyKey: 'stable-orphan-key',
      });
      const events = await store.readEvents({
        ...fixture.snapshot,
        afterSequence: 0,
        limit: 100,
      });
      expect(events.events.slice(-3)).toMatchObject([
        {
          sequence: 6,
          payload: {
            type: 'tool_execution_start',
            attempt: 2,
            toolExecutionId: 'tool-execution-orphan',
          },
        },
        {
          sequence: 7,
          payload: {
            type: 'tool_execution_end',
            attempt: 2,
            status: 'succeeded',
          },
        },
        { sequence: 8, payload: { type: 'turn_end' } },
      ]);
      await expect(
        store.readRunRecoveryAudit(fixture.snapshot),
      ).resolves.toMatchObject([
        { sequence: 1, action: 'initial_claim' },
        { sequence: 2, action: 'recovery_claim' },
        {
          sequence: 3,
          recoveryId: 'recover-safe-orphan',
          action: 'resumed',
          reasonCode: 'SAFE_RECOVERY_RETRY',
          fencingToken: 2,
        },
      ]);
    } finally {
      await store.dispose();
    }
  });

  it('quarantines an external orphan for reconciliation with zero tool invocation', async () => {
    const store = createInMemoryAgentRuntimeStore();
    let invocations = 0;

    try {
      const fixture = await orphanToolRecoveryState(store, 'external');
      const plan = recoveryPlan(fixture.snapshot);
      if (plan.kind !== 'wait_for_reconciliation')
        throw new TypeError('Expected external orphan quarantine');
      let id = 0;

      const result = await resumeAgentOrphanToolRun({
        runtimeStore: store,
        snapshot: fixture.snapshot,
        lease: fixture.lease,
        plan,
        recoveryId: 'recover-external-orphan',
        tools: [orphanTool('external', () => (invocations += 1))],
        ids: { next: (kind) => `${kind}-external-orphan-${++id}` },
        clock: { now: () => '2026-08-01T00:00:10.000Z' },
        timer: { schedule: () => () => undefined },
      });

      expect(result.plan).toEqual({
        kind: 'wait_for_reconciliation',
        toolExecutionId: 'tool-execution-orphan',
        attemptId: 'tool-attempt-orphan-1',
      });
      expect(invocations).toBe(0);
      await expect(store.getTask(fixture.snapshot)).resolves.toMatchObject({
        status: 'waiting_for_reconciliation',
        runs: [
          {
            status: 'waiting_for_reconciliation',
            turns: [{ turnIndex: 1, status: 'running' }],
          },
        ],
      });
      await expect(
        store.readToolExecutions(fixture.snapshot),
      ).resolves.toMatchObject([
        {
          toolExecutionId: 'tool-execution-orphan',
          idempotencyKey: 'stable-orphan-key',
          status: 'unknown',
          effectOutcome: 'unknown',
          retryable: false,
          attemptCount: 1,
          attempts: [
            {
              attemptId: 'tool-attempt-orphan-1',
              status: 'unknown',
              effectOutcome: 'unknown',
              errorCode: 'OWNER_LEASE_EXPIRED',
            },
          ],
          transitions: [
            {},
            {},
            {},
            {
              sequence: 4,
              from: 'running',
              to: 'unknown',
              attemptId: 'tool-attempt-orphan-1',
              reasonCode: 'OWNER_LEASE_EXPIRED',
            },
          ],
        },
      ]);
      await expect(
        store.getCheckpoint(fixture.snapshot),
      ).resolves.toMatchObject({
        kind: 'reconciliation_waiting',
        executionPosition: 'reconciliation',
        resumeState: {
          kind: 'reconciliation',
          toolExecutionId: 'tool-execution-orphan',
          attemptId: 'tool-attempt-orphan-1',
        },
      });
      const events = await store.readEvents({
        ...fixture.snapshot,
        afterSequence: 5,
        limit: 100,
      });
      expect(events.events).toMatchObject([
        {
          sequence: 6,
          payload: {
            type: 'run_reconciliation_required',
            toolCallId: 'tool-call-orphan',
            toolExecutionId: 'tool-execution-orphan',
            attemptId: 'tool-attempt-orphan-1',
            reasonCode: 'EXTERNAL_EFFECT_UNKNOWN',
          },
        },
      ]);
      const outbox = await store.claimOutbox({
        workerId: 'reconciliation-outbox-worker',
        limit: 100,
        now: '2026-08-01T00:00:11.000Z',
        leaseExpiresAt: '2026-08-01T00:00:41.000Z',
      });
      expect(
        outbox.messages.filter(
          (message) =>
            message.event.payload.type === 'run_reconciliation_required',
        ),
      ).toMatchObject([
        { event: { payload: { type: 'run_reconciliation_required' } } },
      ]);
      await expect(
        store.readRunRecoveryAudit(fixture.snapshot),
      ).resolves.toMatchObject([
        { sequence: 1, action: 'initial_claim' },
        { sequence: 2, action: 'recovery_claim' },
        {
          sequence: 3,
          recoveryId: 'recover-external-orphan',
          action: 'blocked',
          reasonCode: 'EXTERNAL_EFFECT_UNKNOWN',
          fencingToken: 2,
        },
      ]);
      await expect(
        store.claimRecoverableRuns({
          claimId: 'must-not-reclaim-reconciliation',
          ownerId: 'worker-must-not-reclaim',
          configFingerprint: 'orphan-recovery-config',
          limit: 1,
          now: '2026-08-01T00:01:00.000Z',
          leaseExpiresAt: '2026-08-01T00:01:30.000Z',
        }),
      ).resolves.toEqual({ leases: [] });
    } finally {
      await store.dispose();
    }
  });
});

async function orphanToolRecoveryState(
  store: AgentRuntimeStore,
  sideEffect: 'none' | 'external',
): Promise<{
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly lease: AgentRunExecutionLease;
}> {
  const scope = {
    tenantId: 'tenant-orphan-recovery',
    projectId: 'project-orphan-recovery',
  };
  const query = {
    ...scope,
    taskId: `task-orphan-${sideEffect}`,
    runId: `run-orphan-${sideEffect}`,
  };
  const call = toolCall();
  const transcript = Object.freeze([userMessage(), assistantMessage(call)]);
  let receipt = await store.createTask({
    scope,
    taskId: query.taskId,
    runId: query.runId,
    commitId: `create-orphan-${sideEffect}`,
    checkpoint: {
      kind: 'input_accepted',
      input: 'run orphan tool',
      transcript: [],
      executionPosition: 'model',
      nextTurnIndex: 1,
      resumeState: { kind: 'model', nextTurnIndex: 1 },
      harnessProtocolVersion: 2,
      checkpointSchemaVersion: 3,
      configFingerprint: 'orphan-recovery-config',
    },
    initialLease: {
      ownershipId: `ownership-orphan-${sideEffect}`,
      ownerId: 'worker-orphan-original',
      leaseExpiresAt: '2026-08-01T00:00:05.000Z',
    },
    now: '2026-08-01T00:00:00.000Z',
  });
  const firstLease = receipt.lease!;
  const firstGuard = {
    leaseToken: firstLease.leaseToken,
    fencingToken: firstLease.fencingToken,
  };
  receipt = await store.commitTask({
    ...query,
    commitId: `propose-orphan-${sideEffect}`,
    expectedVersion: receipt.version,
    mutations: [
      { type: 'run_started' },
      { type: 'turn_started', turnId: 'turn-orphan', turnIndex: 1 },
    ],
    toolExecutions: [
      {
        type: 'tool_execution_proposed',
        toolExecutionId: 'tool-execution-orphan',
        toolCallId: call.id,
        turnId: 'turn-orphan',
        turnIndex: 1,
        proposalSequence: 1,
        toolName: call.name,
        argumentsDigest: hashRuntimeCommit(call.rawArguments),
      },
    ],
    events: [
      harnessEvent(query, 1, { type: 'run_start' }),
      harnessEvent(query, 2, { type: 'turn_start' }),
      harnessEvent(query, 3, {
        type: 'model_start',
        requestId: 'request-orphan',
        modelAttemptId: 'model-attempt-orphan',
        modelAttempt: 1,
      }),
      harnessEvent(query, 4, {
        type: 'model_end',
        response: assistantMessage(call),
        modelAttemptId: 'model-attempt-orphan',
        modelAttempt: 1,
      }),
    ],
    checkpoint: {
      kind: 'model_completed',
      transcript,
      turnIndex: 1,
      executionPosition: 'tool',
      nextTurnIndex: 1,
      resumeState: {
        kind: 'tool',
        turnIndex: 1,
        nextProposalSequence: 1,
      },
      harnessProtocolVersion: 2,
      checkpointSchemaVersion: 3,
      configFingerprint: 'orphan-recovery-config',
    },
    lease: firstGuard,
    now: '2026-08-01T00:00:01.000Z',
  });
  receipt = await store.commitTask({
    ...query,
    commitId: `prepare-orphan-${sideEffect}`,
    expectedVersion: receipt.version,
    mutations: [],
    toolExecutions: [
      {
        type: 'tool_execution_prepared',
        toolExecutionId: 'tool-execution-orphan',
        sideEffect,
        idempotency: 'keyed',
        timeoutMs: 30_000,
        idempotencyKey: 'stable-orphan-key',
        deadline: '2026-08-01T00:00:32.000Z',
      },
    ],
    lease: firstGuard,
    now: '2026-08-01T00:00:02.000Z',
  });
  await store.commitTask({
    ...query,
    commitId: `start-orphan-${sideEffect}`,
    expectedVersion: receipt.version,
    mutations: [],
    toolExecutions: [
      {
        type: 'tool_execution_started',
        toolExecutionId: 'tool-execution-orphan',
        attemptId: 'tool-attempt-orphan-1',
        attempt: 1,
      },
    ],
    events: [
      harnessEvent(query, 5, {
        type: 'tool_execution_start',
        toolCallId: call.id,
        toolName: call.name,
        toolExecutionId: 'tool-execution-orphan',
        attemptId: 'tool-attempt-orphan-1',
        attempt: 1,
      }),
    ],
    lease: firstGuard,
    now: '2026-08-01T00:00:03.000Z',
  });
  const lease = (
    await store.claimRecoverableRuns({
      claimId: `claim-orphan-${sideEffect}`,
      ownerId: 'worker-orphan-recovery',
      configFingerprint: 'orphan-recovery-config',
      limit: 1,
      now: '2026-08-01T00:00:05.000Z',
      leaseExpiresAt: '2026-08-01T00:01:00.000Z',
    })
  ).leases[0]!;
  const snapshot = await store.readRecoverySnapshot({
    ...query,
    ownerId: lease.ownerId,
    leaseToken: lease.leaseToken,
    fencingToken: lease.fencingToken,
    now: '2026-08-01T00:00:06.000Z',
  });
  return { snapshot, lease };
}

function recoveryPlan(snapshot: AgentRunRecoverySnapshot) {
  return planAgentRunRecovery(snapshot, {
    harnessProtocolVersion: 2,
    checkpointSchemaVersion: 3,
    configFingerprint: 'orphan-recovery-config',
  });
}

function orphanTool(
  sideEffect: 'none' | 'external',
  invoked: (context: AgentToolExecutionContext) => void,
): AgentTool {
  return Object.freeze({
    definition: Object.freeze({
      name: 'orphan-tool',
      inputSchema: Object.freeze({
        type: 'object' as const,
        properties: Object.freeze({
          value: Object.freeze({ type: 'number' }),
        }),
        required: Object.freeze(['value']),
        additionalProperties: false,
      }),
    }),
    execution: Object.freeze({
      sideEffect,
      idempotency: 'keyed' as const,
      timeoutMs: 30_000,
    }),
    async execute(_arguments, context) {
      invoked(context);
      return Object.freeze({
        content: Object.freeze([
          Object.freeze({ type: 'text' as const, text: 'recovered' }),
        ]),
      });
    },
  });
}

function toolCall(): ToolCallContent {
  return Object.freeze({
    type: 'tool_call' as const,
    id: 'tool-call-orphan',
    name: 'orphan-tool',
    rawArguments: '{"value":1}',
  });
}

function userMessage(): Message {
  return Object.freeze({
    role: 'user' as const,
    content: Object.freeze([
      Object.freeze({ type: 'text' as const, text: 'run orphan tool' }),
    ]),
  });
}

function assistantMessage(call: ToolCallContent): Message {
  return Object.freeze({
    role: 'assistant' as const,
    content: Object.freeze([call]),
    model: createFauxProvider().modelRef,
    status: 'completed' as const,
    finishReason: 'tool_calls' as const,
    partial: false,
  });
}

function harnessEvent(
  query: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly taskId: string;
    readonly runId: string;
  },
  sequence: number,
  payload: Record<string, unknown> & { readonly type: string },
) {
  return {
    ...query,
    eventId: `event-orphan-existing-${sequence}`,
    turnId: sequence === 1 ? undefined : 'turn-orphan',
    turnIndex: sequence === 1 ? undefined : 1,
    sequence,
    occurredAt: '2026-08-01T00:00:01.000Z',
    payload,
  } as Parameters<AgentRuntimeStore['commitTask']>[0]['events'] extends
    readonly (infer TEvent)[] | undefined
    ? TEvent
    : never;
}
