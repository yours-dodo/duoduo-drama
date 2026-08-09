import {
  createFauxProvider,
  fauxTextResponse,
  fauxToolResponse,
} from '@duoduo/ai/testing';

import {
  createAgentHarness,
  createAgentRecoveryWorker,
  type AgentRecoveryBatchResult,
  type AgentTool,
} from '../../../index.js';
import { createPostgresAgentRuntimeStore } from '../index.js';

const mode = requiredEnvironment('AGENT_RECOVERY_PROCESS_MODE');
const connectionString = requiredEnvironment(
  'AGENT_RECOVERY_PROCESS_DATABASE_URL',
);
const suffix = requiredEnvironment('AGENT_RECOVERY_PROCESS_SUFFIX');
const providerId = 'postgres-process-recovery-provider';
const systemPrompt = `postgres-process-recovery:${suffix}`;
const toolName = 'process-safe-tool';

void main().catch(async (cause: unknown) => {
  await sendMessage({
    type: 'process_error',
    message: cause instanceof Error ? cause.message : 'Unknown process error',
  }).catch(() => undefined);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  if (mode === 'owner') {
    await runOwner();
    return;
  }
  if (mode === 'worker') {
    await runWorker();
    return;
  }
  throw new TypeError('Unknown Agent recovery process mode');
}

async function runOwner(): Promise<void> {
  const fixture = createFauxProvider({
    id: providerId,
    initialResponses: [
      fauxToolResponse({
        id: 'process-safe-call',
        name: toolName,
        rawArguments: '{}',
      }),
    ],
  });
  const store = createPostgresAgentRuntimeStore({ connectionString });
  let resolveQuery!: (query: ScopedRun) => void;
  const query = new Promise<ScopedRun>((resolve) => {
    resolveQuery = resolve;
  });
  const tool: AgentTool = {
    definition: {
      name: toolName,
      inputSchema: { type: 'object', additionalProperties: false },
    },
    execution: {
      sideEffect: 'none',
      idempotency: 'none',
      timeoutMs: 30_000,
    },
    execute: async () => {
      const scopedRun = await query;
      await sendMessage({
        type: 'owner_ready',
        ...scopedRun,
        providerInvocations: fixture.controller.callCount(),
      });
      return new Promise<never>(() => undefined);
    },
  };
  const harness = await createAgentHarness({
    providers: [fixture.provider],
    model: { ref: fixture.modelRef, scope: {} },
    runtimeStore: store,
    tools: [tool],
    systemPrompt,
    runLease: { durationMs: 1_000, heartbeatIntervalMs: 250 },
  });
  const handle = await harness.startTask({
    scope: {
      tenantId: `tenant-process-recovery-${suffix}`,
      projectId: `project-process-recovery-${suffix}`,
    },
    input: 'survive an executor process crash',
  });
  resolveQuery({
    tenantId: `tenant-process-recovery-${suffix}`,
    projectId: `project-process-recovery-${suffix}`,
    taskId: handle.taskId,
    runId: handle.runId,
  });
  await handle.result();
}

async function runWorker(): Promise<void> {
  const fixture = createFauxProvider({
    id: providerId,
    initialResponses: [fauxTextResponse('recovered without model replay')],
  });
  const store = createPostgresAgentRuntimeStore({ connectionString });
  let toolInvocations = 0;
  const tool: AgentTool = {
    definition: {
      name: toolName,
      inputSchema: { type: 'object', additionalProperties: false },
    },
    execution: {
      sideEffect: 'none',
      idempotency: 'none',
      timeoutMs: 30_000,
    },
    execute: async () => {
      toolInvocations += 1;
      return {
        content: [{ type: 'text', text: 'safe tool recovered' }],
      };
    },
  };
  const worker = await createAgentRecoveryWorker({
    providers: [fixture.provider],
    model: { ref: fixture.modelRef, scope: {} },
    runtimeStore: store,
    workerId: `process-recovery-worker-${suffix}`,
    tools: [tool],
    systemPrompt,
    runLease: { durationMs: 1_000, heartbeatIntervalMs: 250 },
    recovery: {
      claimBatchSize: 1,
      concurrency: 1,
      initialBackoffMs: 25,
      maxBackoffMs: 100,
      jitter: () => 0,
    },
  });

  try {
    const batch = await claimUntilRecovered(worker.recoverOnce);
    await sendMessage({
      type: 'worker_done',
      batch,
      providerInvocations: fixture.controller.callCount(),
      toolInvocations,
    });
  } finally {
    await worker.dispose();
    await store.dispose();
  }
}

async function claimUntilRecovered(
  recoverOnce: () => Promise<AgentRecoveryBatchResult>,
): Promise<AgentRecoveryBatchResult> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const batch = await recoverOnce();
    if (batch.claimed > 0) return batch;
    await delay(50);
  }
  throw new Error('Recovery Worker did not claim the expired Run');
}

function sendMessage(message: ProcessMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new Error('Agent recovery fixture requires an IPC channel'));
      return;
    }
    process.send(message, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new TypeError(`Missing ${name}`);
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ScopedRun {
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly runId: string;
}

type ProcessMessage =
  | ({
      readonly type: 'owner_ready';
      readonly providerInvocations: number;
    } & ScopedRun)
  | {
      readonly type: 'worker_done';
      readonly batch: AgentRecoveryBatchResult;
      readonly providerInvocations: number;
      readonly toolInvocations: number;
    }
  | { readonly type: 'process_error'; readonly message: string };
