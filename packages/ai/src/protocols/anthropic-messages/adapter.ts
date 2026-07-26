import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type { Message } from '../../core/messages.js';
import { parseToolArguments } from '../../core/tools.js';
import { calculateCost, type Usage } from '../../core/usage.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';
import { parseServerSentEvents } from './sse.js';

interface AnthropicEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface AnthropicMessagesCompatibility {
  readonly supportsEagerToolInputStreaming?: boolean;
  readonly supportsLongCacheRetention?: boolean;
  readonly sendSessionAffinityHeaders?: boolean;
  readonly supportsCacheControlOnTools?: boolean;
  readonly supportsTemperature?: boolean;
  readonly forceAdaptiveThinking?: boolean;
  readonly allowEmptySignature?: boolean;
  readonly supportsToolReferences?: boolean;
}

export interface AnthropicMessagesAdapterOptions {
  readonly compatibility?: AnthropicMessagesCompatibility;
}

export const anthropicMessagesContract = Object.freeze({
  protocol: 'anthropic-messages' as const,
  streaming: true,
  terminalOwner: 'runtime' as const,
});

export const anthropicMessagesReplayCodecs = Object.freeze([
  Object.freeze({ id: 'anthropic-signature', version: 1 }),
  Object.freeze({ id: 'anthropic-redacted-thinking', version: 1 }),
]);

export function createAnthropicMessagesAdapter(
  options: AnthropicMessagesAdapterOptions = {},
) {
  const compatibility = Object.freeze({ ...options.compatibility });
  return (
    request: ChatRequest<'anthropic-messages'>,
    sink: ProtocolEventSink,
  ) => runAnthropicMessagesWithCompatibility(request, sink, compatibility);
}

export async function runAnthropicMessages(
  request: ChatRequest<'anthropic-messages'>,
  sink: ProtocolEventSink,
): Promise<ProtocolTerminal> {
  return runAnthropicMessagesWithCompatibility(request, sink, {});
}

