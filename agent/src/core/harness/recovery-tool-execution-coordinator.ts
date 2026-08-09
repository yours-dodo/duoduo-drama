import { randomUUID } from 'node:crypto';

import type { JsonValue } from '@duoduo/ai';

import type { AgentCheckpointFrame } from '../run-loop.js';
import type {
  AgentToolExecutionCoordinator,
  PreparedAgentToolExecution,
} from '../tool-execution.js';
import type { AgentEvent, AgentTool } from '../types.js';
import { hashRuntimeCommit } from './commit-hash.js';
import type {
  AgentRunExecutionLease,
  AgentRunRecoverySnapshot,
  AgentRuntimeCheckpointWrite,
  AgentRuntimeStore,
  AgentToolExecutionMutation,
} from './runtime-store.js';
import { toHarnessPayload } from './runtime-event.js';
import type {
  AgentApprovalPolicy,
  AgentClock,
  AgentHarnessEvent,
  AgentIdGenerator,
  AgentTimer,
} from './types.js';

interface ProposedExecution {
  readonly toolExecutionId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argumentsDigest: string;
  readonly proposalSequence: number;
  readonly turnIndex: number;
  readonly turnId: string;
}

export function createRecoveryToolExecutionCoordinator(input: {
  readonly runtimeStore: AgentRuntimeStore;
  readonly snapshot: AgentRunRecoverySnapshot;
  readonly lease: AgentRunExecutionLease;
  readonly ids: AgentIdGenerator;
  readonly clock: AgentClock;
  readonly timer: AgentTimer;
  readonly approvalPolicy?: AgentApprovalPolicy;
}): AgentToolExecutionCoordinator {
  const proposals = new Map<string, ProposedExecution>();
  const attempts = new Map<string, string>();
  const lease = {
    leaseToken: input.lease.leaseToken,
    fencingToken: input.lease.fencingToken,
  };

  const currentTask = async () => {
    const task = await input.runtimeStore.getTask(scope(input.snapshot));
    if (!task) throw new TypeError('Agent recovery Task is unavailable');
    return task;
  };
  const commit = async (
    command: Omit<
      Parameters<AgentRuntimeStore['commitTask']>[0],
      | 'tenantId'
      | 'projectId'
      | 'taskId'
      | 'runId'
      | 'commitId'
      | 'expectedVersion'
      | 'lease'
      | 'now'
    >,
    now = input.clock.now(),
  ) =>
    input.runtimeStore.commitTask({
      ...scope(input.snapshot),
      ...command,
      commitId: nextId(input.ids, 'commit'),
      expectedVersion: (await currentTask()).version,
      lease,
      now,
    });

  const coordinator: AgentToolExecutionCoordinator = {
    propose: async ({ calls, turn, checkpoint }) => {
      const task = await currentTask();
      const run = task.runs.find(
        (candidate) => candidate.runId === input.snapshot.runId,
      );
      const turnId = run?.turns.find(
        (candidate) => candidate.turnIndex === turn,
      )?.turnId;
      if (!turnId)
        throw new TypeError('Agent recovery tool Turn is unavailable');
      const existing = await input.runtimeStore.readToolExecutions(
        scope(input.snapshot),
      );
      let proposalSequence = Math.max(
        0,
        ...existing.map((execution) => execution.proposalSequence),
      );
      const firstProposalSequence = proposalSequence + 1;
      const mutations: AgentToolExecutionMutation[] = calls.map((call) => {
        if (proposals.has(call.id))
          throw new TypeError('Agent recovery tool call ID is duplicated');
        const proposal: ProposedExecution = Object.freeze({
          toolExecutionId: nextId(input.ids, 'tool_execution'),
          toolCallId: call.id,
          toolName: call.name,
          argumentsDigest: hashRuntimeCommit(call.rawArguments),
          proposalSequence: ++proposalSequence,
          turnIndex: turn,
          turnId,
        });
        proposals.set(call.id, proposal);
        return {
          type: 'tool_execution_proposed',
          toolExecutionId: proposal.toolExecutionId,
          toolCallId: call.id,
          turnId,
          turnIndex: turn,
          proposalSequence: proposal.proposalSequence,
          toolName: call.name,
          argumentsDigest: proposal.argumentsDigest,
        };
      });
      await commit({
        mutations: [],
        toolExecutions: mutations,
        checkpoint: checkpointWrite(input.snapshot, checkpoint, {
          kind: 'tool',
          turnIndex: turn,
          nextProposalSequence: firstProposalSequence,
        }),
      });
    },
    authorize: async ({ tool, toolCallId, turn, arguments: arguments_ }) => {
      if (!input.approvalPolicy) return { decision: 'allow' as const };
      const proposal = requireProposal(proposals, toolCallId);
      let decision;
      try {
        decision = await input.approvalPolicy.evaluate({
          scope: {
            tenantId: input.snapshot.tenantId,
            projectId: input.snapshot.projectId,
            sessionId: input.snapshot.task.sessionId,
          },
          taskId: input.snapshot.taskId,
          runId: input.snapshot.runId,
          turnId: proposal.turnId,
          turnIndex: turn,
          toolExecutionId: proposal.toolExecutionId,
          toolCallId,
          toolName: tool.definition.name,
          arguments: arguments_ as JsonValue,
          argumentsDigest: proposal.argumentsDigest,
          execution: tool.execution,
        });
      } catch {
        return {
          decision: 'policy_failed' as const,
          errorCode: 'AGENT_APPROVAL_POLICY_FAILED' as const,
        };
      }
      if (decision.decision === 'allow' || decision.decision === 'deny')
        return decision;
      if (!validApprovalRequest(decision.expiresAt, decision.presentation))
        return {
          decision: 'policy_failed' as const,
          errorCode: 'AGENT_APPROVAL_PRESENTATION_INVALID' as const,
        };
      const approvalId = nextId(input.ids, 'approval');
      await commit({
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_awaiting_approval',
            toolExecutionId: proposal.toolExecutionId,
            ...tool.execution,
          },
        ],
      });
      return {
        decision: 'require_approval' as const,
        approvalId,
        toolExecutionId: proposal.toolExecutionId,
        policyId: input.approvalPolicy.policyId,
        policyVersion: input.approvalPolicy.version,
        argumentsDigest: proposal.argumentsDigest,
        expiresAt: decision.expiresAt,
        presentation: decision.presentation,
      };
    },
    requestApproval: async ({ authorization, event, checkpoint, signal }) => {
      const proposal = [...proposals.values()].find(
        (candidate) =>
          candidate.toolExecutionId === authorization.toolExecutionId,
      );
      if (!proposal)
        throw new TypeError('Agent recovery Approval proposal is unavailable');
      await commit({
        mutations: [{ type: 'approval_wait_started' }],
        approvals: [
          {
            type: 'approval_requested',
            approvalId: authorization.approvalId,
            toolExecutionId: authorization.toolExecutionId,
            turnId: proposal.turnId,
            proposalSequence: proposal.proposalSequence,
            policyId: authorization.policyId,
            policyVersion: authorization.policyVersion,
            argumentsDigest: authorization.argumentsDigest,
            expiresAt: authorization.expiresAt,
            presentation: authorization.presentation,
          },
        ],
        events: [
          toHarnessEvent(
            input.snapshot,
            proposal,
            event,
            input.ids,
            input.clock,
          ),
        ],
        checkpoint: checkpointWrite(input.snapshot, checkpoint, {
          kind: 'approval',
          turnIndex: proposal.turnIndex,
          approvalId: authorization.approvalId,
          toolExecutionId: authorization.toolExecutionId,
        }),
      });
      for (;;) {
        const approval = (
          await input.runtimeStore.readApprovals(scope(input.snapshot))
        ).find(
          (candidate) => candidate.approvalId === authorization.approvalId,
        );
        if (!approval)
          throw new TypeError('Agent recovery Approval is unavailable');
        if (approval.status !== 'pending') {
          const version = (await currentTask()).version;
          if (approval.status === 'approved')
            return {
              decision: 'approved' as const,
              approvalId: approval.approvalId,
              toolExecutionId: approval.toolExecutionId,
              decisionId: approval.decisionId!,
              decidedBy: approval.decidedBy!,
              reasonCode: approval.decisionReasonCode,
              taskVersion: version,
            };
          return {
            decision: `approval_${approval.status}` as
              'approval_denied' | 'approval_expired' | 'approval_cancelled',
            approvalId: approval.approvalId,
            toolExecutionId: approval.toolExecutionId,
            decisionId: approval.decisionId,
            decidedBy: approval.decidedBy,
            reasonCode: approval.decisionReasonCode,
            taskVersion: version,
          };
        }
        const now = input.clock.now();
        const expiresIn = Date.parse(approval.expiresAt) - Date.parse(now);
        if (!Number.isFinite(expiresIn))
          throw new TypeError('Agent recovery Approval expiry is invalid');
        if (expiresIn <= 0) {
          await input.runtimeStore.resolveApproval({
            ...scope(input.snapshot),
            approvalId: approval.approvalId,
            commitId: nextId(input.ids, 'commit'),
            resolution: 'expired',
            lease,
            now,
          });
          continue;
        }
        await waitForApproval(input.timer, Math.min(1_000, expiresIn), signal);
      }
    },
    consumeApprovedApproval: async ({
      authorization,
      tool,
      toolCallId,
      event,
      checkpoint,
      signal,
    }) => {
      const proposal = requireProposal(proposals, toolCallId);
      const now = input.clock.now();
      const deadline = addMilliseconds(now, tool.execution.timeoutMs);
      const idempotencyKey =
        tool.execution.idempotency === 'keyed' ? randomUUID() : undefined;
      await commit(
        {
          mutations: [{ type: 'approval_wait_resumed' }],
          toolExecutions: [
            {
              type: 'tool_execution_prepared',
              toolExecutionId: authorization.toolExecutionId,
              ...tool.execution,
              idempotencyKey,
              deadline,
            },
          ],
          approvals: [
            {
              type: 'approval_consumed',
              approvalId: authorization.approvalId,
              toolExecutionId: authorization.toolExecutionId,
              decisionId: authorization.decisionId,
              consumeId: nextId(input.ids, 'approval_consume'),
            },
          ],
          events: [
            toHarnessEvent(
              input.snapshot,
              proposal,
              event,
              input.ids,
              input.clock,
            ),
          ],
          checkpoint: checkpointWrite(input.snapshot, checkpoint, {
            kind: 'tool',
            turnIndex: proposal.turnIndex,
            nextProposalSequence: proposal.proposalSequence,
          }),
        },
        now,
      );
      return preparedExecution(
        proposal.toolExecutionId,
        1,
        idempotencyKey,
        deadline,
        tool,
        signal,
        input.timer,
      );
    },
    consumeRejectedApproval: async ({
      authorization,
      approvalEvent,
      endEvent,
      checkpoint,
    }) => {
      const proposal = [...proposals.values()].find(
        (candidate) =>
          candidate.toolExecutionId === authorization.toolExecutionId,
      );
      if (!proposal)
        throw new TypeError('Agent recovery Approval proposal is unavailable');
      const reasonCode =
        authorization.decision === 'approval_denied'
          ? 'APPROVAL_DENIED'
          : authorization.decision === 'approval_expired'
            ? 'APPROVAL_EXPIRED'
            : 'APPROVAL_CANCELLED';
      await commit({
        mutations: [{ type: 'approval_wait_resumed' }],
        toolExecutions: [
          {
            type: 'tool_execution_approval_rejected',
            toolExecutionId: proposal.toolExecutionId,
            reasonCode,
          },
        ],
        approvals: [
          {
            type: 'approval_consumed',
            approvalId: authorization.approvalId,
            toolExecutionId: proposal.toolExecutionId,
            decisionId: authorization.decisionId,
            consumeId: nextId(input.ids, 'approval_consume'),
          },
        ],
        events: [
          toHarnessEvent(
            input.snapshot,
            proposal,
            approvalEvent,
            input.ids,
            input.clock,
          ),
          toHarnessEvent(
            input.snapshot,
            proposal,
            Object.freeze({
              ...endEvent,
              toolExecutionId: proposal.toolExecutionId,
              attempt: 0,
              status: 'failed' as const,
              effectOutcome: 'not_applied' as const,
            }),
            input.ids,
            input.clock,
          ),
        ],
        checkpoint: checkpointAfterTool(
          input.snapshot,
          checkpoint,
          proposal,
          proposals,
        ),
      });
    },
    prepare: async ({ tool, toolCallId, signal }) => {
      const proposal = requireProposal(proposals, toolCallId);
      const now = input.clock.now();
      const deadline = addMilliseconds(now, tool.execution.timeoutMs);
      const idempotencyKey =
        tool.execution.idempotency === 'keyed' ? randomUUID() : undefined;
      await commit(
        {
          mutations: [],
          toolExecutions: [
            {
              type: 'tool_execution_prepared',
              toolExecutionId: proposal.toolExecutionId,
              ...tool.execution,
              idempotencyKey,
              deadline,
            },
          ],
        },
        now,
      );
      return preparedExecution(
        proposal.toolExecutionId,
        1,
        idempotencyKey,
        deadline,
        tool,
        signal,
        input.timer,
      );
    },
    start: async ({ execution, event }) => {
      const proposal = requireProposal(proposals, event.toolCallId);
      const attemptId = nextId(input.ids, 'tool_attempt');
      attempts.set(execution.toolExecutionId, attemptId);
      const enriched = Object.freeze({
        ...event,
        toolExecutionId: execution.toolExecutionId,
        attemptId,
        attempt: execution.attempt,
      });
      await commit(
        {
          mutations: [],
          toolExecutions: [
            {
              type: 'tool_execution_started',
              toolExecutionId: execution.toolExecutionId,
              attemptId,
              attempt: execution.attempt,
            },
          ],
          events: [
            toHarnessEvent(
              input.snapshot,
              proposal,
              enriched,
              input.ids,
              input.clock,
            ),
          ],
        },
        input.clock.now(),
      );
    },
    reject: async ({ toolCallId, event, checkpoint, reasonCode }) => {
      const proposal = requireProposal(proposals, toolCallId);
      const enriched = Object.freeze({
        ...event,
        toolExecutionId: proposal.toolExecutionId,
        attempt: 0,
        status: 'failed' as const,
        effectOutcome: 'not_applied' as const,
      });
      await commit({
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_rejected',
            toolExecutionId: proposal.toolExecutionId,
            reasonCode,
          },
        ],
        events: [
          toHarnessEvent(
            input.snapshot,
            proposal,
            enriched,
            input.ids,
            input.clock,
          ),
        ],
        checkpoint: checkpointAfterTool(
          input.snapshot,
          checkpoint,
          proposal,
          proposals,
        ),
      });
    },
    finish: async ({
      execution,
      event,
      checkpoint,
      status,
      effectOutcome,
      retryable,
      errorCode,
      result,
    }) => {
      const proposal = requireProposal(proposals, event.toolCallId);
      const attemptId = attempts.get(execution.toolExecutionId);
      if (!attemptId)
        throw new TypeError('Agent recovery tool Attempt is unavailable');
      const enriched = Object.freeze({
        ...event,
        toolExecutionId: execution.toolExecutionId,
        attemptId,
        attempt: execution.attempt,
        status,
        effectOutcome,
      });
      await commit({
        mutations: [],
        toolExecutions: [
          {
            type: 'tool_execution_finished',
            toolExecutionId: execution.toolExecutionId,
            attemptId,
            status,
            effectOutcome,
            retryable,
            errorCode,
            resultDigest: hashRuntimeCommit(result),
          },
        ],
        events: [
          toHarnessEvent(
            input.snapshot,
            proposal,
            enriched,
            input.ids,
            input.clock,
          ),
        ],
        checkpoint: checkpointAfterTool(
          input.snapshot,
          checkpoint,
          proposal,
          proposals,
        ),
      });
      attempts.delete(execution.toolExecutionId);
    },
  };
  return Object.freeze(coordinator);
}

