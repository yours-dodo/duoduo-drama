import { randomUUID } from 'node:crypto';

import { createAgentRuntime } from '../../ai/runtime.js';
import { AgentError } from '../errors.js';
import { runAgentLoop, type AgentCheckpointFrame } from '../run-loop.js';
import {
  assertAgentToolExecutionDeclaration,
  type AgentToolAuthorizationResult,
} from '../tool-execution.js';
import type { AgentEvent, AgentRunResult } from '../types.js';
import {
  decodeApprovalCursor,
  encodeApprovalCursor,
} from './approval-cursor.js';
import { hashRuntimeCommit } from './commit-hash.js';
import { AsyncEventQueue } from './event-queue.js';
import { decodeEventCursor, encodeEventCursor } from './event-cursor.js';
import { createInMemoryAgentRuntimeStore } from './in-memory-state.js';
import { toHarnessPayload, turnStatusForResult } from './runtime-event.js';
import {
  decodeToolExecutionCursor,
  encodeToolExecutionCursor,
} from './tool-execution-cursor.js';
import type {
  AgentApprovalDecisionReceipt,
  AgentRuntimeCheckpointWrite,
  AgentRuntimeResumeState,
  AgentApprovalMutation,
  AgentRuntimeMutation,
  AgentRuntimeStore,
  AgentToolExecutionMutation,
  CommitAgentRuntimeTaskCommand,
  CreateAgentRuntimeTaskCommand,
  DecideAgentRuntimeApprovalCommand,
} from './runtime-store.js';
import type {
  AgentApprovalPage,
  AgentClock,
  AgentHarness,
  AgentHarnessEvent,
  AgentEventPage,
  AgentIdGenerator,
  AgentIdKind,
  AgentTaskHandle,
  AgentTaskResult,
  AgentTimer,
  AgentToolExecutionPage,
  CancelAgentTaskCommand,
  CreateAgentHarnessOptions,
  DecideAgentApprovalCommand,
  ReadAgentApprovalsQuery,
  ReadAgentEventsQuery,
  ReadAgentToolExecutionsQuery,
  ScopedTaskQuery,
  StartAgentTaskCommand,
} from './types.js';

interface ActiveTask {
  readonly controller: AbortController;
  readonly result: Promise<AgentTaskResult>;
  handoff(): Promise<void>;
}

interface ActiveApprovalWaiter {
  resolve(receipt: AgentApprovalDecisionReceipt): void;
}

interface ProposedToolExecution {
  readonly toolExecutionId: string;
  readonly argumentsDigest: string;
  readonly proposalSequence: number;
}

