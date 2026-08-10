import type { Message, ToolCallContent } from '@duoduo/ai';
import { createFauxProvider } from '@duoduo/ai/testing';
import { describe, expect, it } from 'vitest';

import type { AgentTool, AgentToolExecutionContext } from '../types.js';
import { hashRuntimeCommit } from './commit-hash.js';
import { createInMemoryAgentRuntimeStore } from './in-memory-state.js';
import { planAgentRunRecovery } from './recovery-plan.js';
import { resumeAgentApprovalRun } from './resume-approval-run.js';
import type {
  AgentRunExecutionLease,
  AgentRunRecoverySnapshot,
  AgentRuntimeStore,
} from './runtime-store.js';
import type { AgentTimer } from './types.js';

describe('resumeAgentApprovalRun', () => {
  it('consumes one approved decision, invokes the tool once, and follows the later checkpoint on stale retry', async () => {
    const store = createInMemoryAgentRuntimeStore();
    let invocations = 0;
    let observedContext: AgentToolExecutionContext | undefined;

    try {
      const fixture = await approvalRecoveryState(store);
      await store.decideApproval({
        ...fixture.query,
        approvalId: 'approval-recovery',
        commitId: 'decide-approved-recovery',
        decisionId: 'decision-approved-recovery',
        decision: 'approved',
        decidedBy: 'reviewer-recovery',
        reasonCode: 'HUMAN_APPROVED',
        now: '2026-08-01T00:00:04.000Z',
      });
      const snapshot = await readRecoverySnapshot(
        store,
        fixture.lease,
        fixture.query,
        '2026-08-01T00:00:05.000Z',
      );
      const plan = recoveryPlan(snapshot);
      if (plan.kind !== 'consume_approval')
        throw new TypeError('Expected decided Approval consumption');
      let id = 0;
      const tool = approvalTool((context) => {
        invocations += 1;
        observedContext = context;
      });

      const first = await resumeAgentApprovalRun({
        runtimeStore: store,
        snapshot,
        lease: fixture.lease,
        plan,
        tools: [tool],
        ids: { next: (kind) => `${kind}-approval-${++id}` },
        clock: { now: () => '2026-08-01T00:00:10.000Z' },
        timer: { schedule: () => () => undefined },
      });

      expect(first.plan).toEqual({
        kind: 'continue_model',
        nextTurnIndex: 2,
      });
      expect(invocations).toBe(1);
      const [approvalAfterFirst] = await store.readApprovals(fixture.query);
      const [executionAfterFirst] = await store.readToolExecutions(
        fixture.query,
      );
      expect(approvalAfterFirst).toMatchObject({
        approvalId: 'approval-recovery',
        status: 'approved',
        decisionId: 'decision-approved-recovery',
        consumeId: expect.any(String),
        transitions: [
          { sequence: 1, to: 'pending' },
          { sequence: 2, from: 'pending', to: 'approved' },
          {
            sequence: 3,
            from: 'approved',
            to: 'approved',
            reasonCode: 'CONSUMED',
          },
        ],
      });
      expect(executionAfterFirst).toMatchObject({
        toolExecutionId: 'tool-execution-recovery',
        status: 'succeeded',
        attemptCount: 1,
        idempotencyKey: expect.any(String),
        transitions: [
          { sequence: 1, to: 'proposed' },
          { sequence: 2, from: 'proposed', to: 'awaiting_approval' },
          {
            sequence: 3,
            from: 'awaiting_approval',
            to: 'prepared',
            reasonCode: 'APPROVAL_CONSUMED',
          },
          {
            sequence: 4,
            from: 'prepared',
            to: 'prepared',
            reasonCode: 'RECOVERY_RESUME',
          },
          { sequence: 5, from: 'prepared', to: 'running' },
          { sequence: 6, from: 'running', to: 'succeeded' },
        ],
      });
      expect(observedContext).toMatchObject({
        toolCallId: 'tool-call-recovery',
        toolExecutionId: 'tool-execution-recovery',
        attempt: 1,
        idempotencyKey: executionAfterFirst?.idempotencyKey,
      });
      const eventsAfterFirst = await store.readEvents({
        ...fixture.query,
        afterSequence: 0,
        limit: 100,
      });
      expect(eventsAfterFirst.events.slice(-4)).toMatchObject([
        {
          sequence: 6,
          payload: {
            type: 'approval_decided',
            approvalId: 'approval-recovery',
            decision: 'approved',
          },
        },
        { sequence: 7, payload: { type: 'tool_execution_start' } },
        { sequence: 8, payload: { type: 'tool_execution_end' } },
        { sequence: 9, payload: { type: 'turn_end' } },
      ]);

      const retry = await resumeAgentApprovalRun({
        runtimeStore: store,
        snapshot,
        lease: fixture.lease,
        plan,
        tools: [tool],
        ids: { next: (kind) => `${kind}-stale-retry-${++id}` },
        clock: { now: () => '2026-08-01T00:00:11.000Z' },
        timer: { schedule: () => () => undefined },
      });

      expect(retry.plan).toEqual({
        kind: 'continue_model',
        nextTurnIndex: 2,
      });
      expect(invocations).toBe(1);
      await expect(store.readApprovals(fixture.query)).resolves.toMatchObject([
        { transitions: [{}, {}, { reasonCode: 'CONSUMED' }] },
      ]);
      await expect(
        store.readEvents({
          ...fixture.query,
          afterSequence: 0,
          limit: 100,
        }),
      ).resolves.toMatchObject({ events: eventsAfterFirst.events });
    } finally {
      await store.dispose();
    }
  });

  it('restores pending polling and consumes a denied decision without invoking the tool', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const timer = new ManualAgentTimer();
    let invocations = 0;

    try {
      const fixture = await approvalRecoveryState(store);
      const plan = recoveryPlan(fixture.snapshot);
      if (plan.kind !== 'wait_for_approval')
        throw new TypeError('Expected pending Approval wait');
      let id = 0;
      const recovery = resumeAgentApprovalRun({
        runtimeStore: store,
        snapshot: fixture.snapshot,
        lease: fixture.lease,
        plan,
        tools: [approvalTool(() => (invocations += 1))],
        ids: { next: (kind) => `${kind}-pending-${++id}` },
        clock: { now: () => '2026-08-01T00:00:10.000Z' },
        timer,
        approvalPollIntervalMs: 1_000,
      });
      await timer.waitUntilScheduled(1_000);

      await store.decideApproval({
        ...fixture.query,
        approvalId: 'approval-recovery',
        commitId: 'decide-denied-recovery',
        decisionId: 'decision-denied-recovery',
        decision: 'denied',
        decidedBy: 'reviewer-recovery',
        reasonCode: 'HUMAN_DENIED',
        now: '2026-08-01T00:00:11.000Z',
      });
      timer.runNext(1_000);
      const result = await recovery;

      expect(result.plan).toEqual({
        kind: 'continue_model',
        nextTurnIndex: 2,
      });
      expect(invocations).toBe(0);
      await expect(store.readApprovals(fixture.query)).resolves.toMatchObject([
        {
          status: 'denied',
          decisionId: 'decision-denied-recovery',
          consumeId: expect.any(String),
          transitions: [{}, {}, { reasonCode: 'CONSUMED' }],
        },
      ]);
      await expect(
        store.readToolExecutions(fixture.query),
      ).resolves.toMatchObject([
        {
          status: 'failed',
          attemptCount: 0,
          attempts: [],
          effectOutcome: 'not_applied',
        },
      ]);
      const checkpoint = await store.getCheckpoint(fixture.query);
      expect(checkpoint).toMatchObject({
        kind: 'tool_result_appended',
        executionPosition: 'model',
        nextTurnIndex: 2,
        resumeState: { kind: 'model', nextTurnIndex: 2 },
        transcript: [
          { role: 'user' },
          { role: 'assistant' },
          {
            role: 'tool_result',
            toolCallId: 'tool-call-recovery',
            isError: true,
          },
        ],
      });
      const events = await store.readEvents({
        ...fixture.query,
        afterSequence: 5,
        limit: 100,
      });
      expect(events.events).toMatchObject([
        {
          sequence: 6,
          payload: { type: 'approval_decided', decision: 'denied' },
        },
        {
          sequence: 7,
          payload: {
            type: 'tool_execution_end',
            attempt: 0,
            status: 'failed',
          },
        },
        { sequence: 8, payload: { type: 'turn_end' } },
      ]);
    } finally {
      await store.dispose();
    }
  });

  it('expires an overdue pending Approval through the current fence and never invokes the tool', async () => {
    const store = createInMemoryAgentRuntimeStore();
    let invocations = 0;

    try {
      const fixture = await approvalRecoveryState(store);
      const plan = recoveryPlan(fixture.snapshot);
      if (plan.kind !== 'wait_for_approval')
        throw new TypeError('Expected pending Approval wait');
      let id = 0;

      const result = await resumeAgentApprovalRun({
        runtimeStore: store,
        snapshot: fixture.snapshot,
        lease: fixture.lease,
        plan,
        tools: [approvalTool(() => (invocations += 1))],
        ids: { next: (kind) => `${kind}-expired-${++id}` },
        clock: { now: () => '2026-08-01T00:00:30.000Z' },
        timer: { schedule: () => () => undefined },
      });

      expect(result.plan).toEqual({
        kind: 'continue_model',
        nextTurnIndex: 2,
      });
      expect(invocations).toBe(0);
      await expect(store.readApprovals(fixture.query)).resolves.toMatchObject([
        {
          status: 'expired',
          consumeId: expect.any(String),
          transitions: [
            {},
            { from: 'pending', to: 'expired' },
            { from: 'expired', to: 'expired', reasonCode: 'CONSUMED' },
          ],
        },
      ]);
      const events = await store.readEvents({
        ...fixture.query,
        afterSequence: 5,
        limit: 100,
      });
      expect(events.events).toMatchObject([
        { payload: { type: 'approval_expired' } },
        { payload: { type: 'tool_execution_end', attempt: 0 } },
        { payload: { type: 'turn_end' } },
      ]);
    } finally {
      await store.dispose();
    }
  });
});

