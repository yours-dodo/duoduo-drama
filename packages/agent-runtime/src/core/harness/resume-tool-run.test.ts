import type { Message, ToolCallContent, ToolResultMessage } from '@duoduo/ai';
import { createFauxProvider } from '@duoduo/ai/testing';
import { describe, expect, it } from 'vitest';

import type { AgentTool } from '../types.js';
import { hashRuntimeCommit } from './commit-hash.js';
import { createInMemoryAgentRuntimeStore } from './in-memory-state.js';
import { planAgentRunRecovery } from './recovery-plan.js';
import { resumeAgentToolRun } from './resume-tool-run.js';
import type {
  AgentRunExecutionLease,
  AgentRunRecoverySnapshot,
  AgentRuntimeStore,
} from './runtime-store.js';

describe('resumeAgentToolRun', () => {
  it('skips the terminal prefix and starts only the first prepared execution with stable identity', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const invocations = { completed: 0, prepared: 0, pending: 0 };
    const tools = recoveryTools(invocations);

    try {
      const { snapshot, lease } = await toolRecoveryState(store);
      const plan = planAgentRunRecovery(snapshot, {
        harnessProtocolVersion: 2,
        checkpointSchemaVersion: 3,
        configFingerprint: 'tool-boundary-recovery-config',
      });
      if (plan.kind !== 'continue_tools')
        throw new TypeError('Expected ordered tool recovery');
      let id = 0;

      const result = await resumeAgentToolRun({
        runtimeStore: store,
        snapshot,
        lease,
        plan,
        tools,
        ids: { next: (kind) => `${kind}-recovered-${++id}` },
        clock: { now: () => '2026-08-01T00:00:10.000Z' },
        timer: { schedule: () => () => undefined },
      });

      expect(result).toMatchObject({
        plan: { kind: 'continue_model', nextTurnIndex: 2 },
        toolExecutionId: 'tool-execution-prepared',
        attempt: 1,
      });
      expect(invocations).toEqual({ completed: 0, prepared: 1, pending: 0 });

      const [task, executions, checkpoints, events] = await Promise.all([
        store.getTask(snapshot),
        store.readToolExecutions(snapshot),
        store.readCheckpoints(snapshot),
        store.readEvents({ ...snapshot, afterSequence: 0, limit: 100 }),
      ]);
      expect(task?.runs[0]?.turns).toMatchObject([
        { turnId: 'turn-tool-recovery', turnIndex: 1, status: 'completed' },
      ]);
      expect(executions).toMatchObject([
        {
          toolExecutionId: 'tool-execution-completed',
          status: 'succeeded',
          attemptCount: 1,
        },
        {
          toolExecutionId: 'tool-execution-prepared',
          toolCallId: 'tool-call-prepared',
          idempotencyKey: 'stable-tool-key',
          deadline: '2026-08-01T00:00:40.000Z',
          status: 'succeeded',
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
              attemptId: expect.any(String),
            },
            {
              sequence: 5,
              from: 'running',
              to: 'succeeded',
              attemptId: expect.any(String),
            },
          ],
        },
      ]);
      expect(checkpoints.at(-1)).toMatchObject({
        kind: 'tool_result_appended',
        executionPosition: 'model',
        nextTurnIndex: 2,
        resumeState: { kind: 'model', nextTurnIndex: 2 },
        transcript: [
          { role: 'user' },
          { role: 'assistant' },
          { role: 'tool_result', toolCallId: 'tool-call-completed' },
          { role: 'tool_result', toolCallId: 'tool-call-prepared' },
        ],
      });
      expect(events.events.slice(-3)).toMatchObject([
        {
          sequence: 7,
          payload: {
            type: 'tool_execution_start',
            toolCallId: 'tool-call-prepared',
            toolExecutionId: 'tool-execution-prepared',
            attempt: 1,
          },
        },
        {
          sequence: 8,
          payload: {
            type: 'tool_execution_end',
            toolCallId: 'tool-call-prepared',
            toolExecutionId: 'tool-execution-prepared',
            attempt: 1,
            status: 'succeeded',
          },
        },
        { sequence: 9, payload: { type: 'turn_end' } },
      ]);
      expect(
        events.events.filter(
          (event) =>
            event.payload.type === 'tool_execution_start' &&
            event.payload.toolCallId === 'tool-call-completed',
        ),
      ).toHaveLength(1);
    } finally {
      await store.dispose();
    }
  });

  it('reenters a prepared cursor and leaves every later proposal untouched', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const invocations = { completed: 0, prepared: 0, pending: 0 };

    try {
      const { snapshot, lease } = await toolRecoveryState(store, {
        includePending: true,
        cursor: 2,
      });
      const plan = planAgentRunRecovery(snapshot, {
        harnessProtocolVersion: 2,
        checkpointSchemaVersion: 3,
        configFingerprint: 'tool-boundary-recovery-config',
      });
      if (plan.kind !== 'reprepare_tool')
        throw new TypeError('Expected prepared tool re-entry');
      let id = 0;

      const result = await resumeAgentToolRun({
        runtimeStore: store,
        snapshot,
        lease,
        plan,
        tools: recoveryTools(invocations),
        ids: { next: (kind) => `${kind}-ordered-${++id}` },
        clock: { now: () => '2026-08-01T00:00:10.000Z' },
        timer: { schedule: () => () => undefined },
      });

      expect(result).toMatchObject({
        plan: {
          kind: 'continue_tools',
          turnIndex: 1,
          nextProposalSequence: 3,
        },
        toolExecutionId: 'tool-execution-prepared',
        attempt: 1,
      });
      expect(invocations).toEqual({ completed: 0, prepared: 1, pending: 0 });
      await expect(store.readToolExecutions(snapshot)).resolves.toMatchObject([
        { toolExecutionId: 'tool-execution-completed', attemptCount: 1 },
        { toolExecutionId: 'tool-execution-prepared', attemptCount: 1 },
        {
          toolExecutionId: 'tool-execution-pending',
          status: 'proposed',
          attemptCount: 0,
          attempts: [],
        },
      ]);
      const checkpoints = await store.readCheckpoints(snapshot);
      expect(checkpoints.at(-1)).toMatchObject({
        executionPosition: 'tool',
        nextTurnIndex: 1,
        resumeState: {
          kind: 'tool',
          turnIndex: 1,
          nextProposalSequence: 3,
        },
      });
      await expect(store.getTask(snapshot)).resolves.toMatchObject({
        runs: [{ turns: [{ turnIndex: 1, status: 'running' }] }],
      });
    } finally {
      await store.dispose();
    }
  });

  it('blocks a transcript and Ledger order mismatch before any recovery mutation or invocation', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const invocations = { completed: 0, prepared: 0, pending: 0 };

    try {
      const { snapshot, lease } = await toolRecoveryState(store, {
        corruptAssistantOrder: true,
      });
      const plan = planAgentRunRecovery(snapshot, {
        harnessProtocolVersion: 2,
        checkpointSchemaVersion: 3,
        configFingerprint: 'tool-boundary-recovery-config',
      });
      if (plan.kind !== 'continue_tools')
        throw new TypeError('Expected ordered tool recovery');

      await expect(
        resumeAgentToolRun({
          runtimeStore: store,
          snapshot,
          lease,
          plan,
          tools: recoveryTools(invocations),
          ids: { next: (kind) => `${kind}-must-not-be-used` },
          clock: { now: () => '2026-08-01T00:00:10.000Z' },
          timer: { schedule: () => () => undefined },
        }),
      ).rejects.toThrow('Agent tool recovery Ledger order is invalid');

      expect(invocations).toEqual({ completed: 0, prepared: 0, pending: 0 });
      await expect(store.getTask(snapshot)).resolves.toMatchObject({
        version: snapshot.task.version,
      });
      await expect(store.readToolExecutions(snapshot)).resolves.toMatchObject([
        { toolExecutionId: 'tool-execution-completed', attemptCount: 1 },
        {
          toolExecutionId: 'tool-execution-prepared',
          status: 'prepared',
          attemptCount: 0,
          transitions: [
            { sequence: 1, to: 'proposed' },
            { sequence: 2, from: 'proposed', to: 'prepared' },
          ],
        },
      ]);
    } finally {
      await store.dispose();
    }
  });
});

