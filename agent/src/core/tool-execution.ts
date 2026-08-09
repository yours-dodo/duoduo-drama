import { randomUUID } from 'node:crypto';
import type { JsonValue, ToolCallContent, ToolResultMessage } from '@duoduo/ai';

import type { AgentCheckpointFrame } from './run-loop.js';
import type {
  AgentApprovalPresentation,
  AgentEvent,
  AgentTool,
  AgentToolEffectOutcome,
  AgentToolExecutionStatus,
} from './types.js';

const MAX_TOOL_TIMEOUT_MS = 86_400_000;

export interface PreparedAgentToolExecution {
  readonly toolExecutionId: string;
  readonly attempt: number;
  readonly idempotencyKey?: string;
  readonly deadline: string;
  readonly signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
}

export type AgentToolAuthorizationResult =
  | { readonly decision: 'allow' }
  | { readonly decision: 'deny' }
  | {
      readonly decision: 'policy_failed';
      readonly errorCode:
        'AGENT_APPROVAL_POLICY_FAILED' | 'AGENT_APPROVAL_PRESENTATION_INVALID';
    }
  | {
      readonly decision: 'require_approval';
      readonly approvalId: string;
      readonly toolExecutionId: string;
      readonly policyId: string;
      readonly policyVersion: string;
      readonly argumentsDigest: string;
      readonly expiresAt: string;
      readonly presentation: AgentApprovalPresentation;
    }
  | {
      readonly decision: 'approved';
      readonly approvalId: string;
      readonly toolExecutionId: string;
      readonly decisionId: string;
      readonly decidedBy: string;
      readonly reasonCode?: string;
      readonly taskVersion: number;
    }
  | {
      readonly decision:
        'approval_denied' | 'approval_expired' | 'approval_cancelled';
      readonly approvalId: string;
      readonly toolExecutionId: string;
      readonly decisionId?: string;
      readonly decidedBy?: string;
      readonly reasonCode?: string;
      readonly taskVersion: number;
    };

export interface AgentToolExecutionCoordinator {
  propose?(input: {
    readonly calls: readonly ToolCallContent[];
    readonly turn: number;
    readonly checkpoint: AgentCheckpointFrame;
  }): Promise<void>;
  authorize?(input: {
    readonly tool: AgentTool;
    readonly toolCallId: string;
    readonly turn: number;
    readonly arguments: JsonValue;
  }): Promise<AgentToolAuthorizationResult>;
  requestApproval?(input: {
    readonly authorization: Extract<
      AgentToolAuthorizationResult,
      { readonly decision: 'require_approval' }
    >;
    readonly tool: AgentTool;
    readonly toolCallId: string;
    readonly turn: number;
    readonly event: Extract<AgentEvent, { type: 'approval_requested' }>;
    readonly checkpoint: AgentCheckpointFrame;
    readonly signal: AbortSignal;
  }): Promise<
    Exclude<AgentToolAuthorizationResult, { decision: 'require_approval' }>
  >;
  consumeApprovedApproval?(input: {
    readonly authorization: Extract<
      AgentToolAuthorizationResult,
      { readonly decision: 'approved' }
    >;
    readonly tool: AgentTool;
    readonly toolCallId: string;
    readonly event: Extract<AgentEvent, { type: 'approval_decided' }>;
    readonly checkpoint: AgentCheckpointFrame;
    readonly signal: AbortSignal;
  }): Promise<PreparedAgentToolExecution>;
  consumeRejectedApproval?(input: {
    readonly authorization: Extract<
      AgentToolAuthorizationResult,
      {
        readonly decision:
          'approval_denied' | 'approval_expired' | 'approval_cancelled';
      }
    >;
    readonly approvalEvent: Extract<
      AgentEvent,
      {
        type: 'approval_decided' | 'approval_expired' | 'approval_cancelled';
      }
    >;
    readonly endEvent: Extract<AgentEvent, { type: 'tool_execution_end' }>;
    readonly checkpoint: AgentCheckpointFrame;
    readonly result: ToolResultMessage;
  }): Promise<void>;
  prepare(input: {
    readonly tool: AgentTool;
    readonly toolCallId: string;
    readonly signal: AbortSignal;
  }): PreparedAgentToolExecution | Promise<PreparedAgentToolExecution>;
  start?(input: {
    readonly execution: PreparedAgentToolExecution;
    readonly event: Extract<AgentEvent, { type: 'tool_execution_start' }>;
  }): Promise<void>;
  reject?(input: {
    readonly toolCallId: string;
    readonly event: Extract<AgentEvent, { type: 'tool_execution_end' }>;
    readonly checkpoint: AgentCheckpointFrame;
    readonly reasonCode:
      | 'TOOL_UNAVAILABLE'
      | 'TOOL_ARGUMENTS_INVALID'
      | 'TOOL_CANCELLED_BEFORE_INVOCATION'
      | 'POLICY_DENIED'
      | 'POLICY_FAILED'
      | 'PRESENTATION_INVALID';
    readonly result: ToolResultMessage;
  }): Promise<void>;
  finish?(input: {
    readonly execution: PreparedAgentToolExecution;
    readonly event: Extract<AgentEvent, { type: 'tool_execution_end' }>;
    readonly checkpoint: AgentCheckpointFrame;
    readonly status: Extract<
      AgentToolExecutionStatus,
      'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'unknown'
    >;
    readonly effectOutcome: AgentToolEffectOutcome;
    readonly retryable: boolean;
    readonly errorCode?: string;
    readonly result: ToolResultMessage;
  }): Promise<void>;
}

