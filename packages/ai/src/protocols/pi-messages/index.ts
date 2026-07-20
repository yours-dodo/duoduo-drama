import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type { JsonValue } from '../../core/content.js';
import { parseToolArguments } from '../../core/tools.js';
import { calculateCost, type Usage } from '../../core/usage.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';
import { parseServerSentEvents } from '../../transport/sse.js';

export interface PiMessagesProtocolOptions {
  readonly debug?: boolean;
}

export const piMessagesContract = Object.freeze({
  protocol: 'pi-messages' as const,
  route: 'messages' as const,
  streaming: true,
  terminalOwner: 'runtime' as const,
});

export const piMessagesReplayCodecs = Object.freeze([
  Object.freeze({ id: 'pi-message-signature', version: 1 }),
  Object.freeze({ id: 'pi-rewrite-diagnostic', version: 1 }),
]);

export interface PiMessagesAdapterOptions {
  readonly contextVersion?: number;
}

export function createPiMessagesAdapter(
  adapterOptions: PiMessagesAdapterOptions = {},
) {
  return (request: ChatRequest<'pi-messages'>, sink: ProtocolEventSink) =>
    runPiMessages(request, sink, adapterOptions);
}

export async function runPiMessages(
  request: ChatRequest<'pi-messages'>,
  sink: ProtocolEventSink,
  adapterOptions: PiMessagesAdapterOptions = {},
): Promise<ProtocolTerminal> {
  if (!request.transport)
    return failed(
      'TRANSPORT_UNAVAILABLE',
      'invalid_request',
      'PI Messages requires a bound request transport',
    );
  let response;
  try {
    response = await request.transport.send({
      method: 'POST',
      headers: request.options.protocolOptions.debug
        ? { 'x-pi-debug': '1' }
        : undefined,
      body: JSON.stringify({
        model: request.model.upstreamModelId,
        context: encodeContext(request, adapterOptions.contextVersion ?? 1),
        options: {
          maxTokens: request.options.maxOutputTokens,
          stop: request.options.stop,
          stream: true,
          debug: request.options.protocolOptions.debug === true,
        },
      }),
      responseMode: 'stream',
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted || isAbort(error))
      return cancelled(
        'PI_MESSAGES_CANCELLED',
        'PI Messages request was cancelled',
      );
    return failed(
      'PI_MESSAGES_NETWORK',
      'network',
      'PI Messages request failed before a response was received',
      true,
    );
  }
  if (response.status < 200 || response.status >= 300)
    return failed(
      `PI_MESSAGES_HTTP_${response.status}`,
      response.status === 401 || response.status === 403 ? 'auth' : 'provider',
      `PI Messages request failed with HTTP ${response.status}`,
      response.status === 429 || response.status >= 500,
    );

  let responseId: string | undefined;
  let responseModelId: string | undefined;
  let usage: Usage | undefined;
  let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' =
    'stop';
  let terminalSeen = false;
  let hasTools = false;
  const tools = new Map<
    string,
    { index: number; id: string; name: string; args: string }
  >();
  const signatures: Record<string, JsonValue> = {};
  const diagnostics: {
    code: string;
    message: string;
    severity: 'info' | 'warning';
  }[] = [];

  try {
    for await (const frame of parseServerSentEvents(
      response.body,
      1024 * 1024,
      'PI_MESSAGES_INVALID_SSE',
    )) {
      const eventName = frame.event ?? 'message';
      const data = parseData(frame.data);
      const type = string(data.type) ?? eventName;
      const itemId =
        string(data.itemId ?? data.item_id ?? data.id) ?? `${type}-0`;
      const index =
        number(data.contentIndex ?? data.content_index ?? data.index) ?? 0;
      switch (type) {
        case 'start':
        case 'response_start':
          responseId =
            string(data.responseId ?? data.response_id ?? data.id) ??
            responseId;
          responseModelId = string(data.model) ?? responseModelId;
          break;
        case 'text_start':
          await sink.publish({
            type: 'text_start',
            itemId,
            contentIndex: index,
          });
          break;
        case 'text_delta':
          await sink.publish({
            type: 'text_delta',
            itemId,
            contentIndex: index,
            delta: requiredString(data.delta ?? data.text, type),
          });
          break;
        case 'text_end':
          recordSignature(signatures, itemId, data.signature);
          await sink.publish({
            type: 'text_end',
            itemId,
            contentIndex: index,
            ...(data.signature === undefined
              ? {}
              : { replay: signatureReplay(request, data.signature) }),
          });
          break;
        case 'thinking_start':
        case 'reasoning_start':
          await sink.publish({
            type: 'reasoning_start',
            itemId,
            contentIndex: index,
          });
          break;
        case 'thinking_delta':
        case 'reasoning_delta':
          await sink.publish({
            type: 'reasoning_delta',
            itemId,
            contentIndex: index,
            delta: requiredString(data.delta ?? data.text, type),
          });
          break;
        case 'thinking_end':
        case 'reasoning_end':
          recordSignature(signatures, itemId, data.signature);
          await sink.publish({
            type: 'reasoning_end',
            itemId,
            contentIndex: index,
            ...(data.signature === undefined
              ? {}
              : { replay: signatureReplay(request, data.signature) }),
          });
          break;
        case 'toolcall_start':
        case 'tool_call_start': {
          hasTools = true;
          const id =
            string(data.toolCallId ?? data.tool_call_id ?? data.call_id) ??
            itemId;
          const name = string(data.name) ?? '';
          tools.set(itemId, { index, id, name, args: '' });
          await sink.publish({
            type: 'tool_call_start',
            itemId,
            contentIndex: index,
            toolCallId: id,
            name,
          });
          break;
        }
        case 'toolcall_delta':
        case 'tool_call_delta': {
          const tool = requireTool(tools, itemId);
          const delta = requiredString(
            data.delta ?? data.argumentsDelta ?? data.arguments_delta,
            type,
          );
          tool.args += delta;
          const nameDelta = string(data.nameDelta ?? data.name_delta);
          if (nameDelta) tool.name += nameDelta;
          await sink.publish({
            type: 'tool_call_delta',
            itemId,
            contentIndex: tool.index,
            argumentsDelta: delta,
            ...(nameDelta ? { nameDelta } : {}),
          });
          break;
        }
        case 'toolcall_end':
        case 'tool_call_end': {
          const tool = requireTool(tools, itemId);
          const argumentsText = string(data.arguments) ?? tool.args;
          const parsed = parseToolArguments(argumentsText);
          recordSignature(signatures, itemId, data.signature);
          await sink.publish({
            type: 'tool_call_end',
            itemId,
            contentIndex: tool.index,
            toolCall: {
              type: 'tool_call',
              id: tool.id,
              name: string(data.name) ?? tool.name,
              status: parsed.ok ? 'complete' : 'incomplete',
              rawArguments: argumentsText,
              ...(parsed.ok ? { arguments: parsed.value } : {}),
              ...(data.signature === undefined
                ? {}
                : { replay: signatureReplay(request, data.signature) }),
            },
          });
          break;
        }
        case 'rewrite':
        case 'diagnostic':
          diagnostics.push({
            code: string(data.code) ?? 'PI_REWRITE',
            message: string(data.message) ?? 'PI gateway rewrote the request',
            severity: data.severity === 'warning' ? 'warning' : 'info',
          });
          break;
        case 'done':
        case 'response_end':
          terminalSeen = true;
          responseId =
            string(data.responseId ?? data.response_id ?? data.id) ??
            responseId;
          responseModelId = string(data.model) ?? responseModelId;
          usage = mapUsage(data.usage);
          finishReason = mapFinishReason(
            string(data.finishReason ?? data.finish_reason),
            hasTools,
          );
          break;
        case 'error':
          return failed(
            string(data.code) ?? 'PI_MESSAGES_PROVIDER_ERROR',
            'provider',
            string(data.message) ?? 'PI Messages provider returned an error',
            data.retryable === true,
          );
      }
    }
  } catch (error) {
    if (request.signal.aborted || isAbort(error))
      return cancelled(
        'PI_MESSAGES_CANCELLED',
        'PI Messages request was cancelled',
      );
    if (error instanceof AiRuntimeError) return { status: 'failed', error };
    return failed(
      'PI_MESSAGES_INVALID_STREAM',
      'invalid_response',
      'PI Messages stream was invalid',
    );
  }

  if (!terminalSeen)
    return failed(
      'PI_MESSAGES_STREAM_INCOMPLETE',
      'invalid_response',
      'PI Messages stream ended without a terminal event',
    );
  return {
    status: 'completed',
    finishReason,
    ...(responseId ? { responseId } : {}),
    ...(responseModelId ? { responseModelId } : {}),
    ...(usage ? { usage, cost: calculateCost(request.model, usage) } : {}),
    ...(diagnostics.length ? { diagnostics: Object.freeze(diagnostics) } : {}),
    ...(Object.keys(signatures).length
      ? {
          replay: {
            version: 1,
            scope: 'same-model',
            source: {
              providerInstanceId: request.model.providerInstanceId,
              modelId: request.model.id,
              protocol: request.model.protocol,
            },
            protocolId: 'pi-messages',
            codecId: 'pi-message-signature',
            codecVersion: 1,
            data: signatures,
          },
        }
      : {}),
  };
}

function encodeContext(
  request: ChatRequest<'pi-messages'>,
  version: number,
): JsonValue {
  return {
    version,
    ...(request.context.systemPrompt
      ? { systemPrompt: request.context.systemPrompt }
      : {}),
    messages: request.context.messages as unknown as JsonValue,
    tools: (request.context.tools ?? []) as unknown as JsonValue,
  };
}

function signatureReplay(
  request: ChatRequest<'pi-messages'>,
  signature: unknown,
) {
  return {
    version: 1 as const,
    scope: 'same-model' as const,
    source: {
      providerInstanceId: request.model.providerInstanceId,
      modelId: request.model.id,
      protocol: request.model.protocol,
    },
    protocolId: 'pi-messages',
    codecId: 'pi-message-signature',
    codecVersion: 1,
    data: { signature: toJsonValue(signature) },
  };
}

function recordSignature(
  target: Record<string, JsonValue>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined) target[key] = toJsonValue(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]),
    );
  return String(value);
}

