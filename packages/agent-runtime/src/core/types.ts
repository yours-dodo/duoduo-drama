import type {
  AssistantResponse,
  CreateAiOptions,
  ImageContent,
  JsonValue,
  Message,
  ModelReadOptions,
  ModelRef,
  Provider,
  StreamOptionsInput,
  TextContent,
  ToolDefinition,
  ToolResultMessage,
  UserMessage,
} from '@duoduo/ai';

export type AgentInput = string | UserMessage;

export interface AgentRunOptions {
  readonly signal?: AbortSignal;
}

export interface CreateAgentOptions<TScopeHandle> {
  readonly aiOptions?: CreateAiOptions<TScopeHandle>;
  readonly providers: Iterable<Provider>;
  readonly model: {
    readonly ref: ModelRef;
    readonly scope: TScopeHandle;
    readonly readOptions?: ModelReadOptions;
  };
  readonly systemPrompt?: string;
  readonly tools?: readonly AgentTool[];
  readonly maxTurns?: number;
  readonly streamOptions?: Omit<
    StreamOptionsInput,
    'signal' | 'credentialOverride'
  >;
  readonly eventBuffer?: {
    readonly maxEvents?: number;
  };
}

export interface AgentToolExecutionContext {
  readonly signal: AbortSignal;
  readonly toolCallId: string;
  readonly toolExecutionId: string;
  readonly attempt: number;
  readonly idempotencyKey?: string;
  readonly deadline: string;
  readonly transcript: readonly Message[];
  update(update: AgentToolUpdate): void;
}

export interface AgentToolUpdate {
  readonly content?: readonly (TextContent | ImageContent)[];
  readonly details?: JsonValue;
}

export interface AgentToolResult {
  readonly content: readonly (TextContent | ImageContent)[];
  readonly details?: JsonValue;
}

export interface AgentToolExecutionDeclaration {
  readonly sideEffect: 'none' | 'reversible' | 'external';
  readonly idempotency: 'none' | 'keyed';
  readonly timeoutMs: number;
}

export interface AgentApprovalPresentation {
  readonly title: string;
  readonly description?: string;
  readonly fields?: readonly {
    readonly label: string;
    readonly value: string;
  }[];
}

export interface AgentReconciliationPresentation {
  readonly title: string;
  readonly description?: string;
  readonly fields?: readonly {
    readonly label: string;
    readonly value: string;
  }[];
}

export type AgentReconciliationObservationOutcome =
  'applied' | 'not_applied' | 'inconclusive' | 'failed';

export interface AgentReconciliationInspectionContext {
  readonly scope: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly sessionId?: string;
  };
  readonly taskId: string;
  readonly runId: string;
  readonly reconciliationCaseId: string;
  readonly toolExecutionId: string;
  readonly attemptId: string;
  readonly toolName: string;
  readonly correlationReference?: string;
}

export interface AgentReconciliationInspectionResult {
  readonly outcome: AgentReconciliationObservationOutcome;
  readonly reasonCode: string;
  readonly presentation?: AgentReconciliationPresentation;
}

export interface AgentReconciliationAdapter {
  readonly adapterId: string;
  readonly version: string;
  /** Implementations must perform only read-only external inspection. */
  inspect(
    context: AgentReconciliationInspectionContext,
  ): Promise<AgentReconciliationInspectionResult>;
}

export type AgentToolExecutionStatus =
  | 'proposed'
  | 'awaiting_approval'
  | 'prepared'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'unknown';

export type AgentToolEffectOutcome = 'not_applied' | 'applied' | 'unknown';

export interface AgentTool {
  readonly definition: ToolDefinition;
  readonly execution: AgentToolExecutionDeclaration;
  readonly reconciliation?: AgentReconciliationAdapter;
  execute(
    arguments_: JsonValue,
    context: AgentToolExecutionContext,
  ): Promise<AgentToolResult>;
}

export type AgentFailure =
  | {
      readonly code: 'AGENT_MODEL_FAILED';
      readonly category: 'model';
      readonly message: string;
      readonly retryable: boolean;
    }
  | {
      readonly code: 'AGENT_APPROVAL_POLICY_FAILED';
      readonly category: 'approval';
      readonly message: string;
      readonly retryable: false;
    }
  | {
      readonly code: 'AGENT_APPROVAL_PRESENTATION_INVALID';
      readonly category: 'approval';
      readonly message: string;
      readonly retryable: false;
    }
  | {
      readonly code: 'AGENT_CANCELLED';
      readonly category: 'cancelled';
      readonly message: string;
      readonly retryable: false;
    }
  | {
      readonly code: 'AGENT_MAX_TURNS';
      readonly category: 'limit';
      readonly message: string;
      readonly retryable: false;
    }
  | {
      readonly code: 'AGENT_EVENT_BUFFER_OVERFLOW';
      readonly category: 'stream';
      readonly message: string;
      readonly retryable: false;
    }
  | {
      readonly code: 'AGENT_INTERNAL_FAILED';
      readonly category: 'internal';
      readonly message: string;
      readonly retryable: false;
    };

