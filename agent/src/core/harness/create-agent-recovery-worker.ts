import { randomUUID } from 'node:crypto';

import type {
  AiRuntime,
  ModelHandle,
  RequestCredentialOverride,
  StreamOptionsInput,
} from '@duoduo/ai';

import { createAgentRuntime } from '../../ai/runtime.js';
import { AgentError } from '../errors.js';
import { assertAgentToolExecutionDeclaration } from '../tool-execution.js';
import type { AgentEvent, AgentRunResult } from '../types.js';
import { hashRuntimeCommit } from './commit-hash.js';
import { planAgentRunRecovery } from './recovery-plan.js';
import { resumeAgentApprovalRun } from './resume-approval-run.js';
import { resumeAgentModelRun } from './resume-model-run.js';
import { resumeAgentOrphanToolRun } from './resume-orphan-tool-run.js';
import { resumeAgentReconciliationRun } from './resume-reconciliation-run.js';
import { resumeAgentToolRun } from './resume-tool-run.js';
import { createRecoveryToolExecutionCoordinator } from './recovery-tool-execution-coordinator.js';
import type {
  AgentRunExecutionLease,
  AgentRunRecoverySnapshot,
  AgentRuntimeCheckpointWrite,
  AgentRuntimeStore,
} from './runtime-store.js';
import { toHarnessPayload, turnStatusForResult } from './runtime-event.js';
import type {
  AgentClock,
  AgentHarnessEvent,
  AgentIdGenerator,
  AgentRecoveryBatchResult,
  AgentRecoveryWorker,
  AgentTimer,
  CreateAgentRecoveryWorkerOptions,
} from './types.js';

type RecoveryDisposition =
  'resumed' | 'blocked' | 'waiting_for_reconciliation' | 'ignored';

interface ActiveRecovery {
  readonly controller: AbortController;
  readonly done: Promise<RecoveryDisposition>;
  handoff(): Promise<void>;
}