async function approvalRecoveryState(store: AgentRuntimeStore): Promise<{
  readonly query: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly taskId: string;
    readonly runId: string;
  };
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly lease: AgentRunExecutionLease;
}> {
  const scope = {
    tenantId: 'tenant-approval-recovery',
    projectId: 'project-approval-recovery',
  };
  const query = {
    ...scope,
    taskId: 'task-approval-recovery',
    runId: 'run-approval-recovery',
  };
  const call = toolCall();
  const transcript = Object.freeze([userMessage(), assistantMessage(call)]);
  let receipt = await store.createTask({
    scope,
    taskId: query.taskId,
    runId: query.runId,
    commitId: 'create-approval-recovery',
    checkpoint: {
      kind: 'input_accepted',
      input: 'publish the story',
      transcript: [],
      executionPosition: 'model',
      nextTurnIndex: 1,
      resumeState: { kind: 'model', nextTurnIndex: 1 },
      harnessProtocolVersion: 2,
      checkpointSchemaVersion: 3,
      configFingerprint: 'approval-recovery-config',
    },
    initialLease: {
      ownershipId: 'ownership-approval-recovery',
      ownerId: 'worker-approval-recovery',
      leaseExpiresAt: '2026-08-01T00:02:00.000Z',
    },
    now: '2026-08-01T00:00:00.000Z',
  });
  const lease = receipt.lease!;
  const leaseGuard = {
    leaseToken: lease.leaseToken,
    fencingToken: lease.fencingToken,
  };
  receipt = await store.commitTask({
    ...query,
    commitId: 'propose-approval-recovery',
    expectedVersion: receipt.version,
    mutations: [
      { type: 'run_started' },
      { type: 'turn_started', turnId: 'turn-approval-recovery', turnIndex: 1 },
    ],
    toolExecutions: [
      {
        type: 'tool_execution_proposed',
        toolExecutionId: 'tool-execution-recovery',
        toolCallId: call.id,
        turnId: 'turn-approval-recovery',
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
        requestId: 'request-approval-recovery',
        modelAttemptId: 'model-attempt-approval-recovery',
        modelAttempt: 1,
      }),
      harnessEvent(query, 4, {
        type: 'model_end',
        response: assistantMessage(call),
        modelAttemptId: 'model-attempt-approval-recovery',
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
      configFingerprint: 'approval-recovery-config',
    },
    lease: leaseGuard,
    now: '2026-08-01T00:00:01.000Z',
  });
  await store.commitTask({
    ...query,
    commitId: 'wait-approval-recovery',
    expectedVersion: receipt.version,
    mutations: [{ type: 'approval_wait_started' }],
    toolExecutions: [
      {
        type: 'tool_execution_awaiting_approval',
        toolExecutionId: 'tool-execution-recovery',
        sideEffect: 'external',
        idempotency: 'keyed',
        timeoutMs: 30_000,
      },
    ],
    approvals: [
      {
        type: 'approval_requested',
        approvalId: 'approval-recovery',
        toolExecutionId: 'tool-execution-recovery',
        turnId: 'turn-approval-recovery',
        proposalSequence: 1,
        policyId: 'publish-policy',
        policyVersion: 'v1',
        argumentsDigest: hashRuntimeCommit(call.rawArguments),
        expiresAt: '2026-08-01T00:00:30.000Z',
        presentation: { title: 'Publish story' },
      },
    ],
    events: [
      harnessEvent(query, 5, {
        type: 'approval_requested',
        approvalId: 'approval-recovery',
        toolExecutionId: 'tool-execution-recovery',
        policyId: 'publish-policy',
        policyVersion: 'v1',
        expiresAt: '2026-08-01T00:00:30.000Z',
        presentation: { title: 'Publish story' },
      }),
    ],
    checkpoint: {
      kind: 'approval_waiting',
      transcript,
      turnIndex: 1,
      executionPosition: 'approval',
      nextTurnIndex: 1,
      resumeState: {
        kind: 'approval',
        turnIndex: 1,
        approvalId: 'approval-recovery',
        toolExecutionId: 'tool-execution-recovery',
      },
      harnessProtocolVersion: 2,
      checkpointSchemaVersion: 3,
      configFingerprint: 'approval-recovery-config',
    },
    lease: leaseGuard,
    now: '2026-08-01T00:00:02.000Z',
  });
  const snapshot = await readRecoverySnapshot(
    store,
    lease,
    query,
    '2026-08-01T00:00:03.000Z',
  );
  return { query, snapshot, lease };
}

async function readRecoverySnapshot(
  store: AgentRuntimeStore,
  lease: AgentRunExecutionLease,
  query: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly taskId: string;
    readonly runId: string;
  },
  now: string,
): Promise<AgentRunRecoverySnapshot> {
  return store.readRecoverySnapshot({
    ...query,
    ownerId: lease.ownerId,
    leaseToken: lease.leaseToken,
    fencingToken: lease.fencingToken,
    now,
  });
}