export async function createAgentHarness<TScopeHandle>(
  options: CreateAgentHarnessOptions<TScopeHandle>,
): Promise<AgentHarness> {
  const {
    ai,
    model,
    ids,
    clock,
    timer,
    tools,
    maxTurns,
    maxBufferedEvents,
    maxBatchEvents,
    maxBatchWaitMs,
    approvalPolicy,
    runLeaseDurationMs,
    runLeaseHeartbeatIntervalMs,
  } = await initializeHarness(options);
  const runtimeStore =
    options.runtimeStore ?? createInMemoryAgentRuntimeStore();
  const checkpointSchemaVersion =
    runtimeStore.checkpointResumeSupport === 'v3'
      ? RESUMABLE_CHECKPOINT_SCHEMA_VERSION
      : LEGACY_CHECKPOINT_SCHEMA_VERSION;
  const configFingerprint = hashRuntimeCommit({
    harnessProtocolVersion: HARNESS_PROTOCOL_VERSION,
    checkpointSchemaVersion,
    model: model.ref,
    modelIdentity: model.identity,
    systemPrompt: options.systemPrompt,
    tools: tools.map((tool) => tool.definition),
    approvalPolicy: approvalPolicy
      ? {
          policyId: approvalPolicy.policyId,
          version: approvalPolicy.version,
        }
      : undefined,
  });
  const ownsRuntimeStore = options.runtimeStore === undefined;
  const activeTasks = new Map<string, ActiveTask>();
  const activeApprovalWaiters = new Map<string, ActiveApprovalWaiter>();
  const leaseOwnerId = randomUUID();
  let disposed = false;
  let lifecyclePromise: Promise<void> | undefined;

  const startTask = async (
    command: StartAgentTaskCommand,
  ): Promise<AgentTaskHandle> => {
    assertNotDisposed(disposed);
    validateScope(command.scope);
    const taskId = nextId(ids, 'task');
    const runId = nextId(ids, 'run');
    const query = {
      tenantId: command.scope.tenantId,
      projectId: command.scope.projectId,
      taskId,
    };
    const usesRunLease =
      runtimeStore.durability === 'durable' &&
      runtimeStore.runLeaseSupport === 'v1';
    const acceptedAt = clock.now();
    const createReceipt = await createRuntimeTaskDurably(runtimeStore, {
      scope: command.scope,
      taskId,
      runId,
      commitId: nextId(ids, 'commit'),
      now: acceptedAt,
      checkpoint: {
        kind: 'input_accepted',
        input: command.input,
        transcript: [],
        executionPosition: 'model',
        nextTurnIndex: 1,
        resumeState:
          checkpointSchemaVersion === RESUMABLE_CHECKPOINT_SCHEMA_VERSION
            ? { kind: 'model', nextTurnIndex: 1 }
            : undefined,
        harnessProtocolVersion: HARNESS_PROTOCOL_VERSION,
        checkpointSchemaVersion,
        configFingerprint,
      },
      initialLease: usesRunLease
        ? {
            ownershipId: randomUUID(),
            ownerId: leaseOwnerId,
            leaseExpiresAt: addMilliseconds(acceptedAt, runLeaseDurationMs),
          }
        : undefined,
    });
    let stateVersion = createReceipt.version;
    let runLease = createReceipt.lease;
    if (usesRunLease && !runLease)
      throw durabilityFailure(
        new TypeError('Durable Agent Run lease was not created'),
      );

    const commitOwnedRuntimeTask = (commit: CommitAgentRuntimeTaskCommand) => {
      if (ownershipLoss) return Promise.reject(ownershipLoss);
      return commitRuntimeTaskDurably(runtimeStore, {
        ...commit,
        lease: currentLeaseGuard(runLease),
      });
    };

    const controller = new AbortController();
    const signal = command.signal
      ? AbortSignal.any([command.signal, controller.signal])
      : controller.signal;
    const events = new AsyncEventQueue<AgentHarnessEvent>(maxBufferedEvents);
    const turnIds = new Map<number, string>();
    let activeTurnIndex: number | undefined;
    let observerOverflowed = false;
    let observerDetached = false;
    let overflowExecution: AgentRunResult | undefined;
    let terminalExecution: AgentRunResult | undefined;
    let lastSequence = 0;
    let processingFailureSequence: number | undefined;
    let terminalCheckpoint: AgentRuntimeCheckpointWrite | undefined;
    const pendingDeltas: PendingAgentEvent[] = [];
    let cancelDeltaTimer: (() => void) | undefined;
    let commitChain = Promise.resolve();
    let pumpFailure: unknown;
    let toolProposalSequence = 0;
    const proposedTools = new Map<string, ProposedToolExecution>();
    const activeToolAttempts = new Map<string, string>();
    let cancelLeaseHeartbeat: (() => void) | undefined;
    let leaseHeartbeatStopped = false;
    let ownershipLoss: AgentError | undefined;

    const loseOwnership = (): void => {
      if (ownershipLoss) return;
      ownershipLoss = new AgentError(
        'AGENT_EXECUTION_OWNERSHIP_LOST',
        'Agent Run execution ownership was lost',
      );
      leaseHeartbeatStopped = true;
      cancelLeaseHeartbeat?.();
      cancelLeaseHeartbeat = undefined;
      controller.abort('Agent Run execution ownership was lost');
      events.fail(ownershipLoss);
    };

    const scheduleLeaseHeartbeat = (): void => {
      if (leaseHeartbeatStopped || !runLease || cancelLeaseHeartbeat) return;
      cancelLeaseHeartbeat = timer.schedule(runLeaseHeartbeatIntervalMs, () => {
        cancelLeaseHeartbeat = undefined;
        void renewLease().catch(() => loseOwnership());
      });
    };

    const renewLease = async (): Promise<void> => {
      const currentLease = runLease;
      if (leaseHeartbeatStopped || !currentLease) return;
      const now = clock.now();
      runLease = await renewRunLeaseDurably(runtimeStore, {
        ...query,
        runId,
        renewalId: randomUUID(),
        ownerId: currentLease.ownerId,
        leaseToken: currentLease.leaseToken,
        fencingToken: currentLease.fencingToken,
        now,
        leaseExpiresAt: addMilliseconds(now, runLeaseDurationMs),
      });
      scheduleLeaseHeartbeat();
    };

    stateVersion = (
      await commitOwnedRuntimeTask({
        ...query,
        runId,
        commitId: nextId(ids, 'commit'),
        expectedVersion: stateVersion,
        mutations: [{ type: 'run_started' }],
        now: clock.now(),
      })
    ).version;
    scheduleLeaseHeartbeat();

    const publishEvent = (
      harnessEvent: AgentHarnessEvent,
      terminal: boolean,
    ): void => {
      if (observerDetached) return;
      if (observerOverflowed) {
        if (terminal) events.replaceWithTerminal(harnessEvent);
        return;
      }
      if (terminal) {
        events.pushTerminal(harnessEvent);
        return;
      }
      if (events.push(harnessEvent)) return;
      if (runtimeStore.durability === 'durable') {
        observerDetached = true;
        events.fail(
          new AgentError(
            'AGENT_OBSERVER_OVERFLOW',
            'Agent live event observer overflowed; continue with readEvents()',
          ),
        );
      } else {
        observerOverflowed = true;
        controller.abort('Agent Harness event buffer overflow');
      }
    };

    const processEvent = async (
      event: AgentEvent,
      occurredAt: string,
      extras?: {
        readonly additionalEvents?: readonly AgentEvent[];
        readonly mutations?: readonly AgentRuntimeMutation[];
        readonly approvals?: readonly AgentApprovalMutation[];
        readonly toolExecutions?: readonly AgentToolExecutionMutation[];
        readonly checkpoint?: AgentRuntimeCheckpointWrite;
      },
    ): Promise<void> => {
      const observerAlreadyOverflowed = observerOverflowed;
      let effectiveEvent = event;
      if (observerAlreadyOverflowed && event.type === 'run_end') {
        overflowExecution = eventBufferOverflowResult(event.result);
        effectiveEvent = Object.freeze({
          ...event,
          result: overflowExecution,
        });
      }

      const turnIndex =
        'turn' in effectiveEvent ? effectiveEvent.turn : undefined;
      const mutations: AgentRuntimeMutation[] = [...(extras?.mutations ?? [])];
      if (effectiveEvent.type === 'turn_start') {
        if (activeTurnIndex !== undefined)
          mutations.push({
            type: 'turn_finished',
            turnIndex: activeTurnIndex,
            status: 'completed',
          });
        const turnId = nextId(ids, 'turn');
        turnIds.set(effectiveEvent.turn, turnId);
        mutations.push({
          type: 'turn_started',
          turnId,
          turnIndex: effectiveEvent.turn,
        });
      } else if (effectiveEvent.type === 'run_end') {
        if (activeTurnIndex !== undefined)
          mutations.push({
            type: 'turn_finished',
            turnIndex: activeTurnIndex,
            status: turnStatusForResult(effectiveEvent.result),
          });
        mutations.push({
          type: 'run_finished',
          status: effectiveEvent.result.status,
          transcript: effectiveEvent.result.transcript,
        });
      }

      const harnessEvent = toHarnessEvent({
        event: effectiveEvent,
        taskId,
        runId,
        scope: command.scope,
        turnId: turnIndex === undefined ? undefined : turnIds.get(turnIndex),
        ids,
        occurredAt,
      });
      const additionalHarnessEvents = (extras?.additionalEvents ?? []).map(
        (additionalEvent) =>
          toHarnessEvent({
            event: additionalEvent,
            taskId,
            runId,
            scope: command.scope,
            turnId:
              'turn' in additionalEvent
                ? turnIds.get(additionalEvent.turn)
                : undefined,
            ids,
            occurredAt,
          }),
      );
      stateVersion = (
        await commitOwnedRuntimeTask({
          ...query,
          runId,
          commitId: nextId(ids, 'commit'),
          expectedVersion: stateVersion,
          mutations,
          approvals: extras?.approvals,
          toolExecutions: extras?.toolExecutions,
          events: [harnessEvent, ...additionalHarnessEvents],
          checkpoint:
            extras?.checkpoint ??
            (effectiveEvent.type === 'run_end'
              ? (terminalCheckpoint ??
                runtimeCheckpoint(
                  {
                    kind: 'run_terminal',
                    transcript: effectiveEvent.result.transcript,
                    turnIndex: effectiveEvent.result.turns,
                    executionPosition: 'terminal',
                    result: effectiveEvent.result,
                  },
                  configFingerprint,
                  checkpointSchemaVersion,
                ))
              : undefined),
          now: occurredAt,
        })
      ).version;
      if (effectiveEvent.type === 'turn_start')
        activeTurnIndex = effectiveEvent.turn;
      else if (effectiveEvent.type === 'run_end') activeTurnIndex = undefined;

      publishEvent(harnessEvent, effectiveEvent.type === 'run_end');
      for (const additionalEvent of additionalHarnessEvents)
        publishEvent(additionalEvent, false);
    };

    const processDeltaBatch = async (
      batch: readonly PendingAgentEvent[],
    ): Promise<void> => {
      if (batch.length === 0) return;
      const harnessEvents = batch.map(({ event, occurredAt }) => {
        if (!('turn' in event))
          throw new TypeError('Durable delta event has no Turn');
        return toHarnessEvent({
          event,
          taskId,
          runId,
          scope: command.scope,
          turnId: turnIds.get(event.turn),
          ids,
          occurredAt,
        });
      });
      stateVersion = (
        await commitOwnedRuntimeTask({
          ...query,
          runId,
          commitId: nextId(ids, 'commit'),
          expectedVersion: stateVersion,
          mutations: [],
          events: harnessEvents,
          now: batch.at(-1)?.occurredAt ?? clock.now(),
        })
      ).version;
      for (const harnessEvent of harnessEvents)
        publishEvent(harnessEvent, false);
    };

    const startDeltaFlush = (): Promise<void> => {
      cancelDeltaTimer?.();
      cancelDeltaTimer = undefined;
      if (pumpFailure !== undefined) return Promise.reject(pumpFailure);
      if (pendingDeltas.length === 0) return commitChain;
      const batch = pendingDeltas.splice(0, maxBatchEvents);
      const operation = commitChain.then(() => processDeltaBatch(batch));
      commitChain = operation.catch((error: unknown) => {
        pumpFailure ??= error;
      });
      if (pendingDeltas.length > 0) scheduleDeltaFlush();
      return operation;
    };

    const scheduleDeltaFlush = (): void => {
      if (cancelDeltaTimer || pendingDeltas.length === 0) return;
      cancelDeltaTimer = timer.schedule(maxBatchWaitMs, () => {
        cancelDeltaTimer = undefined;
        void startDeltaFlush().catch(() => undefined);
      });
    };

    const flushEvents = async (): Promise<void> => {
      cancelDeltaTimer?.();
      cancelDeltaTimer = undefined;
      while (pendingDeltas.length > 0) await startDeltaFlush();
      await commitChain;
      if (pumpFailure !== undefined) throw pumpFailure;
    };

    const enqueueEvent = async (
      event: AgentEvent,
      occurredAt: string,
    ): Promise<void> => {
      if (pumpFailure !== undefined) throw pumpFailure;
      if (!isDurableDelta(event)) {
        await flushEvents();
        await processEvent(event, occurredAt);
        return;
      }
      pendingDeltas.push({ event, occurredAt });
      scheduleDeltaFlush();
      if (pendingDeltas.length >= maxBatchEvents) await startDeltaFlush();
    };

    const toolExecutionCoordinator = {
      propose: async ({ calls, turn, checkpoint }) => {
        await flushEvents();
        const turnId = turnIds.get(turn);
        if (!turnId) throw new TypeError('Agent tool execution Turn not found');
        const now = clock.now();
        const firstProposalSequence = toolProposalSequence + 1;
        const toolExecutions: AgentToolExecutionMutation[] = calls.map(
          (call) => {
            if (proposedTools.has(call.id))
              throw new TypeError('Agent tool call ID collision');
            const toolExecutionId = nextId(ids, 'tool_execution');
            const argumentsDigest = hashRuntimeCommit(call.rawArguments);
            const proposalSequence = ++toolProposalSequence;
            proposedTools.set(call.id, {
              toolExecutionId,
              argumentsDigest,
              proposalSequence,
            });
            return {
              type: 'tool_execution_proposed',
              toolExecutionId,
              toolCallId: call.id,
              turnId,
              turnIndex: turn,
              proposalSequence,
              toolName: call.name,
              argumentsDigest,
            };
          },
        );
        stateVersion = (
          await commitOwnedRuntimeTask({
            ...query,
            runId,
            commitId: nextId(ids, 'commit'),
            expectedVersion: stateVersion,
            mutations: [],
            toolExecutions,
            checkpoint: runtimeCheckpoint(
              checkpoint,
              configFingerprint,
              checkpointSchemaVersion,
              {
                kind: 'tool',
                turnIndex: turn,
                nextProposalSequence: firstProposalSequence,
              },
            ),
            now,
          })
        ).version;
      },
      authorize: async ({ tool, toolCallId, turn, arguments: arguments_ }) => {
        if (!approvalPolicy) return { decision: 'allow' as const };
        const proposal = proposedTools.get(toolCallId);
        if (!proposal)
          throw new TypeError('Agent tool execution proposal not found');
        const turnId = turnIds.get(turn);
        if (!turnId) throw new TypeError('Agent tool execution Turn not found');
        try {
          const decision: unknown = await approvalPolicy.evaluate(
            Object.freeze({
              scope: Object.freeze({ ...command.scope }),
              taskId,
              runId,
              turnId,
              turnIndex: turn,
              toolExecutionId: proposal.toolExecutionId,
              toolCallId,
              toolName: tool.definition.name,
              arguments: arguments_,
              argumentsDigest: proposal.argumentsDigest,
              execution: tool.execution,
            }),
          );
          if (!isApprovalPolicyResult(decision)) return approvalPolicyFailed();
          if (decision.decision === 'allow')
            return { decision: 'allow' as const };
          if (decision.decision === 'deny')
            return isApprovalReasonCode(decision.reasonCode)
              ? { decision: 'deny' as const }
              : approvalPolicyFailed();
          return approvalRequestFromPolicy({
            decision,
            approvalId: nextId(ids, 'approval'),
            proposal,
            policyId: approvalPolicy.policyId,
            policyVersion: approvalPolicy.version,
            now: clock.now(),
          });
        } catch {
          return approvalPolicyFailed();
        }
      },
      requestApproval: async ({
        authorization,
        tool,
        toolCallId,
        event,
        checkpoint,
        signal,
      }) => {
        await flushEvents();
        const proposal = proposedTools.get(toolCallId);
        if (
          !proposal ||
          proposal.toolExecutionId !== authorization.toolExecutionId
        )
          throw new TypeError('Agent Approval proposal not found');
        const turnId = turnIds.get(event.turn);
        if (!turnId) throw new TypeError('Agent Approval Turn not found');
        const waiterKey = approvalWaiterKey({
          ...query,
          runId,
          approvalId: authorization.approvalId,
        });
        if (activeApprovalWaiters.has(waiterKey))
          throw new TypeError('Agent Approval already has a local waiter');
        let resolveDecision!: (receipt: AgentApprovalDecisionReceipt) => void;
        let rejectDecision!: (cause: unknown) => void;
        let decisionSettled = false;
        const decisionPromise = new Promise<AgentApprovalDecisionReceipt>(
          (resolve, reject) => {
            resolveDecision = resolve;
            rejectDecision = reject;
          },
        );
        const settleDecision = (
          receipt: AgentApprovalDecisionReceipt,
        ): void => {
          if (decisionSettled) return;
          decisionSettled = true;
          resolveDecision(receipt);
        };
        const failDecision = (cause: unknown): void => {
          if (decisionSettled) return;
          decisionSettled = true;
          rejectDecision(cause);
        };
        activeApprovalWaiters.set(waiterKey, { resolve: settleDecision });
        try {
          await processEvent(event, clock.now(), {
            mutations: [{ type: 'approval_wait_started' }],
            toolExecutions: [
              {
                type: 'tool_execution_awaiting_approval',
                toolExecutionId: authorization.toolExecutionId,
                ...tool.execution,
              },
            ],
            approvals: [
              {
                type: 'approval_requested',
                approvalId: authorization.approvalId,
                toolExecutionId: authorization.toolExecutionId,
                turnId,
                proposalSequence: proposal.proposalSequence,
                policyId: authorization.policyId,
                policyVersion: authorization.policyVersion,
                argumentsDigest: authorization.argumentsDigest,
                expiresAt: authorization.expiresAt,
                presentation: authorization.presentation,
              },
            ],
            checkpoint: runtimeCheckpoint(
              checkpoint,
              configFingerprint,
              checkpointSchemaVersion,
              {
                kind: 'approval',
                turnIndex: event.turn,
                approvalId: authorization.approvalId,
                toolExecutionId: authorization.toolExecutionId,
              },
            ),
          });
          const resolveTerminal = async (
            resolution: 'expired' | 'cancelled',
          ): Promise<void> => {
            try {
              const receipt = await runtimeStore.resolveApproval({
                ...query,
                runId,
                approvalId: authorization.approvalId,
                commitId: nextId(ids, 'commit'),
                resolution,
                lease: currentLeaseGuard(runLease),
                now: clock.now(),
              });
              settleDecision(receipt);
            } catch (cause) {
              if (isRunLeaseLost(cause)) {
                loseOwnership();
                failDecision(ownershipLoss!);
                return;
              }
              failDecision(durabilityFailure(cause));
            }
          };
          let cancelPoll = (): void => undefined;
          const pollApproval = async (): Promise<void> => {
            if (decisionSettled) return;
            try {
              const approvals = await readRuntimeDurably(() =>
                runtimeStore.readApprovals({ ...query, runId }),
              );
              const approval = approvals.find(
                (candidate) =>
                  candidate.approvalId === authorization.approvalId,
              );
              if (!approval)
                throw new AgentError(
                  'AGENT_DURABILITY_FAILED',
                  'Agent Approval waiter state is unavailable',
                );
              if (approval.status !== 'pending') {
                const task = await readRuntimeDurably(() =>
                  runtimeStore.getTask(query),
                );
                if (!task)
                  throw new AgentError(
                    'AGENT_DURABILITY_FAILED',
                    'Agent Approval waiter Task is unavailable',
                  );
                settleDecision(
                  Object.freeze({ approval, version: task.version }),
                );
                return;
              }
              cancelPoll = timer.schedule(APPROVAL_POLL_INTERVAL_MS, () => {
                void pollApproval();
              });
            } catch (cause) {
              failDecision(durabilityFailure(cause));
            }
          };
          cancelPoll = timer.schedule(APPROVAL_POLL_INTERVAL_MS, () => {
            void pollApproval();
          });
          const expiresInMs = Math.max(
            0,
            Date.parse(authorization.expiresAt) - Date.parse(clock.now()),
          );
          const cancelExpiry = timer.schedule(expiresInMs, () => {
            void resolveTerminal('expired');
          });
          const onAbort = (): void => {
            if (ownershipLoss) {
              failDecision(ownershipLoss);
              return;
            }
            void resolveTerminal('cancelled');
          };
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
          let receipt: AgentApprovalDecisionReceipt;
          try {
            receipt = await decisionPromise;
          } finally {
            cancelPoll();
            cancelExpiry();
            signal.removeEventListener('abort', onAbort);
          }
          if (receipt.approval.status === 'approved')
            return {
              decision: 'approved' as const,
              approvalId: receipt.approval.approvalId,
              toolExecutionId: receipt.approval.toolExecutionId,
              decisionId: receipt.approval.decisionId!,
              decidedBy: receipt.approval.decidedBy!,
              reasonCode: receipt.approval.decisionReasonCode,
              taskVersion: receipt.version,
            };
          return {
            decision: `approval_${receipt.approval.status}` as
              'approval_denied' | 'approval_expired' | 'approval_cancelled',
            approvalId: receipt.approval.approvalId,
            toolExecutionId: receipt.approval.toolExecutionId,
            decisionId: receipt.approval.decisionId,
            decidedBy: receipt.approval.decidedBy,
            reasonCode: receipt.approval.decisionReasonCode,
            taskVersion: receipt.version,
          };
        } finally {
          activeApprovalWaiters.delete(waiterKey);
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
        await flushEvents();
        stateVersion = authorization.taskVersion;
        const now = clock.now();
        const deadline = new Date(
          new Date(now).getTime() + tool.execution.timeoutMs,
        ).toISOString();
        const idempotencyKey =
          tool.execution.idempotency === 'keyed' ? randomUUID() : undefined;
        const proposal = proposedTools.get(toolCallId);
        if (!proposal)
          throw new TypeError('Agent tool execution proposal not found');
        await processEvent(event, now, {
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
              consumeId: nextId(ids, 'approval_consume'),
            },
          ],
          checkpoint: runtimeCheckpoint(
            checkpoint,
            configFingerprint,
            checkpointSchemaVersion,
            {
              kind: 'tool',
              turnIndex: event.turn,
              nextProposalSequence: proposal.proposalSequence,
            },
          ),
        });
        const timeoutController = new AbortController();
        let timedOut = false;
        const cancelTimeout = timer.schedule(tool.execution.timeoutMs, () => {
          timedOut = true;
          timeoutController.abort('Agent tool execution timed out');
        });
        return Object.freeze({
          toolExecutionId: authorization.toolExecutionId,
          attempt: 1,
          idempotencyKey,
          deadline,
          signal: AbortSignal.any([signal, timeoutController.signal]),
          timedOut: () => timedOut,
          dispose: cancelTimeout,
        });
      },
      consumeRejectedApproval: async ({
        authorization,
        approvalEvent,
        endEvent,
        checkpoint,
      }) => {
        await flushEvents();
        stateVersion = authorization.taskVersion;
        const now = clock.now();
        const reasonCode =
          authorization.decision === 'approval_denied'
            ? 'APPROVAL_DENIED'
            : authorization.decision === 'approval_expired'
              ? 'APPROVAL_EXPIRED'
              : 'APPROVAL_CANCELLED';
        const proposal = findProposalByExecutionId(
          proposedTools,
          authorization.toolExecutionId,
        );
        await processEvent(approvalEvent, now, {
          additionalEvents: [
            Object.freeze({
              ...endEvent,
              toolExecutionId: authorization.toolExecutionId,
              attempt: 0,
              status: 'failed' as const,
              effectOutcome: 'not_applied' as const,
            }),
          ],
          mutations: [{ type: 'approval_wait_resumed' }],
          toolExecutions: [
            {
              type: 'tool_execution_approval_rejected',
              toolExecutionId: authorization.toolExecutionId,
              reasonCode,
            },
          ],
          approvals: [
            {
              type: 'approval_consumed',
              approvalId: authorization.approvalId,
              toolExecutionId: authorization.toolExecutionId,
              decisionId: authorization.decisionId,
              consumeId: nextId(ids, 'approval_consume'),
            },
          ],
          checkpoint: runtimeCheckpointAfterTool(
            checkpoint,
            configFingerprint,
            checkpointSchemaVersion,
            proposal.proposalSequence,
          ),
        });
      },
      prepare: async ({ tool, toolCallId, signal }) => {
        await flushEvents();
        const proposal = proposedTools.get(toolCallId);
        if (!proposal)
          throw new TypeError('Agent tool execution proposal not found');
        const now = clock.now();
        const deadline = new Date(
          new Date(now).getTime() + tool.execution.timeoutMs,
        ).toISOString();
        const idempotencyKey =
          tool.execution.idempotency === 'keyed' ? randomUUID() : undefined;
        stateVersion = (
          await commitOwnedRuntimeTask({
            ...query,
            runId,
            commitId: nextId(ids, 'commit'),
            expectedVersion: stateVersion,
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
            now,
          })
        ).version;
        const timeoutController = new AbortController();
        let timedOut = false;
        const cancelTimeout = timer.schedule(tool.execution.timeoutMs, () => {
          timedOut = true;
          timeoutController.abort('Agent tool execution timed out');
        });
        return Object.freeze({
          toolExecutionId: proposal.toolExecutionId,
          attempt: 1,
          idempotencyKey,
          deadline,
          signal: AbortSignal.any([signal, timeoutController.signal]),
          timedOut: () => timedOut,
          dispose: cancelTimeout,
        });
      },
      start: async ({ execution, event }) => {
        await flushEvents();
        const attemptId = nextId(ids, 'tool_attempt');
        await processEvent(
          Object.freeze({
            ...event,
            toolExecutionId: execution.toolExecutionId,
            attemptId,
            attempt: execution.attempt,
          }),
          clock.now(),
          {
            toolExecutions: [
              {
                type: 'tool_execution_started',
                toolExecutionId: execution.toolExecutionId,
                attemptId,
                attempt: execution.attempt,
              },
            ],
          },
        );
        activeToolAttempts.set(execution.toolExecutionId, attemptId);
      },
      reject: async ({ toolCallId, event, checkpoint, reasonCode }) => {
        await flushEvents();
        const proposal = proposedTools.get(toolCallId);
        if (!proposal)
          throw new TypeError('Agent tool execution proposal not found');
        await processEvent(
          Object.freeze({
            ...event,
            toolExecutionId: proposal.toolExecutionId,
            attempt: 0,
            status: 'failed' as const,
            effectOutcome: 'not_applied' as const,
          }),
          clock.now(),
          {
            toolExecutions: [
              {
                type: 'tool_execution_rejected',
                toolExecutionId: proposal.toolExecutionId,
                reasonCode,
              },
            ],
            checkpoint: runtimeCheckpointAfterTool(
              checkpoint,
              configFingerprint,
              checkpointSchemaVersion,
              proposal.proposalSequence,
            ),
          },
        );
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
        await flushEvents();
        const attemptId = activeToolAttempts.get(execution.toolExecutionId);
        if (!attemptId)
          throw new TypeError('Agent tool execution Attempt not found');
        const proposal = findProposalByExecutionId(
          proposedTools,
          execution.toolExecutionId,
        );
        await processEvent(
          Object.freeze({
            ...event,
            toolExecutionId: execution.toolExecutionId,
            attemptId,
            attempt: execution.attempt,
            status,
            effectOutcome,
          }),
          clock.now(),
          {
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
            checkpoint: runtimeCheckpointAfterTool(
              checkpoint,
              configFingerprint,
              checkpointSchemaVersion,
              proposal.proposalSequence,
            ),
          },
        );
        activeToolAttempts.delete(execution.toolExecutionId);
      },
    } satisfies Parameters<typeof runAgentLoop>[0]['toolExecutionCoordinator'];

    const loopPromise = runAgentLoop({
      ai,
      model,
      prompt: command.input,
      systemPrompt: options.systemPrompt,
      transcript: [],
      tools,
      maxTurns,
      signal,
      streamOptions: options.streamOptions,
      credentialOverride: options.model.readOptions?.credentialOverride,
      toolExecutionCoordinator,
      modelAttemptId: () => nextId(ids, 'model_attempt'),
      checkpoint: async (frame) => {
        if (
          checkpointSchemaVersion === RESUMABLE_CHECKPOINT_SCHEMA_VERSION &&
          frame.executionPosition === 'terminal' &&
          frame.kind !== 'run_terminal' &&
          !frame.result
        )
          return;
        const checkpoint = runtimeCheckpoint(
          frame,
          configFingerprint,
          checkpointSchemaVersion,
        );
        if (frame.kind === 'run_terminal') {
          terminalCheckpoint = checkpoint;
          return;
        }
        await flushEvents();
        stateVersion = (
          await commitOwnedRuntimeTask({
            ...query,
            runId,
            commitId: nextId(ids, 'commit'),
            expectedVersion: stateVersion,
            mutations: [],
            checkpoint,
            now: clock.now(),
          })
        ).version;
      },
      emit: async (event) => {
        lastSequence = event.sequence;
        if (event.type === 'run_end') terminalExecution = event.result;
        const occurredAt = clock.now();
        try {
          await enqueueEvent(event, occurredAt);
        } catch (error) {
          processingFailureSequence ??= event.sequence + 1;
          throw error;
        }
      },
    });

    const executionPromise = loopPromise
      .then(async (execution) => {
        if (ownershipLoss) throw ownershipLoss;
        await flushEvents();
        if (ownershipLoss) throw ownershipLoss;
        return execution;
      })
      .catch(async (cause: unknown) => {
        if (ownershipLoss || isRunLeaseLost(cause)) {
          loseOwnership();
          throw ownershipLoss!;
        }
        if (isDurabilityFailure(cause)) {
          controller.abort('Agent Harness durability failed');
          events.fail(cause);
          throw cause;
        }
        const completedTask = await runtimeStore.getTask(query);
        if (
          terminalExecution &&
          completedTask &&
          isTerminalStatus(completedTask.status)
        ) {
          events.replaceWithTerminal(
            toFallbackTerminalEvent({
              execution: terminalExecution,
              sequence: lastSequence,
              taskId,
              runId,
              scope: command.scope,
              ids,
              clock,
            }),
          );
          return terminalExecution;
        }

        const execution = unexpectedHarnessFailure(activeTurnIndex ?? 0);
        const occurredAt = safeNow(clock);
        const mutations: AgentRuntimeMutation[] = [];
        if (activeTurnIndex !== undefined)
          mutations.push({
            type: 'turn_finished',
            turnIndex: activeTurnIndex,
            status: 'failed',
          });
        mutations.push({
          type: 'run_finished',
          status: 'failed',
          transcript: execution.transcript,
        });
        stateVersion = (
          await commitOwnedRuntimeTask({
            ...query,
            runId,
            commitId: nextId(ids, 'commit'),
            expectedVersion: stateVersion,
            mutations,
            now: occurredAt,
          })
        ).version;
        activeTurnIndex = undefined;
        events.replaceWithTerminal(
          toFallbackTerminalEvent({
            execution,
            sequence: processingFailureSequence ?? lastSequence + 1,
            taskId,
            runId,
            scope: command.scope,
            ids,
            clock,
          }),
        );
        return execution;
      });

    const resultPromise = executionPromise
      .then((execution) =>
        taskResult(runtimeStore, query, runId, overflowExecution ?? execution),
      )
      .finally(() => {
        leaseHeartbeatStopped = true;
        cancelLeaseHeartbeat?.();
        cancelLeaseHeartbeat = undefined;
        activeTasks.delete(taskKey(query));
        events.end();
      });
    const handoffActiveTask = async (): Promise<void> => {
      const ownedLease = runLease;
      loseOwnership();
      await resultPromise.catch(() => undefined);
      if (!ownedLease) return;
      const now = clock.now();
      try {
        await releaseRunLeaseDurably(runtimeStore, {
          ...query,
          runId,
          releaseId: randomUUID(),
          ownerId: ownedLease.ownerId,
          leaseToken: ownedLease.leaseToken,
          fencingToken: ownedLease.fencingToken,
          now,
          availableAt: now,
          action: 'handoff',
          reasonCode: 'EXPLICIT_HANDOFF',
        });
      } catch (cause) {
        if (!isRunLeaseLost(cause)) throw cause;
      }
    };
    activeTasks.set(taskKey(query), {
      controller,
      result: resultPromise,
      handoff: handoffActiveTask,
    });

    return Object.freeze({
      taskId,
      runId,
      events,
      result: () => resultPromise,
      cancel: (reason?: string) => controller.abort(reason),
    });
  };

  return Object.freeze({
    startTask,
    getTask: (query: ScopedTaskQuery) =>
      readRuntimeDurably(() => runtimeStore.getTask(query)),
    readEvents: async (
      query: ReadAgentEventsQuery,
    ): Promise<AgentEventPage> => {
      const limit = query.limit ?? 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new TypeError('Agent event page limit must be between 1 and 500');
      const task = await readRuntimeDurably(() => runtimeStore.getTask(query));
      if (!task?.runs.some((run) => run.runId === query.runId))
        throw new AgentError('AGENT_RUN_NOT_FOUND', 'Agent run not found');
      const page = await readRuntimeDurably(() =>
        runtimeStore.readEvents({
          tenantId: query.tenantId,
          projectId: query.projectId,
          taskId: query.taskId,
          runId: query.runId,
          afterSequence: query.after
            ? decodeEventCursor(query, query.after)
            : 0,
          limit,
        }),
      );
      const lastEvent = page.events.at(-1);
      return Object.freeze({
        events: Object.freeze([...page.events]),
        nextCursor: lastEvent ? encodeEventCursor(query, lastEvent) : undefined,
        hasMore: page.hasMore,
      });
    },
    readToolExecutions: async (
      query: ReadAgentToolExecutionsQuery,
    ): Promise<AgentToolExecutionPage> => {
      const limit = query.limit ?? 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new TypeError(
          'Agent tool execution page limit must be between 1 and 500',
        );
      const task = await readRuntimeDurably(() => runtimeStore.getTask(query));
      if (!task?.runs.some((run) => run.runId === query.runId))
        throw new AgentError('AGENT_RUN_NOT_FOUND', 'Agent run not found');
      const afterSequence = query.after
        ? decodeToolExecutionCursor(query, query.after)
        : 0;
      const matching = (
        await readRuntimeDurably(() => runtimeStore.readToolExecutions(query))
      ).filter((execution) => execution.proposalSequence > afterSequence);
      const executions = matching.slice(0, limit);
      const lastExecution = executions.at(-1);
      return Object.freeze({
        executions: Object.freeze(executions),
        nextCursor: lastExecution
          ? encodeToolExecutionCursor(query, lastExecution)
          : undefined,
        hasMore: matching.length > limit,
      });
    },
    readApprovals: async (
      query: ReadAgentApprovalsQuery,
    ): Promise<AgentApprovalPage> => {
      const limit = query.limit ?? 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new TypeError(
          'Agent Approval page limit must be between 1 and 500',
        );
      const task = await readRuntimeDurably(() => runtimeStore.getTask(query));
      if (!task?.runs.some((run) => run.runId === query.runId))
        throw new AgentError('AGENT_RUN_NOT_FOUND', 'Agent run not found');
      const afterSequence = query.after
        ? decodeApprovalCursor(query, query.after)
        : 0;
      const matching = (
        await readRuntimeDurably(() => runtimeStore.readApprovals(query))
      ).filter((approval) => approval.proposalSequence > afterSequence);
      const approvals = matching.slice(0, limit);
      const lastApproval = approvals.at(-1);
      return Object.freeze({
        approvals: Object.freeze(approvals),
        nextCursor: lastApproval
          ? encodeApprovalCursor(query, lastApproval)
          : undefined,
        hasMore: matching.length > limit,
      });
    },
    decideApproval: async (command: DecideAgentApprovalCommand) => {
      assertNotDisposed(disposed);
      const storeCommand = {
        ...command,
        commitId: nextId(ids, 'commit'),
        now: clock.now(),
      } satisfies DecideAgentRuntimeApprovalCommand;
      const receipt = await decideRuntimeApprovalDurably(
        runtimeStore,
        storeCommand,
      );
      if (
        receipt.approval.status === 'approved' ||
        receipt.approval.status === 'denied' ||
        receipt.approval.status === 'expired'
      )
        activeApprovalWaiters.get(approvalWaiterKey(command))?.resolve(receipt);
      if (receipt.approval.status === 'expired')
        throw new AgentError(
          'AGENT_APPROVAL_EXPIRED',
          'Agent Approval has expired',
        );
      return receipt.approval;
    },
    cancelTask: async (command: CancelAgentTaskCommand) => {
      const active = activeTasks.get(taskKey(command));
      if (!active) {
        if (!(await readRuntimeDurably(() => runtimeStore.getTask(command))))
          throw new AgentError('AGENT_TASK_NOT_FOUND', 'Agent task not found');
        return;
      }
      active.controller.abort(command.reason);
      await active.result;
    },
    handoff: () => {
      if (lifecyclePromise) return lifecyclePromise;
      if (
        runtimeStore.durability !== 'durable' ||
        runtimeStore.runLeaseSupport !== 'v1'
      )
        return Promise.reject(
          new AgentError(
            'AGENT_RECOVERY_UNAVAILABLE',
            'Agent Harness handoff requires a durable leased Runtime Store',
          ),
        );
      disposed = true;
      const active = [...activeTasks.values()];
      lifecyclePromise = (async () => {
        await Promise.all(active.map((task) => task.handoff()));
        await ai.dispose();
        if (ownsRuntimeStore) await runtimeStore.dispose();
      })();
      return lifecyclePromise;
    },
    dispose: () => {
      if (lifecyclePromise) return lifecyclePromise;
      disposed = true;
      for (const active of activeTasks.values())
        active.controller.abort('Agent Harness disposed');
      lifecyclePromise = (async () => {
        await Promise.allSettled(
          [...activeTasks.values()].map((active) => active.result),
        );
        await ai.dispose();
        if (ownsRuntimeStore) await runtimeStore.dispose();
      })();
      return lifecyclePromise;
    },
  });
}