async function runAnthropicMessagesWithCompatibility(
  request: ChatRequest<'anthropic-messages'>,
  sink: ProtocolEventSink,
  compatibility: AnthropicMessagesCompatibility,
): Promise<ProtocolTerminal> {
  if (!request.transport)
    return failed(
      'TRANSPORT_UNAVAILABLE',
      'invalid_request',
      'Anthropic Messages requires a bound request transport',
    );
  const response = await request.transport.send({
    method: 'POST',
    body: JSON.stringify(makeRequestBody(request, compatibility)),
    responseMode: 'stream',
    signal: request.signal,
  });
  if (response.status < 200 || response.status >= 300)
    return httpFailure(response.status);

  let responseId: string | undefined;
  let responseModelId: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let finishReason: 'stop' | 'length' | 'tool_calls' = 'stop';
  let completed = false;
  const blocks = new Map<
    number,
    | { kind: 'text'; itemId: string }
    | {
        kind: 'reasoning';
        itemId: string;
        signature?: string;
        redactedData?: string;
      }
    | {
        kind: 'tool';
        itemId: string;
        toolCallId: string;
        name: string;
        arguments: string;
        emptyInputFallback?: string;
      }
  >();
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let cacheWriteTokensByRetention:
    Readonly<Partial<Record<'standard' | 'one_hour', number>>> | undefined;

  try {
    for await (const frame of parseServerSentEvents(response.body)) {
      let event: AnthropicEvent;
      try {
        event = JSON.parse(frame.data) as AnthropicEvent;
      } catch {
        throw invalidEvent('invalid JSON');
      }
      if (frame.event && frame.event !== event.type)
        throw invalidEvent('event name mismatch');
      switch (event.type) {
        case 'message_start': {
          const message = object(event.message);
          const usage = object(message.usage);
          responseId = string(message.id);
          responseModelId = string(message.model);
          inputTokens = number(usage.input_tokens);
          outputTokens = number(usage.output_tokens);
          cacheReadTokens = number(usage.cache_read_input_tokens);
          cacheWriteTokens = number(usage.cache_creation_input_tokens);
          const cacheCreation = object(usage.cache_creation);
          const standard = number(cacheCreation.ephemeral_5m_input_tokens);
          const oneHour = number(cacheCreation.ephemeral_1h_input_tokens);
          if (standard !== undefined || oneHour !== undefined)
            cacheWriteTokensByRetention = {
              ...(standard === undefined ? {} : { standard }),
              ...(oneHour === undefined ? {} : { one_hour: oneHour }),
            };
          break;
        }
        case 'content_block_start': {
          const index = requiredNumber(event.index, event.type);
          const block = object(event.content_block);
          const itemId = `content-${index}`;
          if (block.type === 'text') {
            blocks.set(index, { kind: 'text', itemId });
            await sink.publish({
              type: 'text_start',
              itemId,
              contentIndex: index,
            });
            const initialText = string(block.text);
            if (initialText)
              await sink.publish({
                type: 'text_delta',
                itemId,
                contentIndex: index,
                delta: initialText,
              });
          } else if (block.type === 'thinking') {
            blocks.set(index, { kind: 'reasoning', itemId });
            await sink.publish({
              type: 'reasoning_start',
              itemId,
              contentIndex: index,
            });
            const initialThinking = string(block.thinking);
            if (initialThinking)
              await sink.publish({
                type: 'reasoning_delta',
                itemId,
                contentIndex: index,
                delta: initialThinking,
              });
          } else if (block.type === 'redacted_thinking') {
            blocks.set(index, {
              kind: 'reasoning',
              itemId,
              redactedData: requiredString(block.data, event.type),
            });
            await sink.publish({
              type: 'reasoning_start',
              itemId,
              contentIndex: index,
            });
          } else if (block.type === 'tool_use') {
            const toolCallId = requiredString(block.id, event.type);
            const name = requiredString(block.name, event.type);
            const initialArguments = initialToolArguments(block.input);
            blocks.set(index, {
              kind: 'tool',
              itemId,
              toolCallId,
              name,
              arguments: initialArguments,
              ...(initialArguments === '' && block.input !== undefined
                ? { emptyInputFallback: JSON.stringify(block.input) }
                : {}),
            });
            await sink.publish({
              type: 'tool_call_start',
              itemId,
              contentIndex: index,
              toolCallId,
              name,
            });
            if (initialArguments)
              await sink.publish({
                type: 'tool_call_delta',
                itemId,
                contentIndex: index,
                argumentsDelta: initialArguments,
              });
          } else {
            throw invalidEvent(event.type);
          }
          break;
        }
        case 'content_block_delta': {
          const index = requiredNumber(event.index, event.type);
          const block = blocks.get(index);
          const delta = object(event.delta);
          if (!block) throw invalidEvent(event.type);
          if (block.kind === 'text' && delta.type === 'text_delta') {
            await sink.publish({
              type: 'text_delta',
              itemId: block.itemId,
              contentIndex: index,
              delta: requiredString(delta.text, event.type),
            });
          } else if (
            block.kind === 'reasoning' &&
            delta.type === 'thinking_delta'
          ) {
            await sink.publish({
              type: 'reasoning_delta',
              itemId: block.itemId,
              contentIndex: index,
              delta: requiredString(delta.thinking, event.type),
            });
          } else if (
            block.kind === 'reasoning' &&
            delta.type === 'signature_delta'
          ) {
            block.signature = requiredString(delta.signature, event.type);
          } else if (
            block.kind === 'tool' &&
            delta.type === 'input_json_delta'
          ) {
            const argumentsDelta = requiredString(
              delta.partial_json,
              event.type,
            );
            block.arguments += argumentsDelta;
            await sink.publish({
              type: 'tool_call_delta',
              itemId: block.itemId,
              contentIndex: index,
              argumentsDelta,
            });
          } else {
            throw invalidEvent(event.type);
          }
          break;
        }
        case 'content_block_stop': {
          const index = requiredNumber(event.index, event.type);
          const block = blocks.get(index);
          if (!block) throw invalidEvent(event.type);
          if (block.kind === 'text') {
            await sink.publish({
              type: 'text_end',
              itemId: block.itemId,
              contentIndex: index,
            });
          } else if (block.kind === 'reasoning') {
            if (
              !block.redactedData &&
              block.signature === undefined &&
              compatibility.allowEmptySignature !== true
            )
              throw invalidEvent('missing thinking signature');
            await sink.publish({
              type: 'reasoning_end',
              itemId: block.itemId,
              contentIndex: index,
              ...(block.signature || block.redactedData
                ? {
                    replay: {
                      version: 1,
                      scope: 'same-model',
                      source: {
                        providerInstanceId: request.model.providerInstanceId,
                        modelId: request.model.id,
                        protocol: request.model.protocol,
                      },
                      protocolId: 'anthropic-messages',
                      codecId: block.redactedData
                        ? 'anthropic-redacted-thinking'
                        : 'anthropic-signature',
                      codecVersion: 1,
                      data: block.redactedData
                        ? { redactedData: block.redactedData }
                        : { signature: block.signature! },
                    } as const,
                  }
                : {}),
            });
          } else {
            if (!block.arguments && block.emptyInputFallback) {
              block.arguments = block.emptyInputFallback;
              await sink.publish({
                type: 'tool_call_delta',
                itemId: block.itemId,
                contentIndex: index,
                argumentsDelta: block.arguments,
              });
            }
            const parsed = parseToolArguments(block.arguments);
            await sink.publish({
              type: 'tool_call_end',
              itemId: block.itemId,
              contentIndex: index,
              toolCall: {
                type: 'tool_call',
                id: block.toolCallId,
                name: block.name,
                status: parsed.ok ? 'complete' : 'incomplete',
                rawArguments: block.arguments,
                ...(parsed.ok ? { arguments: parsed.value } : {}),
              },
            });
          }
          blocks.delete(index);
          break;
        }
        case 'message_delta': {
          const delta = object(event.delta);
          const usage = object(event.usage);
          outputTokens = number(usage.output_tokens) ?? outputTokens;
          finishReason = mapStopReason(string(delta.stop_reason));
          break;
        }
        case 'message_stop':
          completed = true;
          break;
        case 'error':
          return {
            status: 'failed',
            error: mapAnthropicError(object(event.error)),
          };
        case 'ping':
          break;
        default:
          throw invalidEvent(event.type);
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
      'ANTHROPIC_STREAM_INCOMPLETE',
      'invalid_response',
      'Anthropic stream ended without message_stop',
    );
  const usage = makeUsage({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheWriteTokensByRetention,
  });
  return {
    status: 'completed',
    finishReason,
    responseId,
    responseModelId,
    usage,
    cost: usage ? calculateCost(request.model, usage) : undefined,
  };
}

function makeRequestBody(
  request: ChatRequest<'anthropic-messages'>,
  compatibility: AnthropicMessagesCompatibility,
): Record<string, unknown> {
  const options = object(request.options.protocolOptions);
  const cacheRetention =
    string(options.cacheRetention) ??
    mapCommonCacheRetention(request.options.cacheRetention);
  const cacheControl =
    cacheRetention === 'one_hour'
      ? { type: 'ephemeral', ttl: '1h' }
      : cacheRetention === 'standard'
        ? { type: 'ephemeral' }
        : undefined;
  const thinking = compatibility.forceAdaptiveThinking
    ? { type: 'adaptive' }
    : mapThinking(options.thinking);
  return {
    model: request.model.upstreamModelId,
    ...(request.context.systemPrompt
      ? cacheControl
        ? {
            system: [
              {
                type: 'text',
                text: request.context.systemPrompt,
                cache_control: cacheControl,
              },
            ],
          }
        : { system: request.context.systemPrompt }
      : {}),
    messages: request.context.messages.flatMap(mapMessage),
    ...(request.context.tools?.length
      ? {
          tools: request.context.tools.map((tool) => ({
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            input_schema: tool.inputSchema,
            ...(cacheControl &&
            compatibility.supportsCacheControlOnTools !== false
              ? { cache_control: cacheControl }
              : {}),
          })),
          ...mapToolChoice(request.options.toolChoice),
        }
      : {}),
    ...(thinking ? { thinking } : {}),
    max_tokens: request.options.maxOutputTokens,
    ...(request.options.temperature === undefined
      ? {}
      : { temperature: request.options.temperature }),
    ...(request.options.topP === undefined
      ? {}
      : { top_p: request.options.topP }),
    ...(request.options.stop.length === 0
      ? {}
      : { stop_sequences: request.options.stop }),
    stream: true,
  };
}

function mapCommonCacheRetention(
  value: import('../../core/models.js').CacheRetention | undefined,
): 'standard' | 'one_hour' | undefined {
  return value === 'short'
    ? 'standard'
    : value === 'long'
      ? 'one_hour'
      : undefined;
}

function mapToolChoice(
  value: import('../../core/models.js').ToolChoice | undefined,
): Record<string, unknown> {
  if (value === undefined || value === 'auto') return {};
  if (value === 'none') return { tool_choice: { type: 'none' } };
  if (value === 'required') return { tool_choice: { type: 'any' } };
  return { tool_choice: { type: 'tool', name: value.name } };
}

function mapMessage(message: Message): readonly Record<string, unknown>[] {
  if (message.role === 'tool_result') {
    return [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId,
            content: message.content.map(mapInputContent),
            is_error: message.isError,
          },
        ],
      },
    ];
  }
  const content: Record<string, unknown>[] = [];
  for (const part of message.content) {
    if (part.type === 'tool_call' && message.role === 'assistant') {
      content.push({
        type: 'tool_use',
        id: part.id,
        name: part.name,
        input: part.arguments ?? parsedArguments(part.rawArguments),
      });
    } else if (part.type === 'reasoning' && message.role === 'assistant') {
      const replay = object(part.replay?.data);
      const signature = string(replay.signature);
      const redactedData = string(replay.redactedData);
      if (redactedData)
        content.push({ type: 'redacted_thinking', data: redactedData });
      else if (part.text !== undefined && signature)
        content.push({ type: 'thinking', thinking: part.text, signature });
    } else if (part.type === 'text') {
      content.push({ type: 'text', text: part.text });
    } else if (part.type === 'image' && message.role === 'user') {
      content.push(mapInputContent(part));
    }
  }
  return [{ role: message.role, content }];
}