export type AgentRunResult =
  | {
      readonly status: 'completed';
      readonly turns: number;
      readonly response: Extract<AssistantResponse, { status: 'completed' }>;
      readonly transcript: readonly Message[];
    }
  | {
      readonly status: 'failed';
      readonly turns: number;
      readonly error: Exclude<
        AgentFailure,
        { readonly code: 'AGENT_CANCELLED' }
      >;
      readonly transcript: readonly Message[];
    }
  | {
      readonly status: 'cancelled';
      readonly turns: number;
      readonly error: Extract<
        AgentFailure,
        { readonly code: 'AGENT_CANCELLED' }
      >;
      readonly transcript: readonly Message[];
    };

export type AgentEvent =
  | { readonly type: 'run_start'; readonly sequence: number }
  | {
      readonly type: 'turn_start';
      readonly sequence: number;
      readonly turn: number;
    }
  | {
      readonly type: 'model_start';
      readonly sequence: number;
      readonly turn: number;
      readonly requestId: string;
      readonly modelAttemptId?: string;
      readonly modelAttempt?: number;
    }
  | {
      readonly type: 'text_delta';
      readonly sequence: number;
      readonly turn: number;
      readonly itemId: string;
      readonly contentIndex: number;
      readonly delta: string;
      readonly modelAttemptId?: string;
      readonly modelAttempt?: number;
    }
  | {
      readonly type: 'reasoning_delta';
      readonly sequence: number;
      readonly turn: number;
      readonly itemId: string;
      readonly contentIndex: number;
      readonly delta: string;
      readonly modelAttemptId?: string;
      readonly modelAttempt?: number;
    }
  | {
      readonly type: 'tool_call_delta';
      readonly sequence: number;
      readonly turn: number;
      readonly itemId: string;
      readonly contentIndex: number;
      readonly argumentsDelta: string;
      readonly nameDelta?: string;
      readonly modelAttemptId?: string;
      readonly modelAttempt?: number;
    }
  | {
      readonly type: 'model_end';
      readonly sequence: number;
      readonly turn: number;
      readonly response: AssistantResponse;
      readonly modelAttemptId?: string;
      readonly modelAttempt?: number;
    }
  | {
      readonly type: 'approval_requested';
      readonly sequence: number;
      readonly turn: number;
      readonly approvalId: string;
      readonly toolExecutionId: string;
      readonly policyId: string;
      readonly policyVersion: string;
      readonly expiresAt: string;
      readonly presentation: AgentApprovalPresentation;
    }
  | {
      readonly type: 'approval_decided';
      readonly sequence: number;
      readonly turn: number;
      readonly approvalId: string;
      readonly toolExecutionId: string;
      readonly decision: 'approved' | 'denied';
      readonly decidedBy: string;
      readonly reasonCode?: string;
    }
  | {
      readonly type: 'approval_expired' | 'approval_cancelled';
      readonly sequence: number;
      readonly turn: number;
      readonly approvalId: string;
      readonly toolExecutionId: string;
    }
  | {
      readonly type: 'tool_execution_start';
      readonly sequence: number;
      readonly turn: number;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly toolExecutionId?: string;
      readonly attemptId?: string;
      readonly attempt?: number;
    }
  | {
      readonly type: 'tool_execution_update';
      readonly sequence: number;
      readonly turn: number;
      readonly toolCallId: string;
      readonly toolExecutionId?: string;
      readonly attempt?: number;
      readonly update: AgentToolUpdate;
    }
  | {
      readonly type: 'tool_execution_end';
      readonly sequence: number;
      readonly turn: number;
      readonly toolCallId: string;
      readonly toolExecutionId?: string;
      readonly attemptId?: string;
      readonly attempt?: number;
      readonly status?: AgentToolExecutionStatus;
      readonly effectOutcome?: AgentToolEffectOutcome;
      readonly result: ToolResultMessage;
    }
  | {
      readonly type: 'run_reconciliation_required';
      readonly sequence: number;
      readonly turn: number;
      readonly toolCallId: string;
      readonly toolExecutionId: string;
      readonly attemptId: string;
      readonly reasonCode: 'EXTERNAL_EFFECT_UNKNOWN';
    }
  | {
      readonly type: 'run_recovery_blocked';
      readonly sequence: number;
      readonly reasonCode: string;
    }
  | {
      readonly type: 'turn_end';
      readonly sequence: number;
      readonly turn: number;
    }
  | {
      readonly type: 'run_end';
      readonly sequence: number;
      readonly result: AgentRunResult;
    };

export interface AgentEventStream extends AsyncIterable<AgentEvent> {
  result(): Promise<AgentRunResult>;
  abort(reason?: string): void;
}

export interface Agent {
  readonly transcript: readonly Message[];
  readonly isRunning: boolean;
  run(input: AgentInput, options?: AgentRunOptions): Promise<AgentRunResult>;
  stream(input: AgentInput, options?: AgentRunOptions): AgentEventStream;
  abort(reason?: string): void;
  reset(): void;
  dispose(): Promise<void>;
}