function unexpectedHarnessFailure(turns: number): AgentRunResult {
  return Object.freeze({
    status: 'failed',
    turns,
    error: Object.freeze({
      code: 'AGENT_INTERNAL_FAILED',
      category: 'internal',
      message: 'Agent Harness execution failed unexpectedly',
      retryable: false,
    }),
    transcript: Object.freeze([]),
  });
}

function isApprovalPolicyResult(value: unknown): value is {
  readonly decision: string;
  readonly reasonCode?: unknown;
  readonly expiresAt?: unknown;
  readonly presentation?: unknown;
} {
  if (typeof value !== 'object' || value === null || !('decision' in value))
    return false;
  const decision = (value as { readonly decision?: unknown }).decision;
  return (
    decision === 'allow' ||
    decision === 'deny' ||
    decision === 'require_approval'
  );
}

function approvalRequestFromPolicy(input: {
  decision: {
    readonly expiresAt?: unknown;
    readonly presentation?: unknown;
  };
  approvalId: string;
  proposal: {
    readonly toolExecutionId: string;
    readonly argumentsDigest: string;
  };
  policyId: string;
  policyVersion: string;
  now: string;
}):
  | Extract<
      AgentToolAuthorizationResult,
      { readonly decision: 'require_approval' }
    >
  | Extract<
      AgentToolAuthorizationResult,
      { readonly decision: 'policy_failed' }
    > {
  if (
    typeof input.decision.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(input.decision.expiresAt)) ||
    Date.parse(input.decision.expiresAt) <= Date.parse(input.now)
  )
    return approvalPolicyFailed();
  const presentation = approvalPresentation(input.decision.presentation);
  if (!presentation)
    return {
      decision: 'policy_failed',
      errorCode: 'AGENT_APPROVAL_PRESENTATION_INVALID',
    };
  return Object.freeze({
    decision: 'require_approval',
    approvalId: input.approvalId,
    toolExecutionId: input.proposal.toolExecutionId,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    argumentsDigest: input.proposal.argumentsDigest,
    expiresAt: input.decision.expiresAt,
    presentation,
  });
}

