import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  createPostgresAgentRuntimeStore,
  migrateAgentRuntime,
} from './index.js';

const databaseUrl = process.env.AGENT_TEST_POSTGRES_URL;
if (process.env.AGENT_TEST_POSTGRES_REQUIRED === '1' && !databaseUrl)
  throw new TypeError(
    'AGENT_TEST_POSTGRES_URL is required by the dedicated PostgreSQL test command',
  );

const fixturePath = fileURLToPath(
  new URL('./__fixtures__/postgres-recovery-process.ts', import.meta.url),
);

describe.skipIf(!databaseUrl)('PostgreSQL process restart recovery', () => {
  it('recovers after SIGKILL without replaying a completed model Turn', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const suffix = randomUUID();
    const children = new Set<ChildProcess>();
    const store = createPostgresAgentRuntimeStore({ connectionString });

    try {
      const owner = startFixtureProcess('owner', connectionString, suffix);
      children.add(owner);
      const ownerReady = await waitForMessage<OwnerReadyMessage>(
        owner,
        (message) => message.type === 'owner_ready',
      );
      expect(ownerReady.providerInvocations).toBe(1);

      expect(owner.kill('SIGKILL')).toBe(true);
      const [exitCode, signal] = (await once(owner, 'exit')) as [
        number | null,
        NodeJS.Signals | null,
      ];
      children.delete(owner);
      expect(exitCode).toBeNull();
      expect(signal).toBe('SIGKILL');

      const worker = startFixtureProcess('worker', connectionString, suffix);
      children.add(worker);
      const recovered = await waitForMessage<WorkerDoneMessage>(
        worker,
        (message) => message.type === 'worker_done',
        15_000,
      );
      await once(worker, 'exit');
      children.delete(worker);

      expect(recovered.batch).toEqual({
        claimed: 1,
        resumed: 1,
        blocked: 0,
        waitingForReconciliation: 0,
      });
      expect(recovered.providerInvocations).toBe(1);
      expect(recovered.toolInvocations).toBe(1);

      const query = {
        tenantId: ownerReady.tenantId,
        projectId: ownerReady.projectId,
        taskId: ownerReady.taskId,
        runId: ownerReady.runId,
      };
      const [task, events, executions, checkpoints, audit] = await Promise.all([
        store.getTask(query),
        store.readEvents({ ...query, limit: 100 }),
        store.readToolExecutions(query),
        store.readCheckpoints(query),
        store.readRunRecoveryAudit(query),
      ]);

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
        events.events
          .filter((event) => event.payload.type === 'model_start')
          .map((event) => ({
            turnIndex: event.turnIndex,
            modelAttempt:
              event.payload.type === 'model_start'
                ? event.payload.modelAttempt
                : undefined,
          })),
      ).toEqual([
        { turnIndex: 1, modelAttempt: 1 },
        { turnIndex: 2, modelAttempt: 1 },
      ]);
      expect(events.events.map((event) => event.sequence)).toEqual(
        Array.from({ length: events.events.length }, (_, index) => index + 1),
      );
      expect(executions).toMatchObject([
        {
          status: 'succeeded',
          attemptCount: 2,
          attempts: [
            {
              attempt: 1,
              status: 'unknown',
              effectOutcome: 'not_applied',
              errorCode: 'OWNER_LEASE_EXPIRED',
            },
            {
              attempt: 2,
              status: 'succeeded',
              effectOutcome: 'not_applied',
            },
          ],
        },
      ]);
      expect(checkpoints.at(-1)).toMatchObject({
        kind: 'run_terminal',
        checkpointSchemaVersion: 3,
        executionPosition: 'terminal',
      });
      expect(audit).toMatchObject([
        { sequence: 1, action: 'initial_claim', fencingToken: 1 },
        { sequence: 2, action: 'recovery_claim', fencingToken: 2 },
        {
          sequence: 3,
          action: 'resumed',
          fencingToken: 2,
          reasonCode: 'SAFE_RECOVERY_RETRY',
        },
      ]);
    } finally {
      for (const child of children) child.kill('SIGKILL');
      await store.dispose();
    }
  }, 20_000);

  it('quarantines then consumes a resolved external effect after process restart', async () => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    await migrateAgentRuntime({ connectionString });
    const suffix = randomUUID();
    const children = new Set<ChildProcess>();
    const store = createPostgresAgentRuntimeStore({ connectionString });

    try {
      const owner = startFixtureProcess(
        'owner',
        connectionString,
        suffix,
        'external',
      );
      children.add(owner);
      const ownerReady = await waitForMessage<OwnerReadyMessage>(
        owner,
        (message) => message.type === 'owner_ready',
      );
      expect(ownerReady.providerInvocations).toBe(1);

      expect(owner.kill('SIGKILL')).toBe(true);
      await once(owner, 'exit');
      children.delete(owner);

      const quarantineWorker = startFixtureProcess(
        'worker',
        connectionString,
        suffix,
        'external',
      );
      children.add(quarantineWorker);
      const quarantined = await waitForMessage<WorkerDoneMessage>(
        quarantineWorker,
        (message) => message.type === 'worker_done',
        15_000,
      );
      await once(quarantineWorker, 'exit');
      children.delete(quarantineWorker);
      expect(quarantined.batch).toEqual({
        claimed: 1,
        resumed: 0,
        blocked: 0,
        waitingForReconciliation: 1,
      });
      expect(quarantined.providerInvocations).toBe(0);
      expect(quarantined.toolInvocations).toBe(0);

      const query = {
        tenantId: ownerReady.tenantId,
        projectId: ownerReady.projectId,
        taskId: ownerReady.taskId,
        runId: ownerReady.runId,
      };
      const [waitingCases, waitingExecutions] = await Promise.all([
        store.readReconciliationCases(query),
        store.readToolExecutions(query),
      ]);
      const reconciliationCase = waitingCases[0];
      if (!reconciliationCase)
        throw new TypeError('Expected an external-effect reconciliation Case');
      expect(reconciliationCase).toMatchObject({ status: 'waiting' });
      expect(waitingExecutions).toMatchObject([
        {
          status: 'unknown',
          effectOutcome: 'unknown',
          attempts: [{ status: 'unknown', effectOutcome: 'unknown' }],
        },
      ]);
      await store.decideReconciliation({
        ...query,
        reconciliationCaseId: reconciliationCase.reconciliationCaseId,
        resolutionId: `resolution-${suffix}`,
        resolution: 'confirmed_not_applied',
        resolvedBy: 'operator-process-recovery',
        reasonCode: 'EXTERNAL_EFFECT_NOT_FOUND',
        now: new Date().toISOString(),
      });

      const consumingWorker = startFixtureProcess(
        'worker',
        connectionString,
        suffix,
        'external',
      );
      children.add(consumingWorker);
      const recovered = await waitForMessage<WorkerDoneMessage>(
        consumingWorker,
        (message) => message.type === 'worker_done',
        15_000,
      );
      await once(consumingWorker, 'exit');
      children.delete(consumingWorker);
      expect(recovered.batch).toEqual({
        claimed: 1,
        resumed: 1,
        blocked: 0,
        waitingForReconciliation: 0,
      });
      expect(recovered.providerInvocations).toBe(1);
      expect(recovered.toolInvocations).toBe(0);

      const [task, events, executions, reconciliationCases, checkpoints] =
        await Promise.all([
          store.getTask(query),
          store.readEvents({ ...query, limit: 100 }),
          store.readToolExecutions(query),
          store.readReconciliationCases(query),
          store.readCheckpoints(query),
        ]);
      expect(task).toMatchObject({ status: 'completed' });
      expect(reconciliationCases).toMatchObject([
        {
          reconciliationCaseId: reconciliationCase.reconciliationCaseId,
          status: 'consumed',
          resolution: 'confirmed_not_applied',
        },
      ]);
      expect(executions).toMatchObject([
        {
          status: 'unknown',
          effectOutcome: 'unknown',
          attempts: [{ status: 'unknown', effectOutcome: 'unknown' }],
        },
      ]);
      expect(
        events.events.filter(
          (event) => event.payload.type === 'run_reconciliation_required',
        ),
      ).toHaveLength(1);
      expect(
        events.events.filter(
          (event) => event.payload.type === 'tool_execution_end',
        ),
      ).toMatchObject([
        { payload: { status: 'unknown', effectOutcome: 'unknown' } },
      ]);
      expect(checkpoints.at(-1)).toMatchObject({
        kind: 'run_terminal',
        executionPosition: 'terminal',
      });
    } finally {
      for (const child of children) child.kill('SIGKILL');
      await store.dispose();
    }
  }, 30_000);
});

