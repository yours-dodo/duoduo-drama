import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type { Message } from '../../core/messages.js';
import { parseToolArguments } from '../../core/tools.js';
import { calculateCost, type Usage } from '../../core/usage.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';
import { parseServerSentEvents } from './sse.js';

interface OpenAiEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export async function runOpenAiResponses(
  request: ChatRequest<'openai-responses'>,
  sink: ProtocolEventSink,
): Promise<ProtocolTerminal> {
  if (!request.transport)
    return failed(
      'TRANSPORT_UNAVAILABLE',
      'invalid_request',
      'OpenAI Responses requires a bound request transport',
    );
  const response = await request.transport.send({
    method: 'POST',
    body: JSON.stringify(makeRequestBody(request)),
    responseMode: 'stream',
    signal: request.signal,
  });
  if (response.status < 200 || response.status >= 300)
    return httpFailure(
      response.status,
      await readBody(response.body, 64 * 1024),
    );

  let responseId: string | undefined;
  let responseModelId: string | undefined;
  let usage: Usage | undefined;
  let completed = false;
  let hasToolCall = false;
  let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' =
    'stop';
  const items = new Map<
    string,
    {
      kind: 'text' | 'reasoning' | 'tool';
      index: number;
      callId?: string;
      name?: string;
      arguments: string;
    }
  >();

  try {
    for await (const frame of parseServerSentEvents(response.body)) {
      if (frame.data === '[DONE]') continue;
      let event: OpenAiEvent;
      try {
        event = JSON.parse(frame.data) as OpenAiEvent;
      } catch {
        throw new AiRuntimeError(
          'OPENAI_INVALID_SSE',
          'invalid_response',
          'OpenAI SSE data is not valid JSON',
        );
      }
      if (frame.event && frame.event !== event.type)
        throw new AiRuntimeError(
          'OPENAI_INVALID_SSE',
          'invalid_response',
          'OpenAI SSE event name does not match its payload',
        );
      switch (event.type) {
        case 'response.created': {
          const created = object(event.response);
          responseId = string(created.id) ?? responseId;
          responseModelId = string(created.model) ?? responseModelId;
          break;
        }
        case 'response.output_item.added': {
          const item = object(event.item);
          const itemId = string(item.id) ?? string(item.call_id);
          const outputIndex = number(event.output_index) ?? 0;
          if (!itemId) throw invalidEvent(event.type);
          if (item.type === 'function_call') {
            const callId = string(item.call_id) ?? itemId;
            const name = string(item.name) ?? '';
            items.set(itemId, {
              kind: 'tool',
              index: outputIndex,
              callId,
              name,
              arguments: '',
            });
            hasToolCall = true;
            await sink.publish({
              type: 'tool_call_start',
              itemId,
              contentIndex: outputIndex,
              toolCallId: callId,
              name,
            });
          } else if (item.type === 'reasoning') {
            items.set(itemId, {
              kind: 'reasoning',
              index: outputIndex,
              arguments: '',
            });
            await sink.publish({
              type: 'reasoning_start',
              itemId,
              contentIndex: outputIndex,
            });
          }
          break;
        }
        case 'response.content_part.added': {
          const itemId = requiredString(event.item_id, event.type);
          const contentIndex =
            number(event.output_index) ?? number(event.content_index) ?? 0;
          const part = object(event.part);
          if (part.type === 'output_text' && !items.has(itemId)) {
            items.set(itemId, {
              kind: 'text',
              index: contentIndex,
              arguments: '',
            });
            await sink.publish({ type: 'text_start', itemId, contentIndex });
          }
          break;
        }
        case 'response.output_text.delta': {
          const itemId = requiredString(event.item_id, event.type);
          const item = requireItem(items, itemId, 'text');
          await sink.publish({
            type: 'text_delta',
            itemId,
            contentIndex: item.index,
            delta: requiredString(event.delta, event.type),
          });
          break;
        }
        case 'response.output_text.done': {
          const itemId = requiredString(event.item_id, event.type);
          const item = requireItem(items, itemId, 'text');
          await sink.publish({
            type: 'text_end',
            itemId,
            contentIndex: item.index,
          });
          break;
        }
        case 'response.reasoning_summary_text.delta': {
          const itemId = requiredString(event.item_id, event.type);
          const item = requireItem(items, itemId, 'reasoning');
          await sink.publish({
            type: 'reasoning_delta',
            itemId,
            contentIndex: item.index,
            delta: requiredString(event.delta, event.type),
          });
          break;
        }
        case 'response.reasoning_summary_text.done':
        case 'response.reasoning_summary_part.done': {
          const itemId = requiredString(event.item_id, event.type);
          const item = requireItem(items, itemId, 'reasoning');
          await sink.publish({
            type: 'reasoning_end',
            itemId,
            contentIndex: item.index,
          });
          break;
        }
        case 'response.function_call_arguments.delta': {
          const itemId = requiredString(event.item_id, event.type);
          const item = requireItem(items, itemId, 'tool');
          const delta = requiredString(event.delta, event.type);
          item.arguments += delta;
          await sink.publish({
            type: 'tool_call_delta',
            itemId,
            contentIndex: item.index,
            argumentsDelta: delta,
          });
          break;
        }
        case 'response.function_call_arguments.done': {
          const itemId = requiredString(event.item_id, event.type);
          const item = requireItem(items, itemId, 'tool');
          const rawArguments = string(event.arguments) ?? item.arguments;
          if (rawArguments !== item.arguments && item.arguments.length === 0) {
            item.arguments = rawArguments;
            await sink.publish({
              type: 'tool_call_delta',
              itemId,
              contentIndex: item.index,
              argumentsDelta: rawArguments,
            });
          }
          const parsed = parseToolArguments(item.arguments);
          await sink.publish({
            type: 'tool_call_end',
            itemId,
            contentIndex: item.index,
            toolCall: {
              type: 'tool_call',
              id: item.callId ?? itemId,
              name: item.name ?? '',
              status: parsed.ok ? 'complete' : 'incomplete',
              rawArguments: item.arguments,
              ...(parsed.ok ? { arguments: parsed.value } : {}),
            },
          });
          break;
        }
        case 'response.completed': {
          const completedResponse = object(event.response);
          responseId = string(completedResponse.id) ?? responseId;
          responseModelId = string(completedResponse.model) ?? responseModelId;
          usage = mapUsage(completedResponse.usage);
          completed = true;
          break;
        }
        case 'response.incomplete': {
          const incomplete = object(event.response);
          responseId = string(incomplete.id) ?? responseId;
          responseModelId = string(incomplete.model) ?? responseModelId;
          usage = mapUsage(incomplete.usage);
          const reason = string(object(incomplete.incomplete_details).reason);
          finishReason =
            reason === 'content_filter' ? 'content_filter' : 'length';
          completed = true;
          break;
        }
        case 'response.failed': {
          const failedResponse = object(event.response);
          return {
            status: 'failed',
            error: mapOpenAiError(object(failedResponse.error)),
            responseId: string(failedResponse.id),
            responseModelId: string(failedResponse.model),
          };
        }
        case 'error':
          return {
            status: 'failed',
            error: mapOpenAiError(object(event.error)),
          };
      }
    }
  } catch (error) {
    if (request.signal.aborted)
      return {
        status: 'cancelled',
        error: new AiRuntimeError(
          'REQUEST_CANCELLED',
          'cancelled',
          'request cancelled',
        ) as AiError & { category: 'cancelled' },
      };
    if (error instanceof AiRuntimeError) return { status: 'failed', error };
    throw error;
  }
  if (!completed)
    return failed(
      'OPENAI_STREAM_INCOMPLETE',
      'invalid_response',
      'OpenAI stream ended without a terminal response event',
    );
  if (hasToolCall) finishReason = 'tool_calls';
  return {
    status: 'completed',
    finishReason,
    responseId,
    responseModelId,
    usage,
    cost: usage ? calculateCost(request.model, usage) : undefined,
    ...(responseId
      ? {
          replay: {
            version: 1,
            scope: 'same-provider',
            protocolId: 'openai-responses',
            codecId: 'openai-response-id',
            codecVersion: 1,
            data: { responseId },
          } as const,
        }
      : {}),
  };
}

