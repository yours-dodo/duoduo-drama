import type { Message } from '@duoduo/ai';

import type { AgentRuntimeMutation } from './runtime-store.js';
import type {
  AgentRequestScope,
  AgentRunSnapshot,
  AgentRunStatus,
  AgentTaskSnapshot,
  AgentTaskStatus,
  AgentTurnSnapshot,
  AgentTurnStatus,
} from './types.js';

export interface MutableAgentTurn {
  turnId: string;
  turnIndex: number;
  status: AgentTurnStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MutableAgentRun {
  runId: string;
  status: AgentRunStatus;
  turns: MutableAgentTurn[];
  createdAt: string;
  updatedAt: string;
}

export interface MutableAgentTask {
  taskId: string;
  scope: AgentRequestScope;
  status: AgentTaskStatus;
  latestRunId: string;
  activeRunId?: string;
  runs: MutableAgentRun[];
  transcript: readonly Message[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function createRuntimeTask(input: {
  scope: AgentRequestScope;
  taskId: string;
  runId: string;
  now: string;
}): MutableAgentTask {
  return {
    taskId: input.taskId,
    scope: Object.freeze({ ...input.scope }),
    status: 'queued',
    latestRunId: input.runId,
    activeRunId: input.runId,
    runs: [
      {
        runId: input.runId,
        status: 'queued',
        turns: [],
        createdAt: input.now,
        updatedAt: input.now,
      },
    ],
    transcript: Object.freeze([]),
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function applyRuntimeMutations(input: {
  task: MutableAgentTask;
  runId: string;
  mutations: readonly AgentRuntimeMutation[];
  now: string;
}): void {
  const run = input.task.runs.find(
    (candidate) => candidate.runId === input.task.activeRunId,
  );
  if (!run || run.runId !== input.runId)
    throw new TypeError('Active Agent run not found');

  for (const mutation of input.mutations)
    applyMutation(input.task, run, mutation, input.now);

  input.task.version += 1;
  input.task.updatedAt = input.now;
  run.updatedAt = input.now;
}

export function snapshotRuntimeTask(task: MutableAgentTask): AgentTaskSnapshot {
  return Object.freeze({
    taskId: task.taskId,
    tenantId: task.scope.tenantId,
    projectId: task.scope.projectId,
    sessionId: task.scope.sessionId,
    status: task.status,
    latestRunId: task.latestRunId,
    activeRunId: task.activeRunId,
    runs: Object.freeze(task.runs.map(snapshotRun)),
    transcript: Object.freeze([...task.transcript]),
    version: task.version,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  });
}

export function cloneRuntimeTask(task: MutableAgentTask): MutableAgentTask {
  return {
    ...task,
    scope: Object.freeze({ ...task.scope }),
    runs: task.runs.map((run) => ({
      ...run,
      turns: run.turns.map((turn) => ({ ...turn })),
    })),
    transcript: Object.freeze([...task.transcript]),
  };
}

function applyMutation(
  task: MutableAgentTask,
  run: MutableAgentRun,
  mutation: AgentRuntimeMutation,
  now: string,
): void {
  switch (mutation.type) {
    case 'run_started':
      assertStatus(task.status, 'queued', 'Agent task');
      assertStatus(run.status, 'queued', 'Agent run');
      task.status = 'running';
      run.status = 'running';
      return;
    case 'approval_wait_started':
      assertStatus(task.status, 'running', 'Agent task');
      assertStatus(run.status, 'running', 'Agent run');
      task.status = 'waiting_for_approval';
      run.status = 'waiting_for_approval';
      return;
    case 'approval_wait_resumed':
      assertStatus(task.status, 'waiting_for_approval', 'Agent task');
      assertStatus(run.status, 'waiting_for_approval', 'Agent run');
      task.status = 'running';
      run.status = 'running';
      return;
    case 'reconciliation_wait_started':
      assertStatus(task.status, 'running', 'Agent task');
      assertStatus(run.status, 'running', 'Agent run');
      task.status = 'waiting_for_reconciliation';
      run.status = 'waiting_for_reconciliation';
      return;
    case 'reconciliation_wait_resumed':
      assertStatus(task.status, 'waiting_for_reconciliation', 'Agent task');
      assertStatus(run.status, 'waiting_for_reconciliation', 'Agent run');
      task.status = 'running';
      run.status = 'running';
      return;
    case 'recovery_blocked_started':
      if (
        task.status === 'completed' ||
        task.status === 'failed' ||
        task.status === 'cancelled' ||
        run.status === 'completed' ||
        run.status === 'failed' ||
        run.status === 'cancelled'
      )
        throw new TypeError(
          'Terminal Agent run cannot become recovery blocked',
        );
      task.status = 'recovery_blocked';
      run.status = 'recovery_blocked';
      return;
    case 'turn_started':
      assertStatus(task.status, 'running', 'Agent task');
      assertStatus(run.status, 'running', 'Agent run');
      if (run.turns.some((turn) => turn.turnIndex === mutation.turnIndex))
        throw new TypeError('Agent turn index collision');
      if (run.turns.some((turn) => turn.status === 'running'))
        throw new TypeError('Agent run already has an active turn');
      run.turns.push({
        turnId: mutation.turnId,
        turnIndex: mutation.turnIndex,
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });
      return;
    case 'turn_finished': {
      assertStatus(task.status, 'running', 'Agent task');
      assertStatus(run.status, 'running', 'Agent run');
      const turn = run.turns.find(
        (candidate) => candidate.turnIndex === mutation.turnIndex,
      );
      if (!turn) throw new TypeError('Agent turn not found');
      assertStatus(turn.status, 'running', 'Agent turn');
      turn.status = mutation.status;
      turn.updatedAt = now;
      return;
    }
    case 'run_finished':
      assertStatus(task.status, 'running', 'Agent task');
      assertStatus(run.status, 'running', 'Agent run');
      if (run.turns.some((turn) => turn.status === 'running'))
        throw new TypeError('Agent run still has an active turn');
      task.status = mutation.status;
      task.activeRunId = undefined;
      task.transcript = Object.freeze([...mutation.transcript]);
      run.status = mutation.status;
      return;
  }
}

function assertStatus<TStatus extends string>(
  actual: TStatus,
  expected: TStatus,
  subject: string,
): void {
  if (actual !== expected)
    throw new TypeError(`${subject} cannot transition from ${actual}`);
}

function snapshotRun(run: MutableAgentRun): AgentRunSnapshot {
  return Object.freeze({
    runId: run.runId,
    status: run.status,
    turns: Object.freeze(run.turns.map(snapshotTurn)),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  });
}

function snapshotTurn(turn: MutableAgentTurn): AgentTurnSnapshot {
  return Object.freeze({ ...turn });
}