async function toolRecoveryState(
  store: AgentRuntimeStore,
  options: {
    readonly includePending?: boolean;
    readonly cursor?: 1 | 2;
    readonly corruptAssistantOrder?: boolean;
  } = {},
): Promise<{
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly lease: AgentRunExecutionLease;
}> {
  const scope = {
    tenantId: 'tenant-tool-boundary-recovery',
    projectId: 'project-tool-boundary-recovery',
  };
  const query = {
    ...scope,
    taskId: 'task-tool-boundary-recovery',
    runId: 'run-tool-boundary-recovery',
  };
  const calls = toolCalls(options.includePending ?? false);
  const assistant = assistantToolMessage(
    options.corruptAssistantOrder
      ? Object.freeze([calls[1]!, calls[0]!, ...calls.slice(2)])
      : calls,
  );
  const beforeResult = Object.freeze([userMessage(), assistant]);
  const completedResult = toolResult(calls[0]!, 'already completed');
  const transcript = Object.freeze([...beforeResult, completedResult]);
  let receipt = await store.createTask({
    scope,
    taskId: query.taskId,
    runId: query.runId,
    commitId: 'create-tool-boundary-recovery',
    checkpoint: {
      kind: 'input_accepted',
      input: 'run two tools',
      transcript: [],
      executionPosition: 'model',
      nextTurnIndex: 1,
      resumeState: { kind: 'model', nextTurnIndex: 1 },
      harnessProtocolVersion: 2,
      checkpointSchemaVersion: 3,
      configFingerprint: 'tool-boundary-recovery-config',
    },
    initialLease: {
      ownershipId: 'ownership-tool-boundary-recovery',
      ownerId: 'worker-tool-boundary-recovery',
      leaseExpiresAt: '2026-08-01T00:01:00.000Z',
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
    commitId: 'propose-tool-boundary-recovery',
    expectedVersion: receipt.version,
    mutations: [
      { type: 'run_started' },
      { type: 'turn_started', turnId: 'turn-tool-recovery', turnIndex: 1 },
    ],
    toolExecutions: calls.map((call, index) => ({
      type: 'tool_execution_proposed' as const,
      toolExecutionId:
        index === 0
          ? 'tool-execution-completed'
          : index === 1
            ? 'tool-execution-prepared'
            : 'tool-execution-pending',
      toolCallId: call.id,
      turnId: 'turn-tool-recovery',
      turnIndex: 1,
      proposalSequence: index + 1,
      toolName: call.name,
      argumentsDigest: hashRuntimeCommit(call.rawArguments),
    })),
    events: [
      harnessEvent(query, 1, { type: 'run_start' }),
      harnessEvent(query, 2, { type: 'turn_start' }, 1),
      harnessEvent(
        query,
        3,
        {
          type: 'model_start',
          requestId: 'request-tool-recovery',
          modelAttemptId: 'model-attempt-tool-recovery',
          modelAttempt: 1,
        },
        1,
      ),
      harnessEvent(
        query,
        4,
        {
          type: 'model_end',
          response: assistant,
          modelAttemptId: 'model-attempt-tool-recovery',
          modelAttempt: 1,
        },
        1,
      ),
    ],
    checkpoint: {
      kind: 'model_completed',
      transcript: beforeResult,
      turnIndex: 1,
      executionPosition: 'tool',
      nextTurnIndex: 1,
      resumeState: {
        kind: 'tool',
        turnIndex: 1,
        nextProposalSequence: options.cursor ?? 1,
      },
      harnessProtocolVersion: 2,
      checkpointSchemaVersion: 3,
      configFingerprint: 'tool-boundary-recovery-config',
    },
    lease: leaseGuard,
    now: '2026-08-01T00:00:01.000Z',
  });
  receipt = await store.commitTask({
    ...query,
    commitId: 'prepare-completed-tool-recovery',
    expectedVersion: receipt.version,
    mutations: [],
    toolExecutions: [
      {
        type: 'tool_execution_prepared',
        toolExecutionId: 'tool-execution-completed',
        sideEffect: 'none',
        idempotency: 'none',
        timeoutMs: 30_000,
        deadline: '2026-08-01T00:00:32.000Z',
      },
    ],
    lease: leaseGuard,
    now: '2026-08-01T00:00:02.000Z',
  });
  receipt = await store.commitTask({
    ...query,
    commitId: 'start-completed-tool-recovery',
    expectedVersion: receipt.version,
    mutations: [],
    toolExecutions: [
      {
        type: 'tool_execution_started',
        toolExecutionId: 'tool-execution-completed',
        attemptId: 'tool-attempt-completed',
        attempt: 1,
      },
    ],
    events: [
      harnessEvent(
        query,
        5,
        {
          type: 'tool_execution_start',
          toolCallId: calls[0]!.id,
          toolName: calls[0]!.name,
          toolExecutionId: 'tool-execution-completed',
          attemptId: 'tool-attempt-completed',
          attempt: 1,
        },
        1,
      ),
    ],
    lease: leaseGuard,
    now: '2026-08-01T00:00:03.000Z',
  });
  receipt = await store.commitTask({
    ...query,
    commitId: 'finish-and-prepare-tool-recovery',
    expectedVersion: receipt.version,
    mutations: [],
    toolExecutions: [
      {
        type: 'tool_execution_finished',
        toolExecutionId: 'tool-execution-completed',
        attemptId: 'tool-attempt-completed',
        status: 'succeeded',
        effectOutcome: 'not_applied',
        retryable: false,
        resultDigest: hashRuntimeCommit(completedResult),
      },
      {
        type: 'tool_execution_prepared',
        toolExecutionId: 'tool-execution-prepared',
        sideEffect: 'external',
        idempotency: 'keyed',
        timeoutMs: 30_000,
        idempotencyKey: 'stable-tool-key',
        deadline: '2026-08-01T00:00:34.000Z',
      },
    ],
    events: [
      harnessEvent(
        query,
        6,
        {
          type: 'tool_execution_end',
          toolCallId: calls[0]!.id,
          toolExecutionId: 'tool-execution-completed',
          attemptId: 'tool-attempt-completed',
          attempt: 1,
          status: 'succeeded',
          effectOutcome: 'not_applied',
          result: completedResult,
        },
        1,
      ),
    ],
    checkpoint: {
      kind: 'tool_result_appended',
      transcript,
      turnIndex: 1,
      executionPosition: 'tool',
      nextTurnIndex: 1,
      resumeState: {
        kind: 'tool',
        turnIndex: 1,
        nextProposalSequence: options.cursor ?? 1,
      },
      harnessProtocolVersion: 2,
      checkpointSchemaVersion: 3,
      configFingerprint: 'tool-boundary-recovery-config',
    },
    lease: leaseGuard,
    now: '2026-08-01T00:00:04.000Z',
  });
  const snapshot = await store.readRecoverySnapshot({
    ...query,
    ownerId: lease.ownerId,
    ...leaseGuard,
    now: '2026-08-01T00:00:05.000Z',
  });
  return { snapshot, lease };
}

function recoveryTools(invocations: {
  completed: number;
  prepared: number;
  pending: number;
}): readonly AgentTool[] {
  return Object.freeze([
    tool('completed-tool', 'none', 'none', () => {
      invocations.completed += 1;
      return 'must not run';
    }),
    tool('prepared-tool', 'external', 'keyed', () => {
      invocations.prepared += 1;
      return 'recovered result';
    }),
    tool('pending-tool', 'none', 'none', () => {
      invocations.pending += 1;
      return 'must wait for its turn';
    }),
  ]);
}

function tool(
  name: string,
  sideEffect: 'none' | 'external',
  idempotency: 'none' | 'keyed',
  execute: () => string,
): AgentTool {
  return Object.freeze({
    definition: Object.freeze({
      name,
      inputSchema: Object.freeze({
        type: 'object' as const,
        properties: Object.freeze({ value: Object.freeze({ type: 'number' }) }),
        required: Object.freeze(['value']),
        additionalProperties: false,
      }),
    }),
    execution: Object.freeze({ sideEffect, idempotency, timeoutMs: 30_000 }),
    async execute() {
      return Object.freeze({
        content: Object.freeze([
          Object.freeze({ type: 'text' as const, text: execute() }),
        ]),
      });
    },
  });
}

function toolCalls(includePending: boolean): readonly ToolCallContent[] {
  const calls: ToolCallContent[] = [
    Object.freeze({
      type: 'tool_call' as const,
      id: 'tool-call-completed',
      name: 'completed-tool',
      rawArguments: '{"value":1}',
    }),
    Object.freeze({
      type: 'tool_call' as const,
      id: 'tool-call-prepared',
      name: 'prepared-tool',
      rawArguments: '{"value":2}',
    }),
  ];
  if (includePending)
    calls.push(
      Object.freeze({
        type: 'tool_call' as const,
        id: 'tool-call-pending',
        name: 'pending-tool',
        rawArguments: '{"value":3}',
      }),
    );
  return Object.freeze(calls);
}

function userMessage(): Message {
  return Object.freeze({
    role: 'user' as const,
    content: Object.freeze([
      Object.freeze({ type: 'text' as const, text: 'run two tools' }),
    ]),
  });
}

function assistantToolMessage(calls: readonly ToolCallContent[]): Message {
  return Object.freeze({
    role: 'assistant' as const,
    content: calls,
    model: createFauxProvider().modelRef,
    status: 'completed' as const,
    finishReason: 'tool_calls' as const,
    partial: false,
  });
}

function toolResult(call: ToolCallContent, text: string): ToolResultMessage {
  return Object.freeze({
    role: 'tool_result' as const,
    toolCallId: call.id,
    toolName: call.name,
    isError: false,
    content: Object.freeze([Object.freeze({ type: 'text' as const, text })]),
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
  turnIndex?: number,
) {
  return {
    ...query,
    eventId: `event-existing-${sequence}`,
    turnId: turnIndex === undefined ? undefined : 'turn-tool-recovery',
    turnIndex,
    sequence,
    occurredAt: '2026-08-01T00:00:01.000Z',
    payload,
  } as Parameters<AgentRuntimeStore['commitTask']>[0]['events'] extends
    readonly (infer TEvent)[] | undefined
    ? TEvent
    : never;
}