export async function createAgentRecoveryWorker<TScopeHandle>(
  options: CreateAgentRecoveryWorkerOptions<TScopeHandle>,
): Promise<AgentRecoveryWorker> {
  assertRecoveryStore(options.runtimeStore);
  assertWorkerOptions(options);
  const ids = options.ids ?? defaultIds;
  const clock = options.clock ?? defaultClock;
  const timer = options.timer ?? defaultTimer;
  const tools = Object.freeze([...(options.tools ?? [])]);
  const leaseDurationMs = options.runLease?.durationMs ?? 30_000;
  const heartbeatIntervalMs = options.runLease?.heartbeatIntervalMs ?? 10_000;
  const scanIntervalMs = options.recovery?.scanIntervalMs ?? 1_000;
  const claimBatchSize = options.recovery?.claimBatchSize ?? 10;
  const concurrency = options.recovery?.concurrency ?? 4;
  const initialBackoffMs = options.recovery?.initialBackoffMs ?? 1_000;
  const maxBackoffMs = options.recovery?.maxBackoffMs ?? 300_000;
  const jitter = options.recovery?.jitter ?? Math.random;
  const toolNames = new Set<string>();
  for (const tool of tools) {
    if (
      tool.definition.name.trim() === '' ||
      toolNames.has(tool.definition.name)
    )
      throw new TypeError('Agent Recovery Worker tool names must be unique');
    assertAgentToolExecutionDeclaration(tool);
    toolNames.add(tool.definition.name);
  }
  if (
    options.approvalPolicy &&
    (options.approvalPolicy.policyId.trim() === '' ||
      options.approvalPolicy.version.trim() === '' ||
      typeof options.approvalPolicy.evaluate !== 'function')
  )
    throw new TypeError('Agent Recovery Worker ApprovalPolicy is invalid');
  const { ai, model } = await createAgentRuntime(options);
  const configFingerprint = hashRuntimeCommit({
    harnessProtocolVersion: HARNESS_PROTOCOL_VERSION,
    checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
    model: model.ref,
    modelIdentity: model.identity,
    systemPrompt: options.systemPrompt,
    tools: tools.map((tool) => tool.definition),
    approvalPolicy: options.approvalPolicy
      ? {
          policyId: options.approvalPolicy.policyId,
          version: options.approvalPolicy.version,
        }
      : undefined,
  });
  const compatibility = Object.freeze({
    harnessProtocolVersion: HARNESS_PROTOCOL_VERSION,
    checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
    configFingerprint,
  });
  const active = new Map<string, ActiveRecovery>();
  const failureCounts = new Map<string, number>();
  const scanController = new AbortController();
  let disposed = false;
  let batchTail: Promise<unknown> = Promise.resolve();
  let startPromise: Promise<void> | undefined;
  let scanLoop: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;

  const runClaimedLease = async (
    initialLease: AgentRunExecutionLease,
  ): Promise<RecoveryDisposition> => {
    const key = runKey(initialLease);
    const controller = new AbortController();
    let lease = initialLease;
    let cancelHeartbeat = (): void => undefined;
    let heartbeatStopped = false;
    let handoffPromise: Promise<void> | undefined;

    const scheduleHeartbeat = (): void => {
      if (heartbeatStopped || controller.signal.aborted) return;
      cancelHeartbeat = timer.schedule(heartbeatIntervalMs, () => {
        void renewLease();
      });
    };
    const renewLease = async (): Promise<void> => {
      if (heartbeatStopped || controller.signal.aborted) return;
      const now = clock.now();
      try {
        lease = await options.runtimeStore.renewRunLease({
          ...scope(lease),
          renewalId: nextId(ids, 'commit'),
          ownerId: lease.ownerId,
          leaseToken: lease.leaseToken,
          fencingToken: lease.fencingToken,
          now,
          leaseExpiresAt: addMilliseconds(now, leaseDurationMs),
        });
        scheduleHeartbeat();
      } catch {
        controller.abort('Agent recovery lease was lost');
      }
    };

    const handoff = (): Promise<void> => {
      if (handoffPromise) return handoffPromise;
      heartbeatStopped = true;
      cancelHeartbeat();
      handoffPromise = releaseLease(
        options.runtimeStore,
        lease,
        ids,
        clock,
        clock.now(),
        'WORKER_HANDOFF',
        'handoff',
      )
        .catch(ignoreLeaseLoss)
        .finally(() =>
          controller.abort('Agent Recovery Worker handed ownership off'),
        );
      return handoffPromise;
    };

    const done = (async (): Promise<RecoveryDisposition> => {
      scheduleHeartbeat();
      try {
        const disposition = await driveRecovery({
          ai,
          model,
          runtimeStore: options.runtimeStore,
          initialLease,
          compatibility,
          ids,
          clock,
          timer,
          tools,
          systemPrompt: options.systemPrompt,
          maxTurns: options.maxTurns,
          streamOptions: options.streamOptions,
          credentialOverride: options.model.readOptions?.credentialOverride,
          approvalPolicy: options.approvalPolicy,
          recoveryId: nextId(ids, 'commit'),
          signal: controller.signal,
        });
        failureCounts.delete(key);
        if (
          disposition === 'blocked' ||
          disposition === 'waiting_for_reconciliation' ||
          disposition === 'ignored'
        )
          await releaseLease(
            options.runtimeStore,
            lease,
            ids,
            clock,
            clock.now(),
            disposition === 'ignored' ? 'RECOVERY_TERMINAL' : undefined,
          ).catch(ignoreLeaseLoss);
        return disposition;
      } catch (cause) {
        if (disposed || controller.signal.aborted) {
          await releaseLease(
            options.runtimeStore,
            lease,
            ids,
            clock,
            clock.now(),
            'WORKER_HANDOFF',
            'handoff',
          ).catch(ignoreLeaseLoss);
          return 'ignored';
        }
        if (cause instanceof TypeError) {
          const snapshot = await readSnapshot(
            options.runtimeStore,
            lease,
            clock,
          );
          await blockRecovery(
            options.runtimeStore,
            snapshot,
            leaseForSnapshot(lease, snapshot),
            ids,
            clock,
            nextId(ids, 'commit'),
            'RECOVERY_STATE_CONTRADICTION',
          );
          return 'blocked';
        }
        if (isLeaseLoss(cause)) return 'ignored';
        const failureCount = (failureCounts.get(key) ?? 0) + 1;
        failureCounts.set(key, failureCount);
        const delay = backoffDelay(
          failureCount,
          initialBackoffMs,
          maxBackoffMs,
          jitter,
        );
        await releaseLease(
          options.runtimeStore,
          lease,
          ids,
          clock,
          addMilliseconds(clock.now(), delay),
          'RECOVERY_TRANSIENT_FAILURE',
        ).catch(ignoreLeaseLoss);
        return 'ignored';
      } finally {
        heartbeatStopped = true;
        cancelHeartbeat();
        active.delete(key);
      }
    })();
    active.set(key, { controller, done, handoff });
    return done;
  };

  const runBatch = async (): Promise<AgentRecoveryBatchResult> => {
    assertWorkerActive(disposed);
    const now = clock.now();
    const batch = await options.runtimeStore.claimRecoverableRuns({
      claimId: nextId(ids, 'commit'),
      ownerId: options.workerId,
      configFingerprint,
      limit: claimBatchSize,
      now,
      leaseExpiresAt: addMilliseconds(now, leaseDurationMs),
    });
    const dispositions = await mapConcurrent(
      batch.leases,
      concurrency,
      runClaimedLease,
    );
    return Object.freeze({
      claimed: batch.leases.length,
      resumed: count(dispositions, 'resumed'),
      blocked: count(dispositions, 'blocked'),
      waitingForReconciliation: count(
        dispositions,
        'waiting_for_reconciliation',
      ),
    });
  };

  const recoverOnce = (): Promise<AgentRecoveryBatchResult> => {
    const operation = batchTail.then(runBatch);
    batchTail = operation.catch(() => undefined);
    return operation;
  };

  const start = (): Promise<void> => {
    if (startPromise) return startPromise;
    assertWorkerActive(disposed);
    startPromise = Promise.resolve();
    scanLoop = (async () => {
      while (!disposed) {
        await recoverOnce().catch(() => undefined);
        if (disposed) break;
        await waitForTimer(timer, scanIntervalMs, scanController.signal).catch(
          () => undefined,
        );
      }
    })();
    return startPromise;
  };

  return Object.freeze({
    start,
    recoverOnce,
    dispose: () => {
      if (disposePromise) return disposePromise;
      disposed = true;
      scanController.abort('Agent Recovery Worker disposed');
      const recoveries = [...active.values()];
      disposePromise = (async () => {
        await Promise.allSettled(
          recoveries.map((recovery) => recovery.handoff()),
        );
        await Promise.allSettled([
          ...(scanLoop ? [scanLoop] : []),
          ...recoveries.map((recovery) => recovery.done),
          batchTail,
        ]);
        await ai.dispose();
      })();
      return disposePromise;
    },
  });
}

