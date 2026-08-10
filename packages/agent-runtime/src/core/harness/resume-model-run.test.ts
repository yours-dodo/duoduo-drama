import { createAi, type Message } from '@duoduo/ai';
import { createFauxProvider, fauxTextResponse } from '@duoduo/ai/testing';
import { describe, expect, it } from 'vitest';

import { createInMemoryAgentRuntimeStore } from './in-memory-state.js';
import { planAgentRunRecovery } from './recovery-plan.js';
import { resumeAgentModelRun } from './resume-model-run.js';
import type {
  AgentRunExecutionLease,
  AgentRunRecoverySnapshot,
  AgentRuntimeStore,
} from './runtime-store.js';
import { createEphemeralToolExecutionCoordinator } from '../tool-execution.js';

describe('resumeAgentModelRun', () => {
  it('continues after a completed Turn with no duplicate Provider call, Run start, or Turn row', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('second turn answer')],
    });
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const store = createInMemoryAgentRuntimeStore();

    try {
      const { snapshot, lease } = await recoveryState(store, {
        completedTurn: true,
        modelRef: fixture.modelRef,
      });
      const plan = planAgentRunRecovery(snapshot, recoveryCompatibility());
      if (plan.kind !== 'continue_model')
        throw new TypeError('Expected a model recovery plan');
      let id = 0;

      await resumeAgentModelRun({
        ai,
        model,
        runtimeStore: store,
        snapshot,
        lease,
        plan,
        ids: { next: (kind) => `${kind}-recovered-${++id}` },
        clock: { now: () => '2026-08-01T00:00:10.000Z' },
        toolExecutionCoordinator: createEphemeralToolExecutionCoordinator(),
      });

      const task = await store.getTask(snapshot);
      const events = await store.readEvents({
        ...snapshot,
        afterSequence: 0,
        limit: 100,
      });
      expect(fixture.controller.callCount()).toBe(1);
      expect(fixture.controller.calls()[0]?.context.messages).toEqual(
        snapshot.checkpoint.transcript,
      );
      expect(task).toMatchObject({
        status: 'completed',
        runs: [
          {
            status: 'completed',
            turns: [
              { turnIndex: 1, status: 'completed' },
              { turnIndex: 2, status: 'completed' },
            ],
          },
        ],
      });
      expect(
        events.events.filter((event) => event.payload.type === 'run_start'),
      ).toHaveLength(1);
      expect(
        events.events.filter((event) => event.payload.type === 'turn_start'),
      ).toHaveLength(2);
      expect(events.events.map((event) => event.sequence)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
      ]);
      expect(events.events[6]).toMatchObject({
        sequence: 7,
        turnIndex: 2,
        payload: {
          type: 'model_start',
          modelAttempt: 1,
          modelAttemptId: expect.any(String),
        },
      });
    } finally {
      await store.dispose();
      await ai.dispose();
    }
  });

  it('reenters one interrupted Turn as Attempt 2 without adding a Turn row', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('recovered interrupted turn')],
    });
    const ai = createAi();
    ai.providers.register(fixture.provider);
    const model = await ai.models.require(fixture.modelRef, {});
    const store = createInMemoryAgentRuntimeStore();

    try {
      const { snapshot, lease } = await recoveryState(store, {
        completedTurn: false,
        modelRef: fixture.modelRef,
      });
      const plan = planAgentRunRecovery(snapshot, recoveryCompatibility());
      if (plan.kind !== 'continue_model')
        throw new TypeError('Expected a model recovery plan');
      let id = 0;

      await resumeAgentModelRun({
        ai,
        model,
        runtimeStore: store,
        snapshot,
        lease,
        plan,
        ids: { next: (kind) => `${kind}-retry-${++id}` },
        clock: { now: () => '2026-08-01T00:00:10.000Z' },
        toolExecutionCoordinator: createEphemeralToolExecutionCoordinator(),
      });

      const task = await store.getTask(snapshot);
      const events = await store.readEvents({
        ...snapshot,
        afterSequence: 0,
        limit: 100,
      });
      expect(fixture.controller.callCount()).toBe(1);
      expect(fixture.controller.calls()[0]?.context.messages).toMatchObject([
        {
          role: 'user',
          content: [{ type: 'text', text: 'original prompt' }],
        },
      ]);
      expect(task?.runs[0]?.turns).toMatchObject([
        { turnIndex: 1, status: 'completed' },
      ]);
      expect(
        events.events.filter((event) => event.payload.type === 'turn_start'),
      ).toHaveLength(1);
      expect(events.events[4]).toMatchObject({
        sequence: 5,
        turnIndex: 1,
        payload: {
          type: 'model_start',
          modelAttempt: 2,
          modelAttemptId: expect.any(String),
        },
      });
      expect(events.events.slice(2, 4)).toMatchObject([
        { payload: { modelAttemptId: 'model-attempt-1', modelAttempt: 1 } },
        { payload: { modelAttemptId: 'model-attempt-1', modelAttempt: 1 } },
      ]);
      expect(events.events.slice(4, 7)).toMatchObject([
        { payload: { modelAttempt: 2 } },
        { payload: { modelAttempt: 2 } },
        { payload: { modelAttempt: 2 } },
      ]);
    } finally {
      await store.dispose();
      await ai.dispose();
    }
  });
});