function approvalPolicyFailed(): {
  readonly decision: 'policy_failed';
  readonly errorCode: 'AGENT_APPROVAL_POLICY_FAILED';
} {
  return {
    decision: 'policy_failed',
    errorCode: 'AGENT_APPROVAL_POLICY_FAILED',
  };
}

function approvalPresentation(
  value: unknown,
): import('../types.js').AgentApprovalPresentation | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const input = value as {
    readonly title?: unknown;
    readonly description?: unknown;
    readonly fields?: unknown;
  };
  if (typeof input.title !== 'string' || input.title.trim() === '')
    return undefined;
  if (input.description !== undefined && typeof input.description !== 'string')
    return undefined;
  if (input.fields !== undefined && !Array.isArray(input.fields))
    return undefined;
  const fields = input.fields?.map((field) => {
    if (typeof field !== 'object' || field === null) return undefined;
    const candidate = field as {
      readonly label?: unknown;
      readonly value?: unknown;
    };
    if (
      typeof candidate.label !== 'string' ||
      typeof candidate.value !== 'string'
    )
      return undefined;
    return Object.freeze({ label: candidate.label, value: candidate.value });
  });
  if (fields?.some((field) => field === undefined)) return undefined;
  const presentation = Object.freeze({
    title: input.title,
    description: input.description,
    fields: fields
      ? Object.freeze(
          fields as readonly {
            readonly label: string;
            readonly value: string;
          }[],
        )
      : undefined,
  });
  if (Buffer.byteLength(JSON.stringify(presentation), 'utf8') > 32 * 1024)
    return undefined;
  return presentation;
}

function isApprovalReasonCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    /^[A-Z][A-Z0-9_]*$/.test(value)
  );
}

function toFallbackTerminalEvent(input: {
  execution: AgentRunResult;
  sequence: number;
  taskId: string;
  runId: string;
  scope: StartAgentTaskCommand['scope'];
  ids: AgentIdGenerator;
  clock: AgentClock;
}): AgentHarnessEvent {
  const event: AgentEvent = Object.freeze({
    type: 'run_end',
    sequence: input.sequence,
    result: input.execution,
  });
  const occurredAt = safeNow(input.clock);
  try {
    return toHarnessEvent({
      event,
      taskId: input.taskId,
      runId: input.runId,
      scope: input.scope,
      ids: input.ids,
      occurredAt,
    });
  } catch {
    return toHarnessEvent({
      event,
      taskId: input.taskId,
      runId: input.runId,
      scope: input.scope,
      ids: defaultIdGenerator,
      occurredAt,
    });
  }
}

function safeNow(clock: AgentClock): string {
  try {
    return clock.now();
  } catch {
    return defaultClock.now();
  }
}

function isTerminalStatus(
  status: string,
): status is 'completed' | 'failed' | 'cancelled' {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

async function initializeHarness<TScopeHandle>(
  options: CreateAgentHarnessOptions<TScopeHandle>,
) {
  try {
    const tools = Object.freeze([...(options.tools ?? [])]);
    const toolNames = new Set<string>();
    for (const tool of tools) {
      const name = tool.definition.name;
      if (name.trim() === '' || toolNames.has(name))
        throw new TypeError('Tool names must be non-empty and unique');
      assertAgentToolExecutionDeclaration(tool);
      toolNames.add(name);
    }
    const approvalPolicy = options.approvalPolicy;
    if (
      approvalPolicy &&
      (approvalPolicy.policyId.trim() === '' ||
        approvalPolicy.version.trim() === '' ||
        typeof approvalPolicy.evaluate !== 'function')
    )
      throw new TypeError(
        'Approval policy ID and version must be non-empty and evaluate must be a function',
      );
    const maxTurns = options.maxTurns ?? 20;
    if (!Number.isInteger(maxTurns) || maxTurns < 1)
      throw new TypeError('maxTurns must be a positive integer');
    const maxBufferedEvents = options.eventBuffer?.maxEvents ?? 1_024;
    if (!Number.isInteger(maxBufferedEvents) || maxBufferedEvents < 1)
      throw new TypeError('eventBuffer.maxEvents must be a positive integer');
    const maxBatchEvents = options.durableEventBatch?.maxEvents ?? 32;
    if (!Number.isInteger(maxBatchEvents) || maxBatchEvents < 1)
      throw new TypeError(
        'durableEventBatch.maxEvents must be a positive integer',
      );
    const maxBatchWaitMs = options.durableEventBatch?.maxWaitMs ?? 25;
    if (!Number.isFinite(maxBatchWaitMs) || maxBatchWaitMs < 0)
      throw new TypeError(
        'durableEventBatch.maxWaitMs must be a non-negative number',
      );
    const runLeaseDurationMs =
      options.runLease?.durationMs ?? DEFAULT_RUN_LEASE_DURATION_MS;
    if (
      !Number.isInteger(runLeaseDurationMs) ||
      runLeaseDurationMs < MIN_RUN_LEASE_DURATION_MS ||
      runLeaseDurationMs > MAX_RUN_LEASE_DURATION_MS
    )
      throw new TypeError(
        'runLease.durationMs must be an integer between 1000 and 300000',
      );
    const runLeaseHeartbeatIntervalMs =
      options.runLease?.heartbeatIntervalMs ??
      DEFAULT_RUN_LEASE_HEARTBEAT_INTERVAL_MS;
    if (
      !Number.isInteger(runLeaseHeartbeatIntervalMs) ||
      runLeaseHeartbeatIntervalMs < MIN_RUN_LEASE_HEARTBEAT_INTERVAL_MS ||
      runLeaseHeartbeatIntervalMs >= runLeaseDurationMs
    )
      throw new TypeError(
        'runLease.heartbeatIntervalMs must be an integer between 100 and durationMs - 1',
      );
    const { ai, model } = await createAgentRuntime(options);
    return {
      ai,
      model,
      ids: options.ids ?? defaultIdGenerator,
      clock: options.clock ?? defaultClock,
      timer: options.timer ?? defaultTimer,
      tools,
      maxTurns,
      maxBufferedEvents,
      maxBatchEvents,
      maxBatchWaitMs,
      approvalPolicy,
      runLeaseDurationMs,
      runLeaseHeartbeatIntervalMs,
    };
  } catch (cause) {
    throw new AgentError(
      'AGENT_INITIALIZATION_FAILED',
      'Failed to initialize Agent Harness',
      { cause },
    );
  }
}

function eventBufferOverflowResult(result: AgentRunResult): AgentRunResult {
  return Object.freeze({
    status: 'failed',
    turns: result.turns,
    error: Object.freeze({
      code: 'AGENT_EVENT_BUFFER_OVERFLOW',
      category: 'stream',
      message: 'Agent Harness event buffer overflowed',
      retryable: false,
    }),
    transcript: result.transcript,
  });
}

function toHarnessEvent(input: {
  event: AgentEvent;
  taskId: string;
  runId: string;
  scope: StartAgentTaskCommand['scope'];
  turnId?: string;
  ids: AgentIdGenerator;
  occurredAt: string;
}): AgentHarnessEvent {
  const turnIndex = 'turn' in input.event ? input.event.turn : undefined;
  return Object.freeze({
    eventId: nextId(input.ids, 'event'),
    tenantId: input.scope.tenantId,
    projectId: input.scope.projectId,
    sessionId: input.scope.sessionId,
    taskId: input.taskId,
    runId: input.runId,
    turnId: input.turnId,
    turnIndex,
    sequence: input.event.sequence,
    occurredAt: input.occurredAt,
    payload: toHarnessPayload(input.event),
  });
}

async function taskResult(
  runtimeStore: AgentRuntimeStore,
  query: ScopedTaskQuery,
  runId: string,
  execution: AgentRunResult,
): Promise<AgentTaskResult> {
  const task = await readRuntimeDurably(() => runtimeStore.getTask(query));
  if (!task) throw new TypeError('Agent task disappeared');
  return Object.freeze({
    status: execution.status,
    taskId: query.taskId,
    runId,
    execution,
    task,
  });
}

function validateScope(scope: StartAgentTaskCommand['scope']): void {
  if (scope.tenantId.trim() === '' || scope.projectId.trim() === '')
    throw new TypeError('Agent task scope must include tenant and project IDs');
}

function nextId(ids: AgentIdGenerator, kind: AgentIdKind): string {
  const id = ids.next(kind);
  if (id.trim() === '') throw new TypeError(`Generated ${kind} ID is empty`);
  return id;
}

function taskKey(query: ScopedTaskQuery): string {
  return JSON.stringify([query.tenantId, query.projectId, query.taskId]);
}

function approvalWaiterKey(query: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly approvalId: string;
}): string {
  return JSON.stringify([
    query.tenantId,
    query.projectId,
    query.taskId,
    query.runId,
    query.approvalId,
  ]);
}