async function driveRecovery<TScopeHandle>(input: {
  readonly ai: AiRuntime<TScopeHandle>;
  readonly model: ModelHandle;
  readonly runtimeStore: AgentRuntimeStore;
  readonly initialLease: AgentRunExecutionLease;
  readonly compatibility: Parameters<typeof planAgentRunRecovery>[1];
  readonly ids: AgentIdGenerator;
  readonly clock: AgentClock;
  readonly timer: AgentTimer;
  readonly tools: readonly import('../types.js').AgentTool[];
  readonly systemPrompt?: string;
  readonly maxTurns?: number;
  readonly streamOptions?: Omit<
    StreamOptionsInput,
    'signal' | 'credentialOverride'
  >;
  readonly credentialOverride?: RequestCredentialOverride;
  readonly approvalPolicy?: CreateAgentRecoveryWorkerOptions<TScopeHandle>['approvalPolicy'];
  readonly recoveryId: string;
  readonly signal: AbortSignal;
}): Promise<RecoveryDisposition> {
  let snapshot = await readSnapshot(
    input.runtimeStore,
    input.initialLease,
    input.clock,
  );
  for (let step = 0; step < MAX_RECOVERY_STEPS; step += 1) {
    const lease = leaseForSnapshot(input.initialLease, snapshot);
    const plan = planAgentRunRecovery(snapshot, input.compatibility);
    if (plan.kind === 'ignore_terminal') return 'ignored';
    if (plan.kind === 'blocked') {
      await blockRecovery(
        input.runtimeStore,
        snapshot,
        lease,
        input.ids,
        input.clock,
        input.recoveryId,
        plan.reasonCode,
      );
      return 'blocked';
    }
    if (plan.kind === 'continue_model') {
      await resumeAgentModelRun({
        ai: input.ai,
        model: input.model,
        runtimeStore: input.runtimeStore,
        snapshot,
        lease,
        plan,
        ids: input.ids,
        clock: input.clock,
        systemPrompt: input.systemPrompt,
        maxTurns: input.maxTurns,
        tools: input.tools,
        streamOptions: input.streamOptions,
        credentialOverride: input.credentialOverride,
        signal: input.signal,
        toolExecutionCoordinator: createRecoveryToolExecutionCoordinator({
          runtimeStore: input.runtimeStore,
          snapshot,
          lease,
          ids: input.ids,
          clock: input.clock,
          timer: input.timer,
          approvalPolicy: input.approvalPolicy,
        }),
      });
      return 'resumed';
    }
    if (plan.kind === 'continue_tools' || plan.kind === 'reprepare_tool') {
      await resumeAgentToolRun({
        runtimeStore: input.runtimeStore,
        snapshot,
        lease,
        plan,
        tools: input.tools,
        ids: input.ids,
        clock: input.clock,
        timer: input.timer,
        signal: input.signal,
      });
    } else if (
      plan.kind === 'wait_for_approval' ||
      plan.kind === 'consume_approval'
    ) {
      await resumeAgentApprovalRun({
        runtimeStore: input.runtimeStore,
        snapshot,
        lease,
        plan,
        tools: input.tools,
        ids: input.ids,
        clock: input.clock,
        timer: input.timer,
        signal: input.signal,
      });
    } else if (plan.kind === 'consume_reconciliation') {
      await resumeAgentReconciliationRun({
        runtimeStore: input.runtimeStore,
        snapshot,
        lease,
        plan,
        recoveryId: input.recoveryId,
        ids: input.ids,
        clock: input.clock,
      });
    } else if (
      plan.kind === 'retry_safe_tool' ||
      plan.kind === 'wait_for_reconciliation'
    ) {
      const result = await resumeAgentOrphanToolRun({
        runtimeStore: input.runtimeStore,
        snapshot,
        lease,
        plan,
        recoveryId: input.recoveryId,
        tools: input.tools,
        ids: input.ids,
        clock: input.clock,
        timer: input.timer,
        signal: input.signal,
      });
      if (result.plan.kind === 'wait_for_reconciliation')
        return 'waiting_for_reconciliation';
    } else if (plan.kind === 'finalize') {
      await finalizeRecovery(
        input.runtimeStore,
        snapshot,
        lease,
        plan.result,
        input.ids,
        input.clock,
      );
      return 'resumed';
    }
    snapshot = await readSnapshot(input.runtimeStore, lease, input.clock);
  }
  throw new TypeError('Agent recovery exceeded its bounded step count');
}

