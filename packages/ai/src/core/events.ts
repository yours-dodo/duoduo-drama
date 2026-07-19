import type {
  ReasoningContent,
  ReplayMetadata,
  TextContent,
  ToolCallContent,
} from './content.js';
import type { AiError } from './errors.js';
import type { SessionHandle } from '../session/lease.js';
import type { RetryPolicy } from '../transport/retry.js';
import type { RequestTransport } from '../transport/types.js';
import type { AiContext, CompletedFinishReason } from './messages.js';
import type { ModelDefinition, ModelRef } from './models.js';
import type { Cost, Usage } from './usage.js';

export interface AiDiagnostic {
  readonly code: string;
  readonly message?: string;
}

export interface AssistantResponseBase {
  readonly requestId: string;
  readonly model: Readonly<ModelDefinition>;
  readonly responseModel?: ModelRef;
  readonly responseId?: string;
  readonly replay?: ReplayMetadata;
  readonly content: readonly (
    TextContent | ReasoningContent | ToolCallContent
  )[];
  readonly usage?: Usage;
  readonly cost?: Cost;
  readonly diagnostics?: readonly AiDiagnostic[];
  readonly startedAt: number;
  readonly completedAt: number;
}

export type AssistantResponse =
  | (AssistantResponseBase & {
      readonly status: 'completed';
      readonly finishReason: CompletedFinishReason;
      readonly partial: false;
      readonly error?: never;
    })
  | (AssistantResponseBase & {
      readonly status: 'failed';
      readonly finishReason: 'error';
      readonly partial: boolean;
      readonly error: AiError;
    })
  | (AssistantResponseBase & {
      readonly status: 'cancelled';
      readonly finishReason: 'cancelled';
      readonly partial: boolean;
      readonly error: AiError & { readonly category: 'cancelled' };
    });

export type AiStreamEvent =
  | {
      readonly type: 'response_start';
      readonly sequence: number;
      readonly requestId: string;
      readonly startedAt: number;
      readonly model: Readonly<ModelDefinition>;
    }
  | {
      readonly type: 'text_start' | 'reasoning_start';
      readonly sequence: number;
      readonly itemId: string;
      readonly contentIndex: number;
    }
  | {
      readonly type: 'tool_call_start';
      readonly sequence: number;
      readonly itemId: string;
      readonly contentIndex: number;
      readonly toolCallId: string;
      readonly name?: string;
    }
  | {
      readonly type: 'text_delta' | 'reasoning_delta';
      readonly sequence: number;
      readonly itemId: string;
      readonly contentIndex: number;
      readonly delta: string;
    }
  | {
      readonly type: 'tool_call_delta';
      readonly sequence: number;
      readonly itemId: string;
      readonly contentIndex: number;
      readonly argumentsDelta: string;
      readonly nameDelta?: string;
    }
  | {
      readonly type: 'text_end' | 'reasoning_end';
      readonly sequence: number;
      readonly itemId: string;
      readonly contentIndex: number;
      readonly replay?: ReplayMetadata;
    }
  | {
      readonly type: 'tool_call_end';
      readonly sequence: number;
      readonly itemId: string;
      readonly contentIndex: number;
      readonly toolCall: ToolCallContent;
    }
  | {
      readonly type: 'response_end';
      readonly sequence: number;
      readonly response: Extract<AssistantResponse, { status: 'completed' }>;
    }
  | {
      readonly type: 'response_error';
      readonly sequence: number;
      readonly response: Exclude<AssistantResponse, { status: 'completed' }>;
    };

export type ProtocolContentEvent =
  | {
      readonly type: 'text_start' | 'reasoning_start';
      readonly itemId: string;
      readonly contentIndex: number;
    }
  | {
      readonly type: 'tool_call_start';
      readonly itemId: string;
      readonly contentIndex: number;
      readonly toolCallId: string;
      readonly name?: string;
    }
  | {
      readonly type: 'text_delta' | 'reasoning_delta';
      readonly itemId: string;
      readonly contentIndex: number;
      readonly delta: string;
    }
  | {
      readonly type: 'tool_call_delta';
      readonly itemId: string;
      readonly contentIndex: number;
      readonly argumentsDelta: string;
      readonly nameDelta?: string;
    }
  | {
      readonly type: 'text_end' | 'reasoning_end';
      readonly itemId: string;
      readonly contentIndex: number;
      readonly replay?: ReplayMetadata;
    }
  | {
      readonly type: 'tool_call_end';
      readonly itemId: string;
      readonly contentIndex: number;
      readonly toolCall: ToolCallContent;
    };

export interface ProtocolTerminalBase {
  readonly usage?: Usage;
  readonly cost?: Cost;
  readonly responseModelId?: string;
  readonly responseId?: string;
  readonly replay?: ReplayMetadata;
  readonly diagnostics?: readonly AiDiagnostic[];
}

export type ProtocolTerminal =
  | (ProtocolTerminalBase & {
      readonly status: 'completed';
      readonly finishReason: CompletedFinishReason;
    })
  | (ProtocolTerminalBase & {
      readonly status: 'failed';
      readonly error: AiError;
    })
  | (ProtocolTerminalBase & {
      readonly status: 'cancelled';
      readonly error: AiError & { readonly category: 'cancelled' };
    });

export interface ResolvedStreamOptions<TProtocol extends string = string> {
  readonly signal: AbortSignal;
  readonly maxOutputTokens: number;
  readonly stop: readonly string[];
  readonly timeoutMs: number;
  readonly retry: false | RetryPolicy;
  readonly sessionId?: string;
  readonly protocolOptions: TProtocol extends string
    ? Readonly<Record<string, unknown>>
    : never;
}

export interface ChatRequest<TProtocol extends string = string> {
  readonly model: Readonly<ModelDefinition<TProtocol>>;
  readonly context: Readonly<AiContext>;
  readonly options: Readonly<ResolvedStreamOptions<TProtocol>>;
  readonly signal: AbortSignal;
  readonly transport?: RequestTransport;
  readonly session: SessionHandle;
}

export interface AiResponseStream extends AsyncIterable<AiStreamEvent> {
  result(): Promise<AssistantResponse>;
  abort(reason?: string): void;
}
