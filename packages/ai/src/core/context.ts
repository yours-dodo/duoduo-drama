import type { AssistantResponse } from './events.js';
import type {
  AiContext,
  AssistantMessage,
  ToolDefinition,
} from './messages.js';

export interface ContextValidationIssue {
  readonly path: string;
  readonly code: 'duplicate_tool' | 'invalid_tool_schema';
  readonly message: string;
}

export type ContextValidationResult =
  | Readonly<{ valid: true; context: Readonly<AiContext> }>
  | Readonly<{ valid: false; issues: readonly ContextValidationIssue[] }>;

/** Validate the provider-neutral invariants before a provider is invoked. */
export function validateContext(
  context: Readonly<AiContext>,
): ContextValidationResult {
  const issues: ContextValidationIssue[] = [];
  const names = new Set<string>();
  for (const [index, tool] of (context.tools ?? []).entries()) {
    if (names.has(tool.name)) {
      issues.push({
        path: `/tools/${index}/name`,
        code: 'duplicate_tool',
        message: `tool name must be unique: ${tool.name}`,
      });
    }
    names.add(tool.name);
    const schema = tool.inputSchema as unknown;
    if (
      typeof schema !== 'object' ||
      schema === null ||
      Array.isArray(schema)
    ) {
      issues.push({
        path: `/tools/${index}/inputSchema`,
        code: 'invalid_tool_schema',
        message: 'tool inputSchema must be a JSON schema object',
      });
    }
  }
  return issues.length === 0
    ? { valid: true, context }
    : { valid: false, issues };
}

export function toolNames(context: Readonly<AiContext>): readonly string[] {
  return [
    ...new Set((context.tools ?? []).map((tool: ToolDefinition) => tool.name)),
  ];
}

export function toAssistantMessage(
  response: AssistantResponse,
): AssistantMessage {
  return Object.freeze({
    role: 'assistant' as const,
    content: Object.freeze([...response.content]),
    model: Object.freeze({
      providerInstanceId: response.model.providerInstanceId,
      modelId: response.model.id,
      protocol: response.model.protocol,
    }),
    responseModel: response.responseModel,
    responseId: response.responseId,
    replay: response.replay,
    status: response.status,
    finishReason: response.finishReason,
    partial: response.partial,
    diagnostics: response.diagnostics,
    timestamp: response.completedAt,
  });
}
