import {
  createFauxProvider,
  fauxTextResponse,
  fauxToolResponse,
} from '@duoduo/ai/testing';
import { describe, expect, it } from 'vitest';

import { createAgentRecoveryWorker } from './create-agent-recovery-worker.js';
import { createAgentHarness } from './create-agent-harness.js';
import { createInMemoryAgentRuntimeStore } from './in-memory-state.js';
import type { AgentRuntimeStore } from './runtime-store.js';
import type { AgentTool } from '../types.js';

describe('createAgentRecoveryWorker', () => {
  it('rejects an ephemeral Runtime Store before claiming work', async () => {
    const fixture = createFauxProvider();
    const store = createInMemoryAgentRuntimeStore();

    try {
      await expect(
        createAgentRecoveryWorker({
          providers: [fixture.provider],
          model: { ref: fixture.modelRef, scope: {} },
          runtimeStore: store,
          workerId: 'recovery-worker-1',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_RECOVERY_UNAVAILABLE' });
    } finally {
      await store.dispose();
    }
  });

  it('claims one interrupted Run and resumes it from its durable model boundary', async () => {
    const originalFixture = createFauxProvider({
      initialResponses: [fauxTextResponse('stale owner', { paceMs: 100 })],
    });
    const recoveryFixture = createFauxProvider({
      initialResponses: [fauxTextResponse('recovered owner')],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const store = asDurableStore(baseStore);
    const original = await createAgentHarness({
      providers: [originalFixture.provider],
      model: { ref: originalFixture.modelRef, scope: {} },
      runtimeStore: store,
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });
    const handle = await original.startTask({
      scope: { tenantId: 'tenant-worker', projectId: 'project-worker' },
      input: 'resume this interrupted Run',
    });
    const query = {
      tenantId: 'tenant-worker',
      projectId: 'project-worker',
      taskId: handle.taskId,
      runId: handle.runId,
    };

    try {
      await waitForEvent(store, query, 'model_start');
      const worker = await createAgentRecoveryWorker({
        providers: [recoveryFixture.provider],
        model: { ref: recoveryFixture.modelRef, scope: {} },
        runtimeStore: store,
        workerId: 'recovery-worker-model',
        clock: { now: () => '2026-08-01T00:00:31.000Z' },
      });

      try {
        await expect(worker.recoverOnce()).resolves.toEqual({
          claimed: 1,
          resumed: 1,
          blocked: 0,
          waitingForReconciliation: 0,
        });
        const [task, events] = await Promise.all([
          store.getTask(query),
          store.readEvents({ ...query, afterSequence: 0, limit: 100 }),
        ]);
        expect(task).toMatchObject({
          status: 'completed',
          runs: [
            {
              status: 'completed',
              turns: [{ turnIndex: 1, status: 'completed' }],
            },
          ],
        });
        expect(
          events.events.filter((event) => event.payload.type === 'run_start'),
        ).toHaveLength(1);
        expect(
          events.events.filter((event) => event.payload.type === 'turn_start'),
        ).toHaveLength(1);
        expect(recoveryFixture.controller.callCount()).toBe(1);
      } finally {
        await worker.dispose();
      }
    } finally {
      await original.dispose();
      await baseStore.dispose();
    }
  });

  it('hands an active durable Run off without fabricating cancellation', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('too late', { paceMs: 100 })],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const store = asDurableStore(baseStore);
    const harness = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: store,
      clock: { now: () => '2026-08-01T00:00:05.000Z' },
    });
    const handle = await harness.startTask({
      scope: { tenantId: 'tenant-handoff', projectId: 'project-handoff' },
      input: 'preserve this Run',
    });
    const query = {
      tenantId: 'tenant-handoff',
      projectId: 'project-handoff',
      taskId: handle.taskId,
      runId: handle.runId,
    };

    try {
      await waitForEvent(store, query, 'model_start');
      const result = handle.result().catch((error: unknown) => error);
      const firstHandoff = harness.handoff();
      expect(harness.handoff()).toBe(firstHandoff);
      expect(harness.dispose()).toBe(firstHandoff);
      await firstHandoff;

      await expect(result).resolves.toMatchObject({
        code: 'AGENT_EXECUTION_OWNERSHIP_LOST',
      });
      const [task, events, audit, checkpoint] = await Promise.all([
        store.getTask(query),
        store.readEvents({ ...query, afterSequence: 0, limit: 100 }),
        store.readRunRecoveryAudit(query),
        store.getCheckpoint(query),
      ]);
      expect(task).toMatchObject({
        status: 'running',
        runs: [{ status: 'running', turns: [{ status: 'running' }] }],
      });
      expect(
        events.events.some((event) => event.payload.type === 'run_end'),
      ).toBe(false);
      expect(audit.at(-1)).toMatchObject({ action: 'handoff' });
      await expect(
        store.claimRecoverableRuns({
          claimId: 'claim-after-handoff',
          ownerId: 'next-worker',
          configFingerprint: checkpoint!.configFingerprint,
          limit: 1,
          now: '2026-08-01T00:00:05.000Z',
          leaseExpiresAt: '2026-08-01T00:00:35.000Z',
        }),
      ).resolves.toMatchObject({ leases: [{ fencingToken: 2 }] });
    } finally {
      await harness.handoff().catch(() => undefined);
      await baseStore.dispose();
    }
  });

  it('processes a bounded claim batch without exceeding recovery concurrency', async () => {
    const originalFixture = createFauxProvider({
      initialResponses: Array.from({ length: 3 }, (_, index) =>
        fauxTextResponse(`stale-${index}`, { paceMs: 200 }),
      ),
    });
    const recoveryFixture = createFauxProvider({
      initialResponses: Array.from({ length: 3 }, (_, index) =>
        fauxTextResponse(`recovered-${index}`, { paceMs: 100 }),
      ),
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const store = asDurableStore(baseStore);
    const original = await createAgentHarness({
      providers: [originalFixture.provider],
      model: { ref: originalFixture.modelRef, scope: {} },
      runtimeStore: store,
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });
    const handles = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        original.startTask({
          scope: { tenantId: 'tenant-batch', projectId: 'project-batch' },
          input: `recover batch ${index}`,
        }),
      ),
    );
    const results = handles.map((handle) =>
      handle.result().catch((error: unknown) => error),
    );

    try {
      await Promise.all(
        handles.map((handle) =>
          waitForEvent(
            store,
            {
              tenantId: 'tenant-batch',
              projectId: 'project-batch',
              taskId: handle.taskId,
              runId: handle.runId,
            },
            'model_start',
          ),
        ),
      );
      const worker = await createAgentRecoveryWorker({
        providers: [recoveryFixture.provider],
        model: { ref: recoveryFixture.modelRef, scope: {} },
        runtimeStore: store,
        workerId: 'recovery-worker-batch',
        clock: { now: () => '2026-08-01T00:00:31.000Z' },
        recovery: { claimBatchSize: 3, concurrency: 2 },
      });

      try {
        const recovery = worker.recoverOnce();
        await waitFor(() => recoveryFixture.controller.callCount() === 2);
        expect(recoveryFixture.controller.callCount()).toBe(2);
        await expect(recovery).resolves.toEqual({
          claimed: 3,
          resumed: 3,
          blocked: 0,
          waitingForReconciliation: 0,
        });
        expect(recoveryFixture.controller.callCount()).toBe(3);
      } finally {
        await worker.dispose();
      }
    } finally {
      await original.dispose();
      await Promise.all(results);
      await baseStore.dispose();
    }
  });

  it('blocks a contradictory recovery snapshot once and excludes it from later scans', async () => {
    const fixture = createFauxProvider({
      initialResponses: [fauxTextResponse('stale', { paceMs: 100 })],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const durable = asDurableStore(baseStore);
    const original = await createAgentHarness({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: durable,
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });
    const handle = await original.startTask({
      scope: { tenantId: 'tenant-block', projectId: 'project-block' },
      input: 'block this invalid recovery state',
    });
    const result = handle.result().catch((error: unknown) => error);
    const query = {
      tenantId: 'tenant-block',
      projectId: 'project-block',
      taskId: handle.taskId,
      runId: handle.runId,
    };

    try {
      await waitForEvent(durable, query, 'model_start');
      const store = withStoreOverrides(durable, {
        readRecoverySnapshot: async (command) => {
          const snapshot = await durable.readRecoverySnapshot(command);
          return Object.freeze({
            ...snapshot,
            checkpoint: Object.freeze({
              ...snapshot.checkpoint,
              resumeState: { kind: 'model' as const, nextTurnIndex: 99 },
            }),
          });
        },
      });
      const worker = await createAgentRecoveryWorker({
        providers: [fixture.provider],
        model: { ref: fixture.modelRef, scope: {} },
        runtimeStore: store,
        workerId: 'recovery-worker-block',
        clock: { now: () => '2026-08-01T00:00:31.000Z' },
      });

      try {
        await expect(worker.recoverOnce()).resolves.toEqual({
          claimed: 1,
          resumed: 0,
          blocked: 1,
          waitingForReconciliation: 0,
        });
        await expect(worker.recoverOnce()).resolves.toEqual({
          claimed: 0,
          resumed: 0,
          blocked: 0,
          waitingForReconciliation: 0,
        });
        const [task, events, audit] = await Promise.all([
          durable.getTask(query),
          durable.readEvents({ ...query, afterSequence: 0, limit: 100 }),
          durable.readRunRecoveryAudit(query),
        ]);
        expect(task).toMatchObject({
          status: 'recovery_blocked',
          runs: [{ status: 'recovery_blocked' }],
        });
        expect(events.events.at(-1)).toMatchObject({
          payload: {
            type: 'run_recovery_blocked',
            reasonCode: 'RECOVERY_TURN_ORDER_INVALID',
          },
        });
        expect(
          audit.filter((entry) => entry.action === 'blocked'),
        ).toHaveLength(1);
      } finally {
        await worker.dispose();
      }
    } finally {
      await original.dispose();
      await result;
      await baseStore.dispose();
    }
  });

  it('releases a transient failure with bounded backoff before reclaiming it', async () => {
    const originalFixture = createFauxProvider({
      initialResponses: [fauxTextResponse('stale', { paceMs: 100 })],
    });
    const recoveryFixture = createFauxProvider({
      initialResponses: [fauxTextResponse('recovered after backoff')],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const durable = asDurableStore(baseStore);
    const original = await createAgentHarness({
      providers: [originalFixture.provider],
      model: { ref: originalFixture.modelRef, scope: {} },
      runtimeStore: durable,
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });
    const handle = await original.startTask({
      scope: { tenantId: 'tenant-backoff', projectId: 'project-backoff' },
      input: 'retry recovery later',
    });
    const result = handle.result().catch((error: unknown) => error);
    const query = {
      tenantId: 'tenant-backoff',
      projectId: 'project-backoff',
      taskId: handle.taskId,
      runId: handle.runId,
    };
    let now = '2026-08-01T00:00:31.000Z';
    let failRead = true;

    try {
      await waitForEvent(durable, query, 'model_start');
      const store = withStoreOverrides(durable, {
        readRecoverySnapshot: async (command) => {
          if (failRead) {
            failRead = false;
            throw new Error('private transient database failure');
          }
          return durable.readRecoverySnapshot(command);
        },
      });
      const worker = await createAgentRecoveryWorker({
        providers: [recoveryFixture.provider],
        model: { ref: recoveryFixture.modelRef, scope: {} },
        runtimeStore: store,
        workerId: 'recovery-worker-backoff',
        clock: { now: () => now },
        recovery: {
          initialBackoffMs: 1_000,
          maxBackoffMs: 8_000,
          jitter: () => 0.5,
        },
      });

      try {
        await expect(worker.recoverOnce()).resolves.toEqual({
          claimed: 1,
          resumed: 0,
          blocked: 0,
          waitingForReconciliation: 0,
        });
        await expect(worker.recoverOnce()).resolves.toMatchObject({
          claimed: 0,
        });
        expect(await durable.readRunRecoveryAudit(query)).toContainEqual(
          expect.objectContaining({
            action: 'released',
            reasonCode: 'RECOVERY_TRANSIENT_FAILURE',
          }),
        );

        now = '2026-08-01T00:00:32.000Z';
        await expect(worker.recoverOnce()).resolves.toEqual({
          claimed: 1,
          resumed: 1,
          blocked: 0,
          waitingForReconciliation: 0,
        });
      } finally {
        await worker.dispose();
      }
    } finally {
      await original.dispose();
      await result;
      await baseStore.dispose();
    }
  });

  it('disposes an active recovery as ownership handoff without cancelling the Run', async () => {
    const originalFixture = createFauxProvider({
      initialResponses: [fauxTextResponse('stale', { paceMs: 100 })],
    });
    const recoveryFixture = createFauxProvider({
      initialResponses: [fauxTextResponse('still running', { paceMs: 200 })],
    });
    const baseStore = createInMemoryAgentRuntimeStore();
    const store = asDurableStore(baseStore);
    const original = await createAgentHarness({
      providers: [originalFixture.provider],
      model: { ref: originalFixture.modelRef, scope: {} },
      runtimeStore: store,
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });
    const handle = await original.startTask({
      scope: { tenantId: 'tenant-dispose', projectId: 'project-dispose' },
      input: 'handoff worker recovery',
    });
    const originalResult = handle.result().catch((error: unknown) => error);
    const query = {
      tenantId: 'tenant-dispose',
      projectId: 'project-dispose',
      taskId: handle.taskId,
      runId: handle.runId,
    };

    try {
      await waitForEvent(store, query, 'model_start');
      const worker = await createAgentRecoveryWorker({
        providers: [recoveryFixture.provider],
        model: { ref: recoveryFixture.modelRef, scope: {} },
        runtimeStore: store,
        workerId: 'recovery-worker-dispose',
        clock: { now: () => '2026-08-01T00:00:31.000Z' },
      });
      const recovery = worker.recoverOnce();
      await waitFor(() => recoveryFixture.controller.callCount() === 1);

      const firstDispose = worker.dispose();
      expect(worker.dispose()).toBe(firstDispose);
      await firstDispose;
      await expect(recovery).resolves.toMatchObject({ claimed: 1, resumed: 0 });

      const [task, events, audit, checkpoint] = await Promise.all([
        store.getTask(query),
        store.readEvents({ ...query, afterSequence: 0, limit: 100 }),
        store.readRunRecoveryAudit(query),
        store.getCheckpoint(query),
      ]);
      expect(task).toMatchObject({
        status: 'running',
        runs: [{ status: 'running' }],
      });
      expect(
        events.events.some((event) => event.payload.type === 'run_end'),
      ).toBe(false);
      expect(audit.at(-1)).toMatchObject({
        action: 'handoff',
        reasonCode: 'WORKER_HANDOFF',
      });
      await expect(
        store.claimRecoverableRuns({
          claimId: 'claim-after-worker-dispose',
          ownerId: 'next-recovery-worker',
          configFingerprint: checkpoint!.configFingerprint,
          limit: 1,
          now: '2026-08-01T00:00:31.000Z',
          leaseExpiresAt: '2026-08-01T00:01:01.000Z',
        }),
      ).resolves.toMatchObject({ leases: [{ fencingToken: 3 }] });
    } finally {
      await original.dispose();
      await originalResult;
      await baseStore.dispose();
    }
  });

  it('starts one idempotent continuous scan loop and stops its timer on dispose', async () => {
    const fixture = createFauxProvider();
    const baseStore = createInMemoryAgentRuntimeStore();
    const durable = asDurableStore(baseStore);
    let claims = 0;
    const store = withStoreOverrides(durable, {
      claimRecoverableRuns: async (command) => {
        claims += 1;
        return durable.claimRecoverableRuns(command);
      },
    });
    const scheduled: Array<{
      delayMs: number;
      callback: () => void;
      cancelled: boolean;
    }> = [];
    const worker = await createAgentRecoveryWorker({
      providers: [fixture.provider],
      model: { ref: fixture.modelRef, scope: {} },
      runtimeStore: store,
      workerId: 'recovery-worker-loop',
      recovery: { scanIntervalMs: 123 },
      timer: {
        schedule(delayMs, callback) {
          const entry = { delayMs, callback, cancelled: false };
          scheduled.push(entry);
          return () => {
            entry.cancelled = true;
          };
        },
      },
    });

    try {
      const firstStart = worker.start();
      expect(worker.start()).toBe(firstStart);
      await firstStart;
      await waitFor(() => scheduled.length === 1);
      expect(claims).toBe(1);
      expect(scheduled[0]).toMatchObject({ delayMs: 123, cancelled: false });

      scheduled[0]!.callback();
      await waitFor(() => claims === 2);
      await waitFor(() => scheduled.length === 2);
      const dispose = worker.dispose();
      expect(worker.dispose()).toBe(dispose);
      await dispose;
      expect(scheduled[1]).toMatchObject({ cancelled: true });
      await expect(worker.recoverOnce()).rejects.toMatchObject({
        code: 'AGENT_DISPOSED',
      });
    } finally {
      await worker.dispose();
      await baseStore.dispose();
    }
  });

  it('persists new ToolExecution and Attempt state proposed after model recovery', async () => {
    const originalFixture = createFauxProvider({
      initialResponses: [fauxTextResponse('stale', { paceMs: 100 })],
    });
    const recoveryFixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'recovered-call-1',
          name: 'lookup',
          rawArguments: '{}',
        }),
        fauxTextResponse('recovered with tool'),
      ],
    });
    let invocations = 0;
    const lookup: AgentTool = {
      definition: {
        name: 'lookup',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: {
        sideEffect: 'none',
        idempotency: 'none',
        timeoutMs: 30_000,
      },
      execute: async () => {
        invocations += 1;
        return { content: [{ type: 'text', text: 'lookup result' }] };
      },
    };
    const baseStore = createInMemoryAgentRuntimeStore();
    const store = asDurableStore(baseStore);
    const original = await createAgentHarness({
      providers: [originalFixture.provider],
      model: { ref: originalFixture.modelRef, scope: {} },
      runtimeStore: store,
      tools: [lookup],
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });
    const handle = await original.startTask({
      scope: { tenantId: 'tenant-new-tool', projectId: 'project-new-tool' },
      input: 'recover and call a tool',
    });
    const originalResult = handle.result().catch((error: unknown) => error);
    const query = {
      tenantId: 'tenant-new-tool',
      projectId: 'project-new-tool',
      taskId: handle.taskId,
      runId: handle.runId,
    };

    try {
      await waitForEvent(store, query, 'model_start');
      const worker = await createAgentRecoveryWorker({
        providers: [recoveryFixture.provider],
        model: { ref: recoveryFixture.modelRef, scope: {} },
        runtimeStore: store,
        workerId: 'recovery-worker-new-tool',
        tools: [lookup],
        clock: { now: () => '2026-08-01T00:00:31.000Z' },
      });

      try {
        await expect(worker.recoverOnce()).resolves.toMatchObject({
          claimed: 1,
          resumed: 1,
        });
        const executions = await store.readToolExecutions(query);
        expect(invocations).toBe(1);
        expect(executions).toMatchObject([
          {
            toolCallId: 'recovered-call-1',
            toolName: 'lookup',
            status: 'succeeded',
            attemptCount: 1,
            attempts: [{ attempt: 1, status: 'succeeded' }],
          },
        ]);
      } finally {
        await worker.dispose();
      }
    } finally {
      await original.dispose();
      await originalResult;
      await baseStore.dispose();
    }
  });

  it('preserves ApprovalPolicy for a new tool proposed after recovery', async () => {
    const originalFixture = createFauxProvider({
      initialResponses: [fauxTextResponse('stale', { paceMs: 100 })],
    });
    const recoveryFixture = createFauxProvider({
      initialResponses: [
        fauxToolResponse({
          id: 'approval-recovered-call',
          name: 'publish',
          rawArguments: '{}',
        }),
        fauxTextResponse('published after approval'),
      ],
    });
    let invocations = 0;
    const publish: AgentTool = {
      definition: {
        name: 'publish',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      execution: {
        sideEffect: 'external',
        idempotency: 'keyed',
        timeoutMs: 30_000,
      },
      execute: async () => {
        invocations += 1;
        return { content: [{ type: 'text', text: 'published' }] };
      },
    };
    const approvalPolicy = {
      policyId: 'recovery-approval-policy',
      version: 'v1',
      evaluate: () => ({
        decision: 'require_approval' as const,
        expiresAt: '2026-08-01T00:02:00.000Z',
        presentation: { title: 'Publish recovered content?' },
      }),
    };
    const baseStore = createInMemoryAgentRuntimeStore();
    const store = asDurableStore(baseStore);
    const original = await createAgentHarness({
      providers: [originalFixture.provider],
      model: { ref: originalFixture.modelRef, scope: {} },
      runtimeStore: store,
      tools: [publish],
      approvalPolicy,
      clock: { now: () => '2026-08-01T00:00:00.000Z' },
    });
    const handle = await original.startTask({
      scope: {
        tenantId: 'tenant-new-approval',
        projectId: 'project-new-approval',
      },
      input: 'recover and request approval',
    });
    const originalResult = handle.result().catch((error: unknown) => error);
    const query = {
      tenantId: 'tenant-new-approval',
      projectId: 'project-new-approval',
      taskId: handle.taskId,
      runId: handle.runId,
    };

    try {
      await waitForEvent(store, query, 'model_start');
      const worker = await createAgentRecoveryWorker({
        providers: [recoveryFixture.provider],
        model: { ref: recoveryFixture.modelRef, scope: {} },
        runtimeStore: store,
        workerId: 'recovery-worker-new-approval',
        tools: [publish],
        approvalPolicy,
        clock: { now: () => '2026-08-01T00:00:31.000Z' },
        timer: {
          schedule(delayMs, callback) {
            if (delayMs !== 1_000) return () => undefined;
            const timeout = setTimeout(callback, 1);
            return () => clearTimeout(timeout);
          },
        },
      });

      try {
        const recovery = worker.recoverOnce();
        await waitFor(async () =>
          (await store.readApprovals(query)).some(
            (approval) => approval.status === 'pending',
          ),
        );
        const approval = (await store.readApprovals(query))[0]!;
        expect(invocations).toBe(0);
        await original.decideApproval({
          ...query,
          approvalId: approval.approvalId,
          decisionId: 'recovery-approval-decision',
          decision: 'approved',
          decidedBy: 'reviewer-1',
        });
        await expect(recovery).resolves.toMatchObject({
          claimed: 1,
          resumed: 1,
        });
        expect(invocations).toBe(1);
        await expect(store.readApprovals(query)).resolves.toMatchObject([
          {
            status: 'approved',
            decisionId: 'recovery-approval-decision',
            consumeId: expect.any(String),
          },
        ]);
      } finally {
        await worker.dispose();
      }
    } finally {
      await original.dispose();
      await originalResult;
      await baseStore.dispose();
    }
  });
});

function asDurableStore(base: AgentRuntimeStore): AgentRuntimeStore {
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'durability') return 'durable';
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function withStoreOverrides(
  base: AgentRuntimeStore,
  overrides: Partial<AgentRuntimeStore>,
): AgentRuntimeStore {
  return new Proxy(base, {
    get(target, property, receiver) {
      const override = overrides[property as keyof AgentRuntimeStore];
      if (override !== undefined)
        return typeof override === 'function'
          ? override.bind(overrides)
          : override;
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function waitForEvent(
  store: AgentRuntimeStore,
  query: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly taskId: string;
    readonly runId: string;
  },
  type: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const events = await store.readEvents({
      ...query,
      afterSequence: 0,
      limit: 100,
    });
    if (events.events.some((event) => event.payload.type === type)) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new TypeError(`Timed out waiting for ${type}`);
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new TypeError('Timed out waiting for condition');
}