function parseData(data: string): Record<string, unknown> {
  try {
    const value = JSON.parse(data) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  } catch {
    return { delta: data };
  }
}

function mapUsage(value: unknown): Usage | undefined {
  const item =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (Object.keys(item).length === 0) return undefined;
  return {
    inputTokens: number(
      item.inputTokens ?? item.input_tokens ?? item.prompt_tokens,
    ),
    outputTokens: number(
      item.outputTokens ?? item.output_tokens ?? item.completion_tokens,
    ),
    reasoningTokens: number(item.reasoningTokens ?? item.reasoning_tokens),
    cacheReadTokens: number(item.cacheReadTokens ?? item.cache_read_tokens),
    cacheWriteTokens: number(item.cacheWriteTokens ?? item.cache_write_tokens),
    totalTokens: number(item.totalTokens ?? item.total_tokens),
  };
}

function mapFinishReason(value: string | undefined, hasTools: boolean) {
  if (hasTools || value === 'tool_calls' || value === 'tool_use')
    return 'tool_calls' as const;
  if (value === 'length' || value === 'max_tokens') return 'length' as const;
  if (value === 'content_filter') return 'content_filter' as const;
  return 'stop' as const;
}

function requireTool(
  tools: Map<string, { index: number; id: string; name: string; args: string }>,
  itemId: string,
) {
  const tool = tools.get(itemId);
  if (!tool)
    throw new AiRuntimeError(
      'PI_MESSAGES_INVALID_TOOL_EVENT',
      'invalid_response',
      `PI Messages referenced unknown tool item ${itemId}`,
    );
  return tool;
}

function requiredString(value: unknown, event: string): string {
  const result = string(value);
  if (result === undefined)
    throw new AiRuntimeError(
      'PI_MESSAGES_INVALID_EVENT',
      'invalid_response',
      `PI Messages ${event} event is missing text`,
    );
  return result;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
function isAbort(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError';
}
function cancelled(code: string, message: string): ProtocolTerminal {
  return {
    status: 'cancelled',
    error: new AiRuntimeError(code, 'cancelled', message) as AiError & {
      category: 'cancelled';
    },
  };
}
function failed(
  code: string,
  category: ConstructorParameters<typeof AiRuntimeError>[1],
  message: string,
  retryable = false,
): ProtocolTerminal {
  if (category === 'cancelled') return cancelled(code, message);
  return {
    status: 'failed',
    error: new AiRuntimeError(code, category, message, retryable),
  };
}
