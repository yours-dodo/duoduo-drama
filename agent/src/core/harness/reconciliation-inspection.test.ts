import { createFauxProvider, fauxTextResponse } from '@duoduo/ai/testing';
import { describe, expect, it } from 'vitest';

import type { AgentTool } from '../types.js';
import { createAgentHarness } from './create-agent-harness.js';
import { createInMemoryAgentRuntimeStore } from './in-memory-state.js';

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
});

async function waitingReconciliationFixture(
  store: ReturnType<typeof createInMemoryAgentRuntimeStore>,
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
      configFingerprint: 'reconciliation-inspection-config',
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
        argumentsDigest: 'private-arguments-digest',
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
      transcript: [],
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
      configFingerprint: 'reconciliation-inspection-config',
    },
    lease: {
      leaseToken: lease.leaseToken,
      fencingToken: lease.fencingToken,
    },
    now: '2026-08-02T00:00:01.000Z',
  });
  return { query, reconciliationCaseId };
}
