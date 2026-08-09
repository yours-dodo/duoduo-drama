export type AgentErrorCode =
  | 'AGENT_INITIALIZATION_FAILED'
  | 'AGENT_ALREADY_RUNNING'
  | 'AGENT_RESET_WHILE_RUNNING'
  | 'AGENT_TASK_NOT_FOUND'
  | 'AGENT_RUN_NOT_FOUND'
  | 'AGENT_CURSOR_INVALID'
  | 'AGENT_STATE_CONFLICT'
  | 'AGENT_RUN_LEASE_LOST'
  | 'AGENT_EXECUTION_OWNERSHIP_LOST'
  | 'AGENT_RECOVERY_UNAVAILABLE'
  | 'AGENT_RECOVERY_STATE_INVALID'
  | 'AGENT_RECOVERY_CONFIG_MISMATCH'
  | 'AGENT_RECOVERY_CHECKPOINT_INCOMPATIBLE'
  | 'AGENT_COMMIT_MISMATCH'
  | 'AGENT_OBSERVER_OVERFLOW'
  | 'AGENT_DURABILITY_FAILED'
  | 'AGENT_APPROVAL_POLICY_FAILED'
  | 'AGENT_APPROVAL_PRESENTATION_INVALID'
  | 'AGENT_APPROVAL_NOT_FOUND'
  | 'AGENT_APPROVAL_ALREADY_DECIDED'
  | 'AGENT_APPROVAL_DECISION_MISMATCH'
  | 'AGENT_APPROVAL_EXPIRED'
  | 'AGENT_MIGRATION_FAILED'
  | 'AGENT_DISPOSED';

export class AgentError extends Error {
  readonly code: AgentErrorCode;

  constructor(code: AgentErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentError';
    this.code = code;
  }
}

export class AgentToolExecutionError extends Error {
  readonly code: string;
  readonly kind: 'failed' | 'cancelled' | 'timed_out';
  readonly effectOutcome: 'not_applied' | 'applied' | 'unknown';
  readonly retryable: boolean;

  constructor(
    input: {
      readonly code: string;
      readonly kind: 'failed' | 'cancelled' | 'timed_out';
      readonly effectOutcome: 'not_applied' | 'applied' | 'unknown';
      readonly retryable: boolean;
    },
    options?: ErrorOptions,
  ) {
    super('Agent tool execution failed', options);
    if (input.code.trim() === '')
      throw new TypeError('Agent tool execution error code is empty');
    this.name = 'AgentToolExecutionError';
    this.code = input.code;
    this.kind = input.kind;
    this.effectOutcome = input.effectOutcome;
    this.retryable = input.retryable;
  }
}