async function recoveryState(
  store: AgentRuntimeStore,
  input: {
    readonly completedTurn: boolean;
    readonly modelRef: ReturnType<typeof createFauxProvider>['modelRef'];
  },
): Promise<{
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly lease: AgentRunExecutionLease;
}> {
  const scope = {
    tenantId: 'tenant-model-recovery',
    projectId: 'project-model-recovery',
  };
  const query = {
    ...scope,
    taskId: input.completedTurn ? 'task-completed-turn' : 'task-running-turn',
    runId: input.completedTurn ? 'run-completed-turn' : 'run-running-turn',
  };
  const transcript = input.completedTurn
    ? completedTranscript(input.modelRef)
    : Object.freeze([]);
  const created = await store.createTask({
    scope,
    taskId: query.taskId,
    runId: query.runId,
    commitId: `create-${query.runId}`,
    checkpoint: {
      kind: 'input_accepted',
      input: 'original prompt',
      transcript: [],
      executionPosition: 'model',
      nextTurnIndex: 1,
      resumeState: { kind: 'model', nextTurnIndex: 1 },
      harnessProtocolVersion: 2,
      checkpointSchemaVersion: 3,
      configFingerprint: 'model-recovery-config',
    },
    initialLease: {
      ownershipId: `ownership-${query.runId}`,
      ownerId: 'worker-model-recovery',
      leaseExpiresAt: '2026-08-01T00:01:00.000Z',
    },
    now: '2026-08-01T00:00:00.000Z',
  });
  const lease = created.lease!;
  const baseEvents = [
    harnessEvent(query, 1, { type: 'run_start' }),
    harnessEvent(query, 2, { type: 'turn_start' }, 1, 'turn-1'),
    harnessEvent(
      query,
      3,
      {
        type: 'model_start',
        requestId: 'request-attempt-1',
        modelAttemptId: 'model-attempt-1',
        modelAttempt: 1,
      },
      1,
      'turn-1',
    ),
  ];
  const events = input.completedTurn
    ? [
        ...baseEvents,
        harnessEvent(query, 4, { type: 'model_end' }, 1, 'turn-1'),
        harnessEvent(query, 5, { type: 'turn_end' }, 1, 'turn-1'),
      ]
    : [
        ...baseEvents,
        harnessEvent(
          query,
          4,
          {
            type: 'text_delta',
            itemId: 'partial-item',
            contentIndex: 0,
            delta: 'partial',
            modelAttemptId: 'model-attempt-1',
            modelAttempt: 1,
          },
          1,
          'turn-1',
        ),
      ];
  await store.commitTask({
    ...query,
    commitId: `prepare-${query.runId}`,
    expectedVersion: created.version,
    mutations: [
      { type: 'run_started' },
      { type: 'turn_started', turnId: 'turn-1', turnIndex: 1 },
      ...(input.completedTurn
        ? ([
            {
              type: 'turn_finished',
              turnIndex: 1,
              status: 'completed',
            },
          ] as const)
        : []),
    ],
    events,
    checkpoint: {
      kind: input.completedTurn ? 'tool_result_appended' : 'input_accepted',
      input: input.completedTurn ? undefined : 'original prompt',
      transcript,
      turnIndex: input.completedTurn ? 1 : undefined,
      executionPosition: 'model',
      nextTurnIndex: input.completedTurn ? 2 : 1,
      resumeState: {
        kind: 'model',
        nextTurnIndex: input.completedTurn ? 2 : 1,
      },
      harnessProtocolVersion: 2,
      checkpointSchemaVersion: 3,
      configFingerprint: 'model-recovery-config',
    },
    lease: {
      leaseToken: lease.leaseToken,
      fencingToken: lease.fencingToken,
    },
    now: '2026-08-01T00:00:05.000Z',
  });
  const snapshot = await store.readRecoverySnapshot({
    ...query,
    ownerId: lease.ownerId,
    leaseToken: lease.leaseToken,
    fencingToken: lease.fencingToken,
    now: '2026-08-01T00:00:06.000Z',
  });
  return { snapshot, lease };
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
  turnId?: string,
) {
  return {
    ...query,
    eventId: `event-existing-${sequence}`,
    turnId,
    turnIndex,
    sequence,
    occurredAt: '2026-08-01T00:00:01.000Z',
    payload,
  } as Parameters<AgentRuntimeStore['commitTask']>[0]['events'] extends
    readonly (infer TEvent)[] | undefined
    ? TEvent
    : never;
}

function initialTranscript(): readonly Message[] {
  return Object.freeze([
    Object.freeze({
      role: 'user' as const,
      content: Object.freeze([
        Object.freeze({ type: 'text' as const, text: 'original prompt' }),
      ]),
    }),
  ]);
}

function completedTranscript(
  model: ReturnType<typeof createFauxProvider>['modelRef'],
): readonly Message[] {
  return Object.freeze([
    ...initialTranscript(),
    Object.freeze({
      role: 'assistant' as const,
      content: Object.freeze([
        Object.freeze({ type: 'text' as const, text: 'completed answer' }),
      ]),
      model,
      status: 'completed' as const,
      finishReason: 'stop' as const,
      partial: false as const,
    }),
  ]);
}

function recoveryCompatibility() {
  return {
    harnessProtocolVersion: 2,
    checkpointSchemaVersion: 3,
    configFingerprint: 'model-recovery-config',
  } as const;
}