function recoveryPlan(snapshot: AgentRunRecoverySnapshot) {
  return planAgentRunRecovery(snapshot, {
    harnessProtocolVersion: 2,
    checkpointSchemaVersion: 3,
    configFingerprint: 'approval-recovery-config',
  });
}

function approvalTool(
  invoked: (context: AgentToolExecutionContext) => void,
): AgentTool {
  return Object.freeze({
    definition: Object.freeze({
      name: 'publish-story',
      inputSchema: Object.freeze({
        type: 'object' as const,
        properties: Object.freeze({
          title: Object.freeze({ type: 'string' }),
        }),
        required: Object.freeze(['title']),
        additionalProperties: false,
      }),
    }),
    execution: Object.freeze({
      sideEffect: 'external' as const,
      idempotency: 'keyed' as const,
      timeoutMs: 30_000,
    }),
    async execute(_arguments, context) {
      invoked(context);
      return Object.freeze({
        content: Object.freeze([
          Object.freeze({ type: 'text' as const, text: 'published' }),
        ]),
      });
    },
  });
}

function toolCall(): ToolCallContent {
  return Object.freeze({
    type: 'tool_call' as const,
    id: 'tool-call-recovery',
    name: 'publish-story',
    rawArguments: '{"title":"Recovery Story"}',
  });
}