function assertNotDisposed(disposed: boolean): void {
  if (disposed)
    throw new AgentError('AGENT_DISPOSED', 'Agent Harness has been disposed');
}

const defaultIdGenerator: AgentIdGenerator = Object.freeze({
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
const LEGACY_CHECKPOINT_SCHEMA_VERSION = 2;
const RESUMABLE_CHECKPOINT_SCHEMA_VERSION = 3;
const APPROVAL_POLL_INTERVAL_MS = 1_000;
const DEFAULT_RUN_LEASE_DURATION_MS = 30_000;
const DEFAULT_RUN_LEASE_HEARTBEAT_INTERVAL_MS = 10_000;
const MIN_RUN_LEASE_DURATION_MS = 1_000;
const MAX_RUN_LEASE_DURATION_MS = 300_000;
const MIN_RUN_LEASE_HEARTBEAT_INTERVAL_MS = 100;

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) throw new TypeError('Agent clock is invalid');
  return new Date(value + milliseconds).toISOString();
}

function currentLeaseGuard(
  lease: import('./runtime-store.js').AgentRunExecutionLease | undefined,
): import('./runtime-store.js').AgentRunLeaseGuard | undefined {
  return lease
    ? {
        leaseToken: lease.leaseToken,
        fencingToken: lease.fencingToken,
      }
    : undefined;
}