function mapInputContent(
  part: Extract<Message, { role: 'user' | 'tool_result' }>['content'][number],
): Record<string, unknown> {
  if (part.type === 'text') return { type: 'text', text: part.text };
  return {
    type: 'image',
    source:
      part.source.type === 'base64'
        ? {
            type: 'base64',
            media_type: part.mediaType,
            data: part.source.data,
          }
        : { type: 'url', url: part.source.url },
  };
}

function initialToolArguments(value: unknown): string {
  if (value === undefined) return '';
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  )
    return '';
  return JSON.stringify(value);
}

function parsedArguments(rawArguments: string): unknown {
  const parsed = parseToolArguments(rawArguments);
  return parsed.ok ? parsed.value : {};
}

function mapThinking(value: unknown): Record<string, unknown> | undefined {
  const thinking = object(value);
  if (thinking.type === 'adaptive') return { type: 'adaptive' };
  if (thinking.type !== 'enabled') return undefined;
  const budgetTokens = number(thinking.budgetTokens);
  return budgetTokens === undefined
    ? undefined
    : { type: 'enabled', budget_tokens: budgetTokens };
}

function makeUsage(input: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cacheReadTokens: number | undefined;
  cacheWriteTokens: number | undefined;
  cacheWriteTokensByRetention:
    Readonly<Partial<Record<'standard' | 'one_hour', number>>> | undefined;
}): Usage | undefined {
  const values = [
    input.inputTokens,
    input.outputTokens,
    input.cacheReadTokens,
    input.cacheWriteTokens,
  ];
  if (values.every((value) => value === undefined)) return undefined;
  const knownTotal =
    input.inputTokens === undefined || input.outputTokens === undefined
      ? undefined
      : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheWriteTokens: input.cacheWriteTokens,
    cacheWriteTokensByRetention: input.cacheWriteTokensByRetention,
    totalTokens: knownTotal,
  };
}