function makeRequestBody(
  request: ChatRequest<'openai-responses'>,
): Record<string, unknown> {
  return {
    model: request.model.upstreamModelId,
    input: request.context.messages.flatMap(mapMessage),
    max_output_tokens: request.options.maxOutputTokens,
    stream: true,
    ...(request.context.systemPrompt
      ? { instructions: request.context.systemPrompt }
      : {}),
    ...(request.context.tools?.length
      ? {
          tools: request.context.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            parameters: tool.inputSchema,
          })),
        }
      : {}),
  };
}

function mapMessage(message: Message): readonly Record<string, unknown>[] {
  if (message.role === 'tool_result') {
    return [
      {
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: message.content
          .map((part) => (part.type === 'text' ? part.text : ''))
          .join(''),
      },
    ];
  }
  const content: Record<string, unknown>[] = [];
  for (const part of message.content) {
    if (part.type === 'text') {
      content.push({
        type: message.role === 'assistant' ? 'output_text' : 'input_text',
        text: part.text,
      });
    } else if (part.type === 'image' && message.role === 'user') {
      content.push(
        part.source.type === 'url'
          ? { type: 'input_image', image_url: part.source.url }
          : {
              type: 'input_image',
              image_url: `data:${part.mediaType};base64,${part.source.data}`,
            },
      );
    }
  }
  return [{ role: message.role, content }];
}