function runtimeCheckpoint(
  frame: AgentCheckpointFrame,
  configFingerprint: string,
  checkpointSchemaVersion: number,
  resumeState?: AgentRuntimeResumeState,
): AgentRuntimeCheckpointWrite {
  const effectiveResumeState =
    checkpointSchemaVersion === RESUMABLE_CHECKPOINT_SCHEMA_VERSION
      ? (resumeState ?? resumeStateFromFrame(frame))
      : undefined;
  if (
    checkpointSchemaVersion === RESUMABLE_CHECKPOINT_SCHEMA_VERSION &&
    !effectiveResumeState
  )
    throw new TypeError(
      'Agent checkpoint v3 requires an explicit resume state',
    );
  return Object.freeze({
    kind: frame.kind,
    transcript: frame.transcript,
    turnIndex: frame.turnIndex,
    executionPosition: frame.executionPosition,
    nextTurnIndex: frame.nextTurnIndex,
    resumeState: effectiveResumeState,
    harnessProtocolVersion: HARNESS_PROTOCOL_VERSION,
    checkpointSchemaVersion,
    configFingerprint,
  });
}

function resumeStateFromFrame(
  frame: AgentCheckpointFrame,
): AgentRuntimeResumeState | undefined {
  if (frame.executionPosition === 'model' && frame.nextTurnIndex !== undefined)
    return Object.freeze({
      kind: 'model',
      nextTurnIndex: frame.nextTurnIndex,
    });
  if (frame.executionPosition === 'terminal' && frame.result)
    return Object.freeze({ kind: 'finalize', result: frame.result });
  return undefined;
}