function preparedExecution(
  toolExecutionId: string,
  attempt: number,
  idempotencyKey: string | undefined,
  deadline: string,
  tool: AgentTool,
  signal: AbortSignal,
  timer: AgentTimer,
): PreparedAgentToolExecution {
  const timeout = new AbortController();
  let timedOut = false;
  const cancel = timer.schedule(tool.execution.timeoutMs, () => {
    timedOut = true;
    timeout.abort('Agent recovery tool timed out');
  });
  return Object.freeze({
    toolExecutionId,
    attempt,
    idempotencyKey,
    deadline,
    signal: AbortSignal.any([signal, timeout.signal]),
    timedOut: () => timedOut,
    dispose: cancel,
  });
}

function checkpointAfterTool(
  snapshot: AgentRunRecoverySnapshot,
  checkpoint: AgentCheckpointFrame,
  current: ProposedExecution,
  proposals: ReadonlyMap<string, ProposedExecution>,
): AgentRuntimeCheckpointWrite {
  const next = [...proposals.values()]
    .filter(
      (proposal) =>
        proposal.turnIndex === current.turnIndex &&
        proposal.proposalSequence > current.proposalSequence,
    )
    .sort((left, right) => left.proposalSequence - right.proposalSequence)[0];
  return checkpointWrite(
    snapshot,
    checkpoint,
    checkpoint.executionPosition === 'tool' && next
      ? {
          kind: 'tool',
          turnIndex: current.turnIndex,
          nextProposalSequence: next.proposalSequence,
        }
      : checkpoint.executionPosition === 'model' &&
          checkpoint.nextTurnIndex !== undefined
        ? { kind: 'model', nextTurnIndex: checkpoint.nextTurnIndex }
        : undefined,
  );
}

