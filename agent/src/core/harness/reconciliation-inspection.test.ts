import { createFauxProvider, fauxTextResponse } from '@duoduo/ai/testing';
import { describe, expect, it } from 'vitest';

import type { AgentTool } from '../types.js';
import { planAgentRunRecovery } from './recovery-plan.js';
import { createAgentRecoveryWorker } from './create-agent-recovery-worker.js';
import { createAgentHarness } from './create-agent-harness.js';
import { createInMemoryAgentRuntimeStore } from './in-memory-state.js';
import { resumeAgentReconciliationRun } from './resume-reconciliation-run.js';
import { hashRuntimeCommit } from './commit-hash.js';
import type { AgentRuntimeStore } from './runtime-store.js';

describe('Agent reconciliation inspection', () => {
  it('records explicit safe observations without changing the waiting Run', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const fixture = await waitingReconciliationFixture(store);
    const provider = createFauxProvider({
      initialResponses: [fauxTextResponse('unused')],
    });
    let inspections = 0;
    let observedCorrelationReference: string | undefined;
    const tool: AgentTool = {
      definition: {
        name: 'payment-submit',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      execution: {
        sideEffect: 'external',
        idempotency: 'keyed',
        timeoutMs: 30_000,
      },
      reconciliation: {
        adapterId: 'payments-ledger',
        version: '1',
        async inspect(context) {
          inspections += 1;
          observedCorrelationReference = context.correlationReference;
          if (inspections === 2)
            throw new Error('upstream response includes private-secret');
          return {
            outcome: 'applied',
            reasonCode: 'PAYMENT_FOUND',
            presentation: {
              title: 'Payment found',
              fields: [{ label: 'Status', value: 'Applied' }],
            },
          };
        },
      },
      async execute() {
        throw new TypeError('Tool execution is not expected during inspection');
      },
    };
    const harness = await createAgentHarness({
      providers: [provider.provider],
      model: { ref: provider.modelRef, scope: {} },
      runtimeStore: store,
      tools: [tool],
      clock: { now: () => '2026-08-02T00:00:10.000Z' },
    });

    try {
      const taskBefore = await store.getTask(fixture.query);
      expect(inspections).toBe(0);
      await expect(
        harness.readReconciliationCases(fixture.query),
      ).resolves.toMatchObject([
        {
          reconciliationCaseId: fixture.reconciliationCaseId,
          toolName: 'payment-submit',
          attemptId: 'tool-attempt-reconciliation',
          status: 'waiting',
        },
      ]);

      const first = await harness.inspectReconciliation({
        ...fixture.query,
        reconciliationCaseId: fixture.reconciliationCaseId,
      });
      const second = await harness.inspectReconciliation({
        ...fixture.query,
        reconciliationCaseId: fixture.reconciliationCaseId,
      });

      expect(inspections).toBe(2);
      expect(observedCorrelationReference).toBe('private-correlation-key');
      expect(first).toMatchObject({
        sequence: 1,
        outcome: 'applied',
        reasonCode: 'PAYMENT_FOUND',
        adapterId: 'payments-ledger',
        adapterVersion: '1',
        presentation: { title: 'Payment found' },
      });
      expect(second).toMatchObject({
        sequence: 2,
        outcome: 'failed',
        reasonCode: 'INSPECTION_FAILED',
        adapterId: 'payments-ledger',
        adapterVersion: '1',
        presentation: { title: 'Inspection failed' },
      });
      await expect(store.getTask(fixture.query)).resolves.toEqual(taskBefore);

      const firstPage = await harness.readReconciliationObservations({
        ...fixture.query,
        reconciliationCaseId: fixture.reconciliationCaseId,
        limit: 1,
      });
      const secondPage = await harness.readReconciliationObservations({
        ...fixture.query,
        reconciliationCaseId: fixture.reconciliationCaseId,
        limit: 1,
        after: firstPage.nextCursor,
      });
      expect(firstPage).toMatchObject({
        hasMore: true,
        observations: [{ sequence: 1, outcome: 'applied' }],
      });
      expect(secondPage).toMatchObject({
        hasMore: false,
        observations: [{ sequence: 2, outcome: 'failed' }],
      });
      await expect(
        harness.readReconciliationObservations({
          ...fixture.query,
          projectId: 'project-reconciliation-foreign',
          reconciliationCaseId: fixture.reconciliationCaseId,
          after: firstPage.nextCursor,
        }),
      ).rejects.toMatchObject({ code: 'AGENT_RUN_NOT_FOUND' });
      expect(
        JSON.stringify({ first, second, firstPage, secondPage }),
      ).not.toContain('private-correlation-key');
      expect(
        JSON.stringify({ first, second, firstPage, secondPage }),
      ).not.toContain('private-secret');
    } finally {
      await harness.dispose();
      await store.dispose();
    }
  });

  it('accepts one replayable Resolution and preserves it when cancellation closes the wait', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const fixture = await waitingReconciliationFixture(store);
    const provider = createFauxProvider({
      initialResponses: [fauxTextResponse('unused')],
    });
    let id = 0;
    const harness = await createAgentHarness({
      providers: [provider.provider],
      model: { ref: provider.modelRef, scope: {} },
      runtimeStore: store,
      clock: { now: () => '2026-08-02T00:00:10.000Z' },
      ids: { next: (kind) => `${kind}-${++id}` },
    });
    const decision = {
      ...fixture.query,
      reconciliationCaseId: fixture.reconciliationCaseId,
      resolutionId: 'resolution-1',
      resolution: 'confirmed_applied' as const,
      resolvedBy: 'operator-1',
      reasonCode: 'HUMAN_CONFIRMED',
      presentation: { title: 'Payment confirmed' },
    };

    try {
      const first = await harness.decideReconciliation(decision);
      const replay = await harness.decideReconciliation(decision);
      expect(first).toMatchObject({
        status: 'resolved',
        resolutionId: 'resolution-1',
        resolution: 'confirmed_applied',
        resolvedBy: 'operator-1',
        resolutionReasonCode: 'HUMAN_CONFIRMED',
        resolutionPresentation: { title: 'Payment confirmed' },
        resolvedAt: '2026-08-02T00:00:10.000Z',
      });
      expect(replay).toEqual(first);
      await expect(
        harness.decideReconciliation({
          ...decision,
          resolutionId: 'resolution-2',
          resolution: 'abandoned',
        }),
      ).rejects.toMatchObject({
        code: 'AGENT_RECONCILIATION_ALREADY_RESOLVED',
      });

      await harness.cancelTask({
        tenantId: fixture.query.tenantId,
        projectId: fixture.query.projectId,
        taskId: fixture.query.taskId,
      });

      await expect(store.getTask(fixture.query)).resolves.toMatchObject({
        status: 'cancelled',
        activeRunId: undefined,
        runs: [
          {
            runId: fixture.query.runId,
            status: 'cancelled',
            turns: [{ status: 'cancelled' }],
          },
        ],
      });
      await expect(
        harness.readReconciliationCases(fixture.query),
      ).resolves.toMatchObject([
        {
          reconciliationCaseId: fixture.reconciliationCaseId,
          status: 'cancelled',
          resolutionId: 'resolution-1',
          resolution: 'confirmed_applied',
          resolvedBy: 'operator-1',
          cancelledAt: '2026-08-02T00:00:10.000Z',
        },
      ]);
      await expect(
        harness.decideReconciliation(decision),
      ).resolves.toMatchObject({
        status: 'cancelled',
        resolutionId: first.resolutionId,
        resolution: first.resolution,
        resolvedBy: first.resolvedBy,
      });
      await expect(
        harness.decideReconciliation({
          ...decision,
          resolutionId: 'resolution-3',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_RECONCILIATION_CANCELLED' });
    } finally {
      await harness.dispose();
      await store.dispose();
    }
  });

  it('claims only a resolved Case and consumes it once without rewriting the unknown ledger', async () => {
    const store = createInMemoryAgentRuntimeStore();
    const fixture = await waitingReconciliationFixture(store);
    const provider = createFauxProvider({
      initialResponses: [fauxTextResponse('unused')],
    });
    let id = 0;
    const harness = await createAgentHarness({
      providers: [provider.provider],
      model: { ref: provider.modelRef, scope: {} },
      runtimeStore: store,
      clock: { now: () => '2026-08-02T00:00:10.000Z' },
      ids: { next: (kind) => `${kind}-${++id}` },
    });
    const claim = {
      ownerId: 'reconciliation-recovery-worker',
      configFingerprint: 'reconciliation-inspection-config',
      limit: 1,
      now: '2026-08-02T00:02:00.000Z',
      leaseExpiresAt: '2026-08-02T00:03:00.000Z',
    };

    try {
      await expect(
        store.claimRecoverableRuns({ ...claim, claimId: 'unresolved-claim' }),
      ).resolves.toMatchObject({ leases: [] });
      await harness.decideReconciliation({
        ...fixture.query,
        reconciliationCaseId: fixture.reconciliationCaseId,
        resolutionId: 'resolution-consume-1',
        resolution: 'confirmed_applied',
        resolvedBy: 'operator-consume-1',
      });
      const claimed = await store.claimRecoverableRuns({
        ...claim,
        claimId: 'resolved-claim',
      });
      const lease = claimed.leases[0];
      if (!lease) throw new TypeError('Expected resolved reconciliation claim');
      const snapshot = await store.readRecoverySnapshot({
        ...fixture.query,
        ownerId: lease.ownerId,
        leaseToken: lease.leaseToken,
        fencingToken: lease.fencingToken,
        now: claim.now,
      });
      const plan = planAgentRunRecovery(snapshot, {
        harnessProtocolVersion: 2,
        checkpointSchemaVersion: 3,
        configFingerprint: claim.configFingerprint,
      });
      if (plan.kind !== 'consume_reconciliation')
        throw new TypeError('Expected reconciliation consumption plan');

      const result = await resumeAgentReconciliationRun({
        runtimeStore: store,
        snapshot,
        lease,
        plan,
        recoveryId: 'reconciliation-consume-recovery',
        ids: { next: (kind) => `consume-${kind}-${++id}` },
        clock: { now: () => '2026-08-02T00:02:01.000Z' },
      });
      expect(result.plan).toEqual({ kind: 'continue_model', nextTurnIndex: 2 });
      await expect(store.getTask(fixture.query)).resolves.toMatchObject({
        status: 'running',
        runs: [{ status: 'running', turns: [{ status: 'completed' }] }],
      });
      await expect(
        harness.readReconciliationCases(fixture.query),
      ).resolves.toMatchObject([
        {
          reconciliationCaseId: fixture.reconciliationCaseId,
          status: 'consumed',
          resolutionId: 'resolution-consume-1',
          consumeId: expect.any(String),
          consumedAt: '2026-08-02T00:02:01.000Z',
        },
      ]);
      await expect(
        store.readToolExecutions(fixture.query),
      ).resolves.toMatchObject([
        {
          toolExecutionId: 'tool-execution-reconciliation',
          status: 'unknown',
          effectOutcome: 'unknown',
          attempts: [
            {
              attemptId: 'tool-attempt-reconciliation',
              status: 'unknown',
              effectOutcome: 'unknown',
            },
          ],
        },
      ]);
      const checkpoint = await store.getCheckpoint(fixture.query);
      expect(checkpoint).toMatchObject({
        kind: 'tool_result_appended',
        resumeState: { kind: 'model', nextTurnIndex: 2 },
        transcript: [
          expect.objectContaining({ role: 'assistant' }),
          {
            role: 'tool_result',
            isError: false,
            content: [
              { type: 'text', text: 'External action confirmed applied' },
            ],
          },
        ],
      });
      const eventsBeforeReplay = await store.readEvents({
        ...fixture.query,
        afterSequence: 0,
        limit: 100,
      });
      await expect(
        resumeAgentReconciliationRun({
          runtimeStore: store,
          snapshot,
          lease,
          plan,
          recoveryId: 'reconciliation-consume-replay',
          ids: { next: (kind) => `replay-${kind}-${++id}` },
          clock: { now: () => '2026-08-02T00:02:02.000Z' },
        }),
      ).resolves.toEqual({
        plan: { kind: 'continue_model', nextTurnIndex: 2 },
      });
      await expect(
        store.readEvents({ ...fixture.query, afterSequence: 0, limit: 100 }),
      ).resolves.toEqual(eventsBeforeReplay);
    } finally {
      await harness.dispose();
      await store.dispose();
    }
  });

  it.each([
    ['confirmed_not_applied', true, 'External action confirmed not applied'],
    ['confirmed_compensated', true, 'External action was compensated'],
    [
      'abandoned',
      true,
      'External action could not be confirmed and was abandoned',
    ],
  ] as const)(
    'maps %s to a generic reconciliation ToolResult',
    async (resolution, isError, text) => {
      const store = createInMemoryAgentRuntimeStore();
      const fixture = await waitingReconciliationFixture(store);
      const provider = createFauxProvider({
        initialResponses: [fauxTextResponse('unused')],
      });
      let id = 0;
      const harness = await createAgentHarness({
        providers: [provider.provider],
        model: { ref: provider.modelRef, scope: {} },
        runtimeStore: store,
        clock: { now: () => '2026-08-02T00:00:10.000Z' },
        ids: { next: (kind) => `${kind}-${++id}` },
      });

      try {
        await harness.decideReconciliation({
          ...fixture.query,
          reconciliationCaseId: fixture.reconciliationCaseId,
          resolutionId: `resolution-${resolution}`,
          resolution,
          resolvedBy: 'operator-result-map',
        });
        const claimed = await store.claimRecoverableRuns({
          claimId: `claim-${resolution}`,
          ownerId: 'result-map-worker',
          configFingerprint: 'reconciliation-inspection-config',
          limit: 1,
          now: '2026-08-02T00:02:00.000Z',
          leaseExpiresAt: '2026-08-02T00:03:00.000Z',
        });
        const lease = claimed.leases[0];
        if (!lease)
          throw new TypeError('Expected resolved reconciliation claim');
        const snapshot = await store.readRecoverySnapshot({
          ...fixture.query,
          ownerId: lease.ownerId,
          leaseToken: lease.leaseToken,
          fencingToken: lease.fencingToken,
          now: '2026-08-02T00:02:00.000Z',
        });
        const plan = planAgentRunRecovery(snapshot, {
          harnessProtocolVersion: 2,
          checkpointSchemaVersion: 3,
          configFingerprint: 'reconciliation-inspection-config',
        });
        if (plan.kind !== 'consume_reconciliation')
          throw new TypeError('Expected reconciliation consumption plan');
        await resumeAgentReconciliationRun({
          runtimeStore: store,
          snapshot,
          lease,
          plan,
          recoveryId: `consume-${resolution}`,
          ids: { next: (kind) => `map-${kind}-${++id}` },
          clock: { now: () => '2026-08-02T00:02:01.000Z' },
        });
        const checkpoint = await store.getCheckpoint(fixture.query);
        expect(checkpoint?.transcript.at(-1)).toEqual({
          role: 'tool_result',
          toolCallId: 'tool-call-reconciliation',
          toolName: 'payment-submit',
          isError,
          content: [{ type: 'text', text }],
        });
      } finally {
        await harness.dispose();
        await store.dispose();
      }
    },
  );

  it('has a compatible Worker consume a resolved Case and resume the model exactly once', async () => {
    const baseStore = createInMemoryAgentRuntimeStore();
    const store = asDurableStore(baseStore);
    const provider = createFauxProvider({
      initialResponses: [
        fauxTextResponse('seed complete'),
        fauxTextResponse('continued after reconciliation'),
      ],
    });
    const harness = await createAgentHarness({
      providers: [provider.provider],
      model: { ref: provider.modelRef, scope: {} },
      runtimeStore: store,
      clock: { now: () => '2026-08-02T00:00:00.000Z' },
    });
    const seed = await harness.startTask({
      scope: {
        tenantId: 'tenant-reconciliation-seed',
        projectId: 'project-reconciliation-seed',
      },
      input: 'seed compatible configuration',
    });

    try {
      await seed.result();
      const seedCheckpoint = await store.getCheckpoint({
        tenantId: 'tenant-reconciliation-seed',
        projectId: 'project-reconciliation-seed',
        taskId: seed.taskId,
        runId: seed.runId,
      });
      if (!seedCheckpoint)
        throw new TypeError('Expected compatible recovery checkpoint');
      const fixture = await waitingReconciliationFixture(
        baseStore,
        seedCheckpoint.configFingerprint,
      );
      await harness.decideReconciliation({
        ...fixture.query,
        reconciliationCaseId: fixture.reconciliationCaseId,
        resolutionId: 'worker-resolution-1',
        resolution: 'confirmed_not_applied',
        resolvedBy: 'operator-worker-1',
      });
      const worker = await createAgentRecoveryWorker({
        providers: [provider.provider],
        model: { ref: provider.modelRef, scope: {} },
        runtimeStore: store,
        workerId: 'reconciliation-worker',
        clock: { now: () => '2026-08-02T00:02:00.000Z' },
      });

      try {
        await expect(worker.recoverOnce()).resolves.toEqual({
          claimed: 1,
          resumed: 1,
          blocked: 0,
          waitingForReconciliation: 0,
        });
        await expect(store.getTask(fixture.query)).resolves.toMatchObject({
          status: 'completed',
          runs: [{ status: 'completed' }],
        });
        await expect(
          harness.readReconciliationCases(fixture.query),
        ).resolves.toMatchObject([
          {
            reconciliationCaseId: fixture.reconciliationCaseId,
            status: 'consumed',
            resolution: 'confirmed_not_applied',
          },
        ]);
        await expect(
          store.readToolExecutions(fixture.query),
        ).resolves.toMatchObject([
          {
            status: 'unknown',
            effectOutcome: 'unknown',
            attempts: [{ status: 'unknown', effectOutcome: 'unknown' }],
          },
        ]);
        const events = await store.readEvents({
          ...fixture.query,
          afterSequence: 0,
          limit: 100,
        });
        expect(
          events.events.find(
            (event) =>
              event.payload.type === 'tool_execution_end' &&
              event.payload.toolExecutionId === 'tool-execution-reconciliation',
          ),
        ).toMatchObject({
          payload: {
            type: 'tool_execution_end',
            status: 'unknown',
            effectOutcome: 'unknown',
            result: {
              role: 'tool_result',
              isError: true,
              content: [
                {
                  type: 'text',
                  text: 'External action confirmed not applied',
                },
              ],
            },
          },
        });
        expect(provider.controller.callCount()).toBe(2);
        await expect(worker.recoverOnce()).resolves.toMatchObject({
          claimed: 0,
        });
      } finally {
        await worker.dispose();
      }
    } finally {
      await harness.dispose();
      await baseStore.dispose();
    }
  });
});

async function waitingReconciliationFixture(
  store: ReturnType<typeof createInMemoryAgentRuntimeStore>,
  configFingerprint = 'reconciliation-inspection-config',
): Promise<{
  readonly query: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly taskId: string;
    readonly runId: string;
  };
  readonly reconciliationCaseId: string;
}> {
  const scope = {
    tenantId: 'tenant-reconciliation',
    projectId: 'project-reconciliation',
  };
  const query = {
    ...scope,
    taskId: 'task-reconciliation',
    runId: 'run-reconciliation',
  };
  const reconciliationCaseId = 'reconciliation-case-1';
  const receipt = await store.createTask({
    scope,
    taskId: query.taskId,
    runId: query.runId,
    commitId: 'create-reconciliation',
    checkpoint: {
      kind: 'input_accepted',
      input: 'inspect reconciliation',
      transcript: [],
      executionPosition: 'model',
      nextTurnIndex: 1,
      resumeState: { kind: 'model', nextTurnIndex: 1 },
      harnessProtocolVersion: 2,
      checkpointSchemaVersion: 3,
      configFingerprint,
    },
    initialLease: {
      ownershipId: 'reconciliation-owner',
      ownerId: 'reconciliation-worker',
      leaseExpiresAt: '2026-08-02T00:01:00.000Z',
    },
    now: '2026-08-02T00:00:00.000Z',
  });
  const lease = receipt.lease!;
  await store.commitTask({
    ...query,
    commitId: 'quarantine-reconciliation',
    expectedVersion: receipt.version,
    mutations: [
      { type: 'run_started' },
      { type: 'turn_started', turnId: 'turn-reconciliation', turnIndex: 1 },
      { type: 'reconciliation_wait_started' },
    ],
    toolExecutions: [
      {
        type: 'tool_execution_proposed',
        toolExecutionId: 'tool-execution-reconciliation',
        toolCallId: 'tool-call-reconciliation',
        turnId: 'turn-reconciliation',
        turnIndex: 1,
        proposalSequence: 1,
        toolName: 'payment-submit',
        argumentsDigest: hashRuntimeCommit('{}'),
      },
      {
        type: 'tool_execution_prepared',
        toolExecutionId: 'tool-execution-reconciliation',
        sideEffect: 'external',
        idempotency: 'keyed',
        timeoutMs: 30_000,
        idempotencyKey: 'private-correlation-key',
        deadline: '2026-08-02T00:00:30.000Z',
      },
      {
        type: 'tool_execution_started',
        toolExecutionId: 'tool-execution-reconciliation',
        attemptId: 'tool-attempt-reconciliation',
        attempt: 1,
      },
      {
        type: 'tool_execution_orphan_quarantined',
        toolExecutionId: 'tool-execution-reconciliation',
        attemptId: 'tool-attempt-reconciliation',
        reasonCode: 'OWNER_LEASE_EXPIRED',
      },
    ],
    reconciliations: [
      {
        type: 'reconciliation_case_created',
        reconciliationCaseId,
        toolExecutionId: 'tool-execution-reconciliation',
        attemptId: 'tool-attempt-reconciliation',
        reasonCode: 'EXTERNAL_EFFECT_UNKNOWN',
      },
    ],
    events: [
      {
        eventId: 'event-reconciliation-required',
        tenantId: query.tenantId,
        projectId: query.projectId,
        taskId: query.taskId,
        runId: query.runId,
        turnId: 'turn-reconciliation',
        turnIndex: 1,
        sequence: 1,
        occurredAt: '2026-08-02T00:00:01.000Z',
        payload: {
          type: 'run_reconciliation_required',
          toolCallId: 'tool-call-reconciliation',
          toolExecutionId: 'tool-execution-reconciliation',
          attemptId: 'tool-attempt-reconciliation',
          reasonCode: 'EXTERNAL_EFFECT_UNKNOWN',
        },
      },
    ],
    checkpoint: {
      kind: 'reconciliation_waiting',
      transcript: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_call',
              id: 'tool-call-reconciliation',
              name: 'payment-submit',
              rawArguments: '{}',
            },
          ],
        },
      ],
      turnIndex: 1,
      executionPosition: 'reconciliation',
      nextTurnIndex: 1,
      resumeState: {
        kind: 'reconciliation',
        toolExecutionId: 'tool-execution-reconciliation',
        attemptId: 'tool-attempt-reconciliation',
      },
      harnessProtocolVersion: 2,
      checkpointSchemaVersion: 3,
      configFingerprint,
    },
    lease: {
      leaseToken: lease.leaseToken,
      fencingToken: lease.fencingToken,
    },
    now: '2026-08-02T00:00:01.000Z',
  });
  return { query, reconciliationCaseId };
}

function asDurableStore(base: AgentRuntimeStore): AgentRuntimeStore {
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'durability') return 'durable';
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