export function createEphemeralToolExecutionCoordinator(input?: {
  readonly now?: () => Date;
  readonly generateId?: () => string;
  readonly schedule?: (delayMs: number, callback: () => void) => () => void;
}): AgentToolExecutionCoordinator {
  const now = input?.now ?? (() => new Date());
  const generateId = input?.generateId ?? randomUUID;
  const schedule =
    input?.schedule ??
    ((delayMs: number, callback: () => void) => {
      const timeout = setTimeout(callback, delayMs);
      return () => clearTimeout(timeout);
    });

  return Object.freeze({
    prepare({
      tool,
      signal,
    }: {
      readonly tool: AgentTool;
      readonly signal: AbortSignal;
    }) {
      const timeoutController = new AbortController();
      let timedOut = false;
      const cancelTimeout = schedule(tool.execution.timeoutMs, () => {
        timedOut = true;
        timeoutController.abort('Agent tool execution timed out');
      });
      const prepared: PreparedAgentToolExecution = {
        toolExecutionId: generateId(),
        attempt: 1,
        idempotencyKey:
          tool.execution.idempotency === 'keyed' ? generateId() : undefined,
        deadline: new Date(
          now().getTime() + tool.execution.timeoutMs,
        ).toISOString(),
        signal: AbortSignal.any([signal, timeoutController.signal]),
        timedOut: () => timedOut,
        dispose: cancelTimeout,
      };
      return Object.freeze(prepared);
    },
  });
}

export function assertAgentToolExecutionDeclaration(tool: AgentTool): void {
  const declaration = tool.execution;
  if (
    !declaration ||
    !['none', 'reversible', 'external'].includes(declaration.sideEffect) ||
    !['none', 'keyed'].includes(declaration.idempotency) ||
    !Number.isSafeInteger(declaration.timeoutMs) ||
    declaration.timeoutMs < 1 ||
    declaration.timeoutMs > MAX_TOOL_TIMEOUT_MS
  )
    throw new TypeError(
      `Tool ${tool.definition.name} has an invalid execution declaration`,
    );
  const adapter = tool.reconciliation;
  if (
    adapter &&
    (adapter.adapterId.trim() === '' ||
      adapter.version.trim() === '' ||
      typeof adapter.inspect !== 'function')
  )
    throw new TypeError(
      `Tool ${tool.definition.name} has an invalid reconciliation adapter`,
    );
}