function startFixtureProcess(
  mode: 'owner' | 'worker',
  connectionString: string,
  suffix: string,
  effect: 'none' | 'external' = 'none',
): ChildProcess {
  return fork(fixturePath, [], {
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      AGENT_RECOVERY_PROCESS_MODE: mode,
      AGENT_RECOVERY_PROCESS_DATABASE_URL: connectionString,
      AGENT_RECOVERY_PROCESS_SUFFIX: suffix,
      AGENT_RECOVERY_PROCESS_EFFECT: effect,
    },
    silent: true,
  });
}

function waitForMessage<TMessage extends ProcessMessage>(
  child: ChildProcess,
  predicate: (message: ProcessMessage) => message is TMessage,
  timeoutMs = 10_000,
): Promise<TMessage> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for child process: ${stderr}`));
    }, timeoutMs);
    const onMessage = (value: unknown): void => {
      if (!isProcessMessage(value)) return;
      if (value.type === 'process_error') {
        cleanup();
        reject(new Error(`${value.message}\n${stderr}`));
        return;
      }
      if (!predicate(value)) return;
      cleanup();
      resolve(value);
    };
    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      cleanup();
      reject(
        new Error(
          `Child exited before expected message (${String(code)}/${String(signal)}): ${stderr}`,
        ),
      );
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onStderr = (chunk: Buffer | string): void => {
      stderr += chunk.toString();
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
      child.stderr?.off('data', onStderr);
    };
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
    child.stderr?.on('data', onStderr);
  });
}

function isProcessMessage(value: unknown): value is ProcessMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) throw new TypeError('PostgreSQL test URL is unavailable');
  return value;
}

type ProcessMessage =
  | OwnerReadyMessage
  | WorkerDoneMessage
  | { readonly type: 'process_error'; readonly message: string };

interface OwnerReadyMessage {
  readonly type: 'owner_ready';
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly providerInvocations: number;
}

interface WorkerDoneMessage {
  readonly type: 'worker_done';
  readonly batch: {
    readonly claimed: number;
    readonly resumed: number;
    readonly blocked: number;
    readonly waitingForReconciliation: number;
  };
  readonly providerInvocations: number;
  readonly toolInvocations: number;
}