function mapUsage(value: unknown): Usage | undefined {
  const usage = object(value);
  if (Object.keys(usage).length === 0) return undefined;
  const details = object(usage.output_tokens_details);
  return {
    inputTokens: number(usage.input_tokens),
    outputTokens: number(usage.output_tokens),
    reasoningTokens: number(details.reasoning_tokens),
    totalTokens: number(usage.total_tokens),
    serviceTier: string(usage.service_tier),
  };
}

async function readBody(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of body) {
    length += chunk.byteLength;
    if (length > maxBytes) break;
    chunks.push(chunk);
  }
  const joined = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function httpFailure(status: number, body: string): ProtocolTerminal {
  let error: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    error = object(parsed.error);
  } catch {
    // Error bodies are untrusted and optional.
  }
  const code = string(error.code) ?? string(error.type);
  if (status === 401 || status === 403)
    return failed('OPENAI_AUTH_FAILED', 'auth', 'OpenAI authentication failed');
  if (status === 429)
    return failed(
      'OPENAI_RATE_LIMITED',
      'rate_limit',
      'OpenAI rate limit exceeded',
      true,
    );
  if (code === 'context_length_exceeded')
    return failed(
      'CONTEXT_OVERFLOW',
      'invalid_request',
      'model context length exceeded',
    );
  if (status >= 500)
    return failed(
      'OPENAI_PROVIDER_ERROR',
      'provider',
      'OpenAI provider request failed',
      true,
    );
  return failed(
    'OPENAI_INVALID_REQUEST',
    'invalid_request',
    'OpenAI rejected the request',
  );
}

function mapOpenAiError(error: Record<string, unknown>): AiError {
  const code = string(error.code) ?? string(error.type);
  if (code === 'context_length_exceeded')
    return new AiRuntimeError(
      'CONTEXT_OVERFLOW',
      'invalid_request',
      'model context length exceeded',
    );
  return new AiRuntimeError(
    'OPENAI_PROVIDER_ERROR',
    'provider',
    'OpenAI provider request failed',
    true,
  );
}

function failed(
  code: string,
  category: AiError['category'],
  message: string,
  retryable = false,
): ProtocolTerminal {
  return {
    status: 'failed',
    error: new AiRuntimeError(code, category, message, retryable),
  };
}

function requireItem(
  items: Map<
    string,
    {
      kind: 'text' | 'reasoning' | 'tool';
      index: number;
      callId?: string;
      name?: string;
      arguments: string;
    }
  >,
  itemId: string,
  kind: 'text' | 'reasoning' | 'tool',
) {
  const item = items.get(itemId);
  if (!item || item.kind !== kind) throw invalidEvent(`missing ${kind} item`);
  return item;
}

function invalidEvent(type: string): AiRuntimeError {
  return new AiRuntimeError(
    'OPENAI_INVALID_EVENT',
    'invalid_response',
    `invalid OpenAI stream event: ${type}`,
  );
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function requiredString(value: unknown, type: string): string {
  const result = string(value);
  if (result === undefined) throw invalidEvent(type);
  return result;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