function checkpointWrite(
  snapshot: AgentRunRecoverySnapshot,
  checkpoint: AgentCheckpointFrame,
  resumeState: AgentRuntimeCheckpointWrite['resumeState'],
): AgentRuntimeCheckpointWrite {
  if (!resumeState)
    throw new TypeError('Agent recovery tool checkpoint is unsupported');
  return Object.freeze({
    kind: checkpoint.kind,
    transcript: checkpoint.transcript,
    turnIndex: checkpoint.turnIndex,
    executionPosition: checkpoint.executionPosition,
    nextTurnIndex: checkpoint.nextTurnIndex,
    resumeState,
    harnessProtocolVersion: snapshot.checkpoint.harnessProtocolVersion,
    checkpointSchemaVersion: snapshot.checkpoint.checkpointSchemaVersion,
    configFingerprint: snapshot.checkpoint.configFingerprint,
  });
}

function requireProposal(
  proposals: ReadonlyMap<string, ProposedExecution>,
  toolCallId: string,
): ProposedExecution {
  const proposal = proposals.get(toolCallId);
  if (!proposal)
    throw new TypeError('Agent recovery tool proposal is unavailable');
  return proposal;
}

function toHarnessEvent(
  snapshot: AgentRunRecoverySnapshot,
  proposal: ProposedExecution,
  event: AgentEvent,
  ids: AgentIdGenerator,
  clock: AgentClock,
): AgentHarnessEvent {
  return Object.freeze({
    eventId: nextId(ids, 'event'),
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    sessionId: snapshot.task.sessionId,
    taskId: snapshot.taskId,
    runId: snapshot.runId,
    turnId: proposal.turnId,
    turnIndex: proposal.turnIndex,
    sequence: event.sequence,
    occurredAt: clock.now(),
    payload: toHarnessPayload(event),
  });
}

function scope(snapshot: AgentRunRecoverySnapshot) {
  return {
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    taskId: snapshot.taskId,
    runId: snapshot.runId,
  } as const;
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

function validApprovalRequest(
  expiresAt: string,
  presentation: { readonly title: string },
): boolean {
  return (
    Number.isFinite(Date.parse(expiresAt)) &&
    presentation.title.trim() !== '' &&
    Buffer.byteLength(JSON.stringify(presentation), 'utf8') <= 32 * 1024
  );
}

function waitForApproval(
  timer: AgentTimer,
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted)
    return Promise.reject(
      new TypeError('Agent recovery Approval wait stopped'),
    );
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
      reject(new TypeError('Agent recovery Approval wait stopped'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