function userMessage(): Message {
  return Object.freeze({
    role: 'user' as const,
    content: Object.freeze([
      Object.freeze({ type: 'text' as const, text: 'publish the story' }),
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
    eventId: `event-approval-existing-${sequence}`,
    turnId: sequence === 1 ? undefined : 'turn-approval-recovery',
    turnIndex: sequence === 1 ? undefined : 1,
    sequence,
    occurredAt: '2026-08-01T00:00:01.000Z',
    payload,
  } as Parameters<AgentRuntimeStore['commitTask']>[0]['events'] extends
    readonly (infer TEvent)[] | undefined
    ? TEvent
    : never;
}

class ManualAgentTimer implements AgentTimer {
  private readonly scheduled: Array<{
    readonly delayMs: number;
    readonly callback: () => void;
    active: boolean;
  }> = [];

  schedule(delayMs: number, callback: () => void): () => void {
    const entry = { delayMs, callback, active: true };
    this.scheduled.push(entry);
    return () => {
      entry.active = false;
    };
  }

  async waitUntilScheduled(delayMs: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        this.scheduled.some(
          (entry) => entry.active && entry.delayMs === delayMs,
        )
      )
        return;
      await Promise.resolve();
    }
    throw new TypeError(`Timer ${delayMs}ms was not scheduled`);
  }

  runNext(delayMs: number): void {
    const entry = this.scheduled.find(
      (candidate) => candidate.active && candidate.delayMs === delayMs,
    );
    if (!entry) throw new TypeError(`Timer ${delayMs}ms is not available`);
    entry.active = false;
    entry.callback();
  }
}