async function blockRecovery(
  store: AgentRuntimeStore,
  snapshot: AgentRunRecoverySnapshot,
  lease: AgentRunExecutionLease,
  ids: AgentIdGenerator,
  clock: AgentClock,
  recoveryId: string,
  reasonCode: string,
): Promise<void> {
  const now = clock.now();
  const event = harnessEvent(
    snapshot,
    {
      type: 'run_recovery_blocked',
      sequence: snapshot.lastEventSequence + 1,
      reasonCode,
    },
    nextId(ids, 'event'),
    now,
  );
  await store.commitTask({
    ...scope(snapshot),
    commitId: nextId(ids, 'commit'),
    expectedVersion: snapshot.task.version,
    mutations: [{ type: 'recovery_blocked_started' }],
    events: [event],
    checkpoint: recoveryBlockedCheckpoint(snapshot),
    lease: leaseGuard(lease),
    recoveryAudit: { recoveryId, action: 'blocked', reasonCode },
    now,
  });
}

async function finalizeRecovery(
  store: AgentRuntimeStore,
  snapshot: AgentRunRecoverySnapshot,
  lease: AgentRunExecutionLease,
  result: AgentRunResult,
  ids: AgentIdGenerator,
  clock: AgentClock,
): Promise<void> {
  const now = clock.now();
  const run = snapshot.task.runs.find(
    (candidate) => candidate.runId === snapshot.runId,
  );
  if (!run) throw new TypeError('Agent recovery Run is unavailable');
  const activeTurn = run.turns.find((turn) => turn.status === 'running');
  const event = harnessEvent(
    snapshot,
    { type: 'run_end', sequence: snapshot.lastEventSequence + 1, result },
    nextId(ids, 'event'),
    now,
    activeTurn?.turnId,
  );
  await store.commitTask({
    ...scope(snapshot),
    commitId: nextId(ids, 'commit'),
    expectedVersion: snapshot.task.version,
    mutations: [
      ...(activeTurn
        ? ([
            {
              type: 'turn_finished' as const,
              turnIndex: activeTurn.turnIndex,
              status: turnStatusForResult(result),
            },
          ] as const)
        : []),
      {
        type: 'run_finished',
        status: result.status,
        transcript: result.transcript,
      },
    ],
    events: [event],
    checkpoint: terminalCheckpoint(snapshot, result),
    lease: leaseGuard(lease),
    now,
  });
}