function mapStopReason(
  reason: string | undefined,
): 'stop' | 'length' | 'tool_calls' {
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'tool_calls';
  return 'stop';
}

function httpFailure(status: number): ProtocolTerminal {
  if (status === 401 || status === 403)
    return failed(
      'ANTHROPIC_AUTH_FAILED',
      'auth',
      'Anthropic authentication failed',
    );
  if (status === 429)
    return failed(
      'ANTHROPIC_RATE_LIMITED',
      'rate_limit',
      'Anthropic rate limit exceeded',
      true,
    );
  if (status >= 500)
    return failed(
      'ANTHROPIC_PROVIDER_ERROR',
      'provider',
      'Anthropic provider request failed',
      true,
    );
  return failed(
    'ANTHROPIC_INVALID_REQUEST',
    'invalid_request',
    'Anthropic rejected the request',
  );
}

function mapAnthropicError(error: Record<string, unknown>): AiRuntimeError {
  const type = string(error.type);
  if (type === 'overloaded_error')
    return new AiRuntimeError(
      'ANTHROPIC_PROVIDER_ERROR',
      'provider',
      'Anthropic provider request failed',
      true,
    );
  return new AiRuntimeError(
    'ANTHROPIC_INVALID_RESPONSE',
    'invalid_response',
    'Anthropic stream returned an error',
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

function invalidEvent(detail: string): AiRuntimeError {
  return new AiRuntimeError(
    'ANTHROPIC_INVALID_EVENT',
    'invalid_response',
    `invalid Anthropic stream event: ${detail}`,
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

function requiredNumber(value: unknown, type: string): number {
  const result = number(value);
  if (result === undefined) throw invalidEvent(type);
  return result;
}