function runtimeCheckpointAfterTool(
  frame: AgentCheckpointFrame,
  configFingerprint: string,
  checkpointSchemaVersion: number,
  currentProposalSequence: number,
): AgentRuntimeCheckpointWrite | undefined {
  if (
    checkpointSchemaVersion === RESUMABLE_CHECKPOINT_SCHEMA_VERSION &&
    frame.executionPosition === 'terminal'
  )
    return undefined;
  return runtimeCheckpoint(
    frame,
    configFingerprint,
    checkpointSchemaVersion,
    frame.executionPosition === 'tool'
      ? {
          kind: 'tool',
          turnIndex: frame.turnIndex,
          nextProposalSequence: currentProposalSequence + 1,
        }
      : undefined,
  );
}

function findProposalByExecutionId(
  proposals: ReadonlyMap<string, ProposedToolExecution>,
  toolExecutionId: string,
): ProposedToolExecution {
  for (const proposal of proposals.values())
    if (proposal.toolExecutionId === toolExecutionId) return proposal;
  throw new TypeError('Agent tool execution proposal not found');
}

interface PendingAgentEvent {
  readonly event: AgentEvent;
  readonly occurredAt: string;
}

function isDurableDelta(
  event: AgentEvent,
): event is Extract<
  AgentEvent,
  { type: 'text_delta' | 'reasoning_delta' | 'tool_call_delta' }
> {
  return (
    event.type === 'text_delta' ||
    event.type === 'reasoning_delta' ||
    event.type === 'tool_call_delta'
  );
}

async function createRuntimeTaskDurably(
  store: AgentRuntimeStore,
  command: CreateAgentRuntimeTaskCommand,
) {
  try {
    return await store.createTask(command);
  } catch (firstCause) {
    if (isDeterministicCommitError(firstCause)) throw firstCause;
    try {
      return await store.createTask(command);
    } catch (retryCause) {
      if (isDeterministicCommitError(retryCause)) throw retryCause;
      throw durabilityFailure(retryCause);
    }
  }
}

async function commitRuntimeTaskDurably(
  store: AgentRuntimeStore,
  command: CommitAgentRuntimeTaskCommand,
) {
  try {
    return await store.commitTask(command);
  } catch (firstCause) {
    if (isDeterministicCommitError(firstCause)) throw firstCause;
    try {
      return await store.commitTask(command);
    } catch (retryCause) {
      if (isDeterministicCommitError(retryCause)) throw retryCause;
      throw durabilityFailure(retryCause);
    }
  }
}

async function renewRunLeaseDurably(
  store: AgentRuntimeStore,
  command: Parameters<AgentRuntimeStore['renewRunLease']>[0],
) {
  try {
    return await store.renewRunLease(command);
  } catch (firstCause) {
    if (isDeterministicLeaseError(firstCause)) throw firstCause;
    try {
      return await store.renewRunLease(command);
    } catch (retryCause) {
      if (isDeterministicLeaseError(retryCause)) throw retryCause;
      throw durabilityFailure(retryCause);
    }
  }
}

async function releaseRunLeaseDurably(
  store: AgentRuntimeStore,
  command: Parameters<AgentRuntimeStore['releaseRunLease']>[0],
) {
  try {
    return await store.releaseRunLease(command);
  } catch (firstCause) {
    if (isDeterministicLeaseError(firstCause)) throw firstCause;
    try {
      return await store.releaseRunLease(command);
    } catch (retryCause) {
      if (isDeterministicLeaseError(retryCause)) throw retryCause;
      throw durabilityFailure(retryCause);
    }
  }
}

async function decideRuntimeApprovalDurably(
  store: AgentRuntimeStore,
  command: DecideAgentRuntimeApprovalCommand,
) {
  try {
    return await store.decideApproval(command);
  } catch (firstCause) {
    if (isDeterministicApprovalDecisionError(firstCause)) throw firstCause;
    try {
      return await store.decideApproval(command);
    } catch (retryCause) {
      if (isDeterministicApprovalDecisionError(retryCause)) throw retryCause;
      throw durabilityFailure(retryCause);
    }
  }
}

function isDeterministicApprovalDecisionError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof AgentError &&
      (error.code === 'AGENT_APPROVAL_NOT_FOUND' ||
        error.code === 'AGENT_APPROVAL_ALREADY_DECIDED' ||
        error.code === 'AGENT_APPROVAL_DECISION_MISMATCH'))
  );
}

function isDeterministicCommitError(error: unknown): boolean {
  return (
    error instanceof AgentError &&
    (error.code === 'AGENT_STATE_CONFLICT' ||
      error.code === 'AGENT_COMMIT_MISMATCH' ||
      error.code === 'AGENT_RUN_LEASE_LOST')
  );
}

function isRunLeaseLost(error: unknown): boolean {
  return error instanceof AgentError && error.code === 'AGENT_RUN_LEASE_LOST';
}

function isDeterministicLeaseError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof AgentError &&
      (error.code === 'AGENT_RUN_LEASE_LOST' ||
        error.code === 'AGENT_COMMIT_MISMATCH'))
  );
}

function isDurabilityFailure(error: unknown): error is AgentError {
  return (
    error instanceof AgentError && error.code === 'AGENT_DURABILITY_FAILED'
  );
}

function durabilityFailure(cause: unknown): AgentError {
  return cause instanceof AgentError && cause.code === 'AGENT_DURABILITY_FAILED'
    ? cause
    : new AgentError(
        'AGENT_DURABILITY_FAILED',
        'Agent durable state is unavailable',
        { cause },
      );
}

async function readRuntimeDurably<TResult>(
  read: () => Promise<TResult>,
): Promise<TResult> {
  try {
    return await read();
  } catch (cause) {
    if (cause instanceof AgentError) throw cause;
    throw durabilityFailure(cause);
  }
}
