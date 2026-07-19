import type { JsonSchema } from './tools.js';
import type {
  ImageContent,
  JsonValue,
  ReasoningContent,
  ReplayMetadata,
  TextContent,
  ToolCallContent,
} from './content.js';
import type { ModelRef } from './models.js';

export interface ToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonSchema;
  readonly deferred?: boolean;
}

export interface UserMessage {
  readonly role: 'user';
  readonly content: readonly (TextContent | ImageContent)[];
  readonly details?: JsonValue;
  readonly addedToolNames?: readonly string[];
  readonly timestamp?: number;
}

export type CompletedFinishReason =
  'stop' | 'length' | 'tool_calls' | 'content_filter';
export type FinishReason = CompletedFinishReason | 'error' | 'cancelled';
export type ResponseStatus = 'completed' | 'failed' | 'cancelled';

export interface AssistantMessage {
  readonly role: 'assistant';
  readonly content: readonly (
    TextContent | ReasoningContent | ToolCallContent
  )[];
  readonly model: ModelRef;
  readonly responseModel?: ModelRef;
  readonly responseId?: string;
  readonly replay?: ReplayMetadata;
  readonly status: ResponseStatus;
  readonly finishReason: FinishReason;
  readonly partial: boolean;
  readonly diagnostics?: readonly import('./events.js').AiDiagnostic[];
  readonly timestamp?: number;
}

export interface ToolResultMessage {
  readonly role: 'tool_result';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly isError: boolean;
  readonly content: readonly (TextContent | ImageContent)[];
  readonly details?: JsonValue;
  readonly addedToolNames?: readonly string[];
  readonly timestamp?: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface AiContext {
  readonly systemPrompt?: string;
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
}