function recoveryBlockedCheckpoint(
  snapshot: AgentRunRecoverySnapshot,
): AgentRuntimeCheckpointWrite {
  return Object.freeze({
    kind: 'recovery_blocked',
    transcript: snapshot.checkpoint.transcript,
    turnIndex: snapshot.checkpoint.turnIndex,
    executionPosition: 'recovery',
    harnessProtocolVersion: snapshot.checkpoint.harnessProtocolVersion,
    checkpointSchemaVersion: snapshot.checkpoint.checkpointSchemaVersion,
    configFingerprint: snapshot.checkpoint.configFingerprint,
  });
}

function terminalCheckpoint(
  snapshot: AgentRunRecoverySnapshot,
  result: AgentRunResult,
): AgentRuntimeCheckpointWrite {
  return Object.freeze({
    kind: 'run_terminal',
    transcript: result.transcript,
    turnIndex: result.turns,
    executionPosition: 'terminal',
    resumeState: { kind: 'finalize' as const, result },
    harnessProtocolVersion: snapshot.checkpoint.harnessProtocolVersion,
    checkpointSchemaVersion: snapshot.checkpoint.checkpointSchemaVersion,
    configFingerprint: snapshot.checkpoint.configFingerprint,
  });
}

function harnessEvent(
  snapshot: AgentRunRecoverySnapshot,
  event: AgentEvent,
  eventId: string,
  occurredAt: string,
  turnId?: string,
): AgentHarnessEvent {
  return Object.freeze({
    eventId,
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    sessionId: snapshot.task.sessionId,
    taskId: snapshot.taskId,
    runId: snapshot.runId,
    turnId,
    turnIndex: 'turn' in event ? event.turn : undefined,
    sequence: event.sequence,
    occurredAt,
    payload: toHarnessPayload(event),
  });
}

async function readSnapshot(
  store: AgentRuntimeStore,
  lease: AgentRunExecutionLease,
  clock: AgentClock,
): Promise<AgentRunRecoverySnapshot> {
  return store.readRecoverySnapshot({
    ...scope(lease),
    ownerId: lease.ownerId,
    leaseToken: lease.leaseToken,
    fencingToken: lease.fencingToken,
    now: clock.now(),
  });
}

async function releaseLease(
  store: AgentRuntimeStore,
  lease: AgentRunExecutionLease,
  ids: AgentIdGenerator,
  clock: AgentClock,
  availableAt: string,
  reasonCode?: string,
  action: 'released' | 'handoff' = 'released',
): Promise<void> {
  await store.releaseRunLease({
    ...scope(lease),
    releaseId: nextId(ids, 'commit'),
    ownerId: lease.ownerId,
    leaseToken: lease.leaseToken,
    fencingToken: lease.fencingToken,
    now: clock.now(),
    availableAt,
    action,
    reasonCode,
  });
}

async function mapConcurrent<TInput, TResult>(
  values: readonly TInput[],
  concurrency: number,
  operation: (value: TInput) => Promise<TResult>,
): Promise<readonly TResult[]> {
  const results = new Array<TResult>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (;;) {
        const index = nextIndex++;
        const value = values[index];
        if (value === undefined) return;
        results[index] = await operation(value);
      }
    }),
  );
  return Object.freeze(results);
}

function waitForTimer(
  timer: AgentTimer,
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(new TypeError('Timer aborted'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const cancel = timer.schedule(delayMs, () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cancel();
      signal.removeEventListener('abort', onAbort);
      reject(new TypeError('Timer aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function backoffDelay(
  failureCount: number,
  initialMs: number,
  maximumMs: number,
  jitter: () => number,
): number {
  const base = Math.min(maximumMs, initialMs * 2 ** (failureCount - 1));
  const random = Math.min(1, Math.max(0, jitter()));
  return Math.max(1, Math.round(base * (0.75 + random * 0.5)));
}

function assertRecoveryStore(store: AgentRuntimeStore): void {
  if (
    store.durability !== 'durable' ||
    store.runLeaseSupport !== 'v1' ||
    store.checkpointResumeSupport !== 'v3'
  )
    throw new AgentError(
      'AGENT_RECOVERY_UNAVAILABLE',
      'Agent recovery requires a durable resumable Runtime Store',
    );
}

function assertWorkerOptions<TScopeHandle>(
  options: CreateAgentRecoveryWorkerOptions<TScopeHandle>,
): void {
  if (options.workerId.trim() === '')
    throw new TypeError('Agent Recovery Worker ID is empty');
  const values = {
    leaseDurationMs: options.runLease?.durationMs ?? 30_000,
    heartbeatIntervalMs: options.runLease?.heartbeatIntervalMs ?? 10_000,
    scanIntervalMs: options.recovery?.scanIntervalMs ?? 1_000,
    claimBatchSize: options.recovery?.claimBatchSize ?? 10,
    concurrency: options.recovery?.concurrency ?? 4,
    initialBackoffMs: options.recovery?.initialBackoffMs ?? 1_000,
    maxBackoffMs: options.recovery?.maxBackoffMs ?? 300_000,
  };
  if (
    !Number.isSafeInteger(values.leaseDurationMs) ||
    values.leaseDurationMs < 1_000 ||
    values.leaseDurationMs > 300_000 ||
    !Number.isSafeInteger(values.heartbeatIntervalMs) ||
    values.heartbeatIntervalMs < 100 ||
    values.heartbeatIntervalMs >= values.leaseDurationMs ||
    !Number.isSafeInteger(values.scanIntervalMs) ||
    values.scanIntervalMs < 1 ||
    !Number.isSafeInteger(values.claimBatchSize) ||
    values.claimBatchSize < 1 ||
    values.claimBatchSize > 1_000 ||
    !Number.isSafeInteger(values.concurrency) ||
    values.concurrency < 1 ||
    values.concurrency > values.claimBatchSize ||
    !Number.isSafeInteger(values.initialBackoffMs) ||
    values.initialBackoffMs < 1 ||
    !Number.isSafeInteger(values.maxBackoffMs) ||
    values.maxBackoffMs < values.initialBackoffMs
  )
    throw new TypeError('Agent Recovery Worker options are invalid');
}

function assertWorkerActive(disposed: boolean): void {
  if (disposed)
    throw new AgentError(
      'AGENT_DISPOSED',
      'Agent Recovery Worker has been disposed',
    );
}

function scope(value: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly runId: string;
}) {
  return {
    tenantId: value.tenantId,
    projectId: value.projectId,
    taskId: value.taskId,
    runId: value.runId,
  } as const;
}

function leaseGuard(lease: AgentRunExecutionLease) {
  return {
    leaseToken: lease.leaseToken,
    fencingToken: lease.fencingToken,
  } as const;
}

function leaseForSnapshot(
  lease: AgentRunExecutionLease,
  snapshot: AgentRunRecoverySnapshot,
): AgentRunExecutionLease {
  return Object.freeze({
    ...lease,
    ownerId: snapshot.lease.ownerId,
    fencingToken: snapshot.lease.fencingToken,
    leaseExpiresAt: snapshot.lease.leaseExpiresAt,
  });
}

function runKey(lease: AgentRunExecutionLease): string {
  return JSON.stringify([
    lease.tenantId,
    lease.projectId,
    lease.taskId,
    lease.runId,
  ]);
}

function count(
  values: readonly RecoveryDisposition[],
  disposition: RecoveryDisposition,
): number {
  return values.filter((value) => value === disposition).length;
}

function nextId(
  ids: AgentIdGenerator,
  kind: Parameters<AgentIdGenerator['next']>[0],
): string {
  const value = ids.next(kind);
  if (value.trim() === '') throw new TypeError(`Agent ${kind} ID is empty`);
  return value;
}

function addMilliseconds(value: string, milliseconds: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp))
    throw new TypeError('Agent clock is invalid');
  return new Date(timestamp + milliseconds).toISOString();
}

function isLeaseLoss(cause: unknown): boolean {
  return cause instanceof AgentError && cause.code === 'AGENT_RUN_LEASE_LOST';
}

function ignoreLeaseLoss(cause: unknown): void {
  if (!isLeaseLoss(cause)) throw cause;
}

const defaultIds: AgentIdGenerator = Object.freeze({
  next: () => randomUUID(),
});
const defaultClock: AgentClock = Object.freeze({
  now: () => new Date().toISOString(),
});
const defaultTimer: AgentTimer = Object.freeze({
  schedule(delayMs: number, callback: () => void) {
    const timeout = setTimeout(callback, delayMs);
    return () => clearTimeout(timeout);
  },
});

const HARNESS_PROTOCOL_VERSION = 2;
const CHECKPOINT_SCHEMA_VERSION = 3;
const MAX_RECOVERY_STEPS = 1_000;
