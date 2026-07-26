import type { ReplayMetadata } from '../../core/content.js';
import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type { Message } from '../../core/messages.js';
import { parseToolArguments } from '../../core/tools.js';
import { calculateCost, type Usage } from '../../core/usage.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';
import { parseServerSentEvents } from '../../transport/sse.js';

export interface DashScopeCompatibility {
  readonly wireVersion: 1;
  readonly nativeRoute:
    'text-generation/generation' | 'multimodal-generation/generation';
  readonly supportsIncrementalOutput: boolean;
  readonly supportsThinking: boolean;
  readonly supportsTools: boolean;
}

export interface DashScopeProtocolOptions {
  readonly enableThinking?: boolean;
  readonly thinkingBudget?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly seed?: number;
  readonly toolChoice?: 'auto' | 'none';
}

export interface DashScopeAdapterOptions {
  readonly compatibility?: Partial<DashScopeCompatibility>;
}

interface ToolState {
  readonly itemId: string;
  readonly contentIndex: number;
  id: string;
  name: string;
  arguments: string;
}

export const dashScopeContract = Object.freeze({
  protocol: 'dashscope' as const,
  route: 'curated-native-route' as const,
  streaming: true,
  terminalOwner: 'runtime' as const,
});

export const dashScopeReplayCodecs = Object.freeze([
  Object.freeze({ id: 'dashscope-request-id', version: 1 }),
]);

const defaultCompatibility: DashScopeCompatibility = Object.freeze({
  wireVersion: 1,
  nativeRoute: 'text-generation/generation',
  supportsIncrementalOutput: true,
  supportsThinking: true,
  supportsTools: true,
});

export function createDashScopeAdapter(options: DashScopeAdapterOptions = {}) {
  const compatibility = Object.freeze({
    ...defaultCompatibility,
    ...options.compatibility,
  });
  return (
    request: ChatRequest<'dashscope'>,
    sink: ProtocolEventSink,
  ): Promise<ProtocolTerminal> =>
    runWithCompatibility(request, sink, compatibility);
}

export const runDashScope = createDashScopeAdapter();

async function runWithCompatibility(
  request: ChatRequest<'dashscope'>,
  sink: ProtocolEventSink,
  compatibility: DashScopeCompatibility,
): Promise<ProtocolTerminal> {
  if (!request.transport)
    return failed(
      'TRANSPORT_UNAVAILABLE',
      'invalid_request',
      'DashScope requires a bound request transport',
    );

  let response;
  try {
    response = await request.transport.send({
      method: 'POST',
      headers: { 'x-dashscope-sse': 'enable' },
      body: JSON.stringify(makeRequestBody(request, compatibility)),
      responseMode: 'stream',
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted || isAbort(error))
      return cancelled('DashScope request was cancelled');
    return failed(
      'DASHSCOPE_NETWORK',
      'network',
      'DashScope request failed before a response was received',
      true,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    await discardLimited(response.body, 64 * 1024, request.signal);
    return failed(
      `DASHSCOPE_HTTP_${response.status}`,
      response.status === 400 || response.status === 422
        ? 'invalid_request'
        : response.status === 401 || response.status === 403
          ? 'auth'
          : response.status === 429
            ? 'rate_limit'
            : 'provider',
      `DashScope request failed with HTTP ${response.status}`,
      response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
    );
  }

  let responseId: string | undefined;
  let responseModelId: string | undefined;
  let usage: Usage | undefined;
  let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' =
    'stop';
  let sawChoice = false;
  let textStarted = false;
  let reasoningStarted = false;
  let textContentIndex: number | undefined;
  let reasoningContentIndex: number | undefined;
  let nextContentIndex = 0;
  const tools = new Map<number, ToolState>();

  try {
    for await (const frame of parseServerSentEvents(
      response.body,
      1024 * 1024,
      'DASHSCOPE_INVALID_SSE',
    )) {
      let chunk: Record<string, unknown>;
      try {
        chunk = object(JSON.parse(frame.data));
      } catch {
        throw new AiRuntimeError(
          'DASHSCOPE_INVALID_JSON',
          'invalid_response',
          'DashScope stream data is not valid JSON',
        );
      }
      if (chunk.code || chunk.message)
        return failed(
          'DASHSCOPE_PROVIDER_ERROR',
          'provider',
          'DashScope returned a provider error',
        );
      responseId = string(chunk.request_id) ?? responseId;
      responseModelId = string(chunk.model) ?? responseModelId;
      usage = mergeUsage(usage, mapUsage(chunk.usage));
      const output = object(chunk.output);
      for (const rawChoice of array(output.choices)) {
        sawChoice = true;
        const choice = object(rawChoice);
        const message = object(choice.message);
        const choiceIndex = number(choice.index) ?? 0;
        const reasoning = string(message.reasoning_content);
        if (reasoning !== undefined) {
          if (!reasoningStarted) {
            reasoningStarted = true;
            reasoningContentIndex = nextContentIndex++;
            await sink.publish({
              type: 'reasoning_start',
              itemId: `reasoning-${choiceIndex}`,
              contentIndex: reasoningContentIndex,
            });
          }
          if (reasoning)
            await sink.publish({
              type: 'reasoning_delta',
              itemId: `reasoning-${choiceIndex}`,
              contentIndex: reasoningContentIndex!,
              delta: reasoning,
            });
        }
        const content = extractText(message.content);
        if (content !== undefined) {
          if (!textStarted) {
            textStarted = true;
            textContentIndex = nextContentIndex++;
            await sink.publish({
              type: 'text_start',
              itemId: `text-${choiceIndex}`,
              contentIndex: textContentIndex,
            });
          }
          if (content)
            await sink.publish({
              type: 'text_delta',
              itemId: `text-${choiceIndex}`,
              contentIndex: textContentIndex!,
              delta: content,
            });
        }
        for (const rawTool of array(message.tool_calls)) {
          const tool = object(rawTool);
          const index = number(tool.index) ?? 0;
          const fn = object(tool.function);
          let state = tools.get(index);
          if (!state) {
            state = {
              itemId: `tool-${choiceIndex}-${index}`,
              contentIndex: nextContentIndex++,
              id: string(tool.id) ?? `tool-${index}`,
              name: string(fn.name) ?? '',
              arguments: '',
            };
            tools.set(index, state);
            await sink.publish({
              type: 'tool_call_start',
              itemId: state.itemId,
              contentIndex: state.contentIndex,
              toolCallId: state.id,
              ...(state.name ? { name: state.name } : {}),
            });
          }
          const id = string(tool.id);
          if (id) state.id = id;
          const name = string(fn.name);
          const nameDelta = name && !state.name ? name : undefined;
          if (name) state.name = name;
          const argumentsDelta = string(fn.arguments) ?? '';
          if (argumentsDelta || nameDelta) {
            state.arguments += argumentsDelta;
            await sink.publish({
              type: 'tool_call_delta',
              itemId: state.itemId,
              contentIndex: state.contentIndex,
              argumentsDelta,
              ...(nameDelta ? { nameDelta } : {}),
            });
          }
        }
        const rawFinish = string(choice.finish_reason);
        if (rawFinish && rawFinish !== 'null')
          finishReason = mapFinishReason(rawFinish);
      }
    }
  } catch (error) {
    if (request.signal.aborted || isAbort(error))
      return cancelled('DashScope request was cancelled');
    if (error instanceof AiRuntimeError) return { status: 'failed', error };
    return failed(
      'DASHSCOPE_STREAM_FAILED',
      'invalid_response',
      'DashScope stream could not be decoded',
    );
  }

  if (!sawChoice)
    return failed(
      'DASHSCOPE_STREAM_INCOMPLETE',
      'invalid_response',
      'DashScope stream ended without a choice',
    );
  if (reasoningStarted)
    await sink.publish({
      type: 'reasoning_end',
      itemId: 'reasoning-0',
      contentIndex: reasoningContentIndex!,
    });
  if (textStarted)
    await sink.publish({
      type: 'text_end',
      itemId: 'text-0',
      contentIndex: textContentIndex!,
    });
  for (const state of tools.values()) {
    const parsed = parseToolArguments(state.arguments || '{}');
    await sink.publish({
      type: 'tool_call_end',
      itemId: state.itemId,
      contentIndex: state.contentIndex,
      toolCall: {
        type: 'tool_call',
        id: state.id,
        name: state.name,
        status: parsed.ok ? 'complete' : 'incomplete',
        rawArguments: state.arguments,
        ...(parsed.ok ? { arguments: parsed.value } : {}),
      },
    });
  }
  if (tools.size > 0) finishReason = 'tool_calls';
  const replay = responseId ? makeReplay(request, responseId) : undefined;
  return {
    status: 'completed',
    finishReason,
    ...(responseId ? { responseId } : {}),
    ...(responseModelId ? { responseModelId } : {}),
    ...(usage ? { usage, cost: calculateCost(request.model, usage) } : {}),
    ...(replay ? { replay } : {}),
  };
}

function makeRequestBody(
  request: ChatRequest<'dashscope'>,
  compatibility: DashScopeCompatibility,
): Record<string, unknown> {
  const options = request.options.protocolOptions as DashScopeProtocolOptions;
  const messages = mapMessages(
    request.context.messages,
    request.context.systemPrompt,
  );
  const parameters: Record<string, unknown> = {
    result_format: 'message',
    incremental_output: compatibility.supportsIncrementalOutput,
    max_tokens: request.options.maxOutputTokens,
  };
  if (compatibility.supportsThinking && options.enableThinking !== undefined)
    parameters.enable_thinking = options.enableThinking;
  if (compatibility.supportsThinking && options.thinkingBudget !== undefined)
    parameters.thinking_budget = positiveInteger(
      options.thinkingBudget,
      'thinkingBudget',
    );
  const temperature = request.options.temperature ?? options.temperature;
  const topP = request.options.topP ?? options.topP;
  if (temperature !== undefined)
    parameters.temperature = finiteNumber(temperature, 'temperature');
  if (topP !== undefined) parameters.top_p = finiteNumber(topP, 'topP');
  if (options.seed !== undefined)
    parameters.seed = positiveInteger(options.seed, 'seed');
  if (compatibility.supportsTools && request.context.tools?.length)
    parameters.tools = request.context.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.inputSchema,
      },
    }));
  const toolChoice = request.options.toolChoice ?? options.toolChoice;
  if (
    compatibility.supportsTools &&
    toolChoice !== undefined &&
    toolChoice !== 'auto'
  )
    parameters.tool_choice =
      typeof toolChoice === 'object'
        ? { type: 'function', function: { name: toolChoice.name } }
        : toolChoice;
  return {
    model: request.model.upstreamModelId,
    input: { messages },
    parameters,
  };
}

function mapMessages(
  messages: readonly Message[],
  systemPrompt: string | undefined,
): readonly Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  if (systemPrompt) output.push({ role: 'system', content: systemPrompt });
  for (const message of messages) {
    if (message.role === 'tool_result') {
      output.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        name: message.toolName,
        content: mapContent(message.content),
      });
      continue;
    }
    if (message.role === 'assistant') {
      const toolCalls = message.content
        .filter((part) => part.type === 'tool_call')
        .map((part) => ({
          id: part.id,
          type: 'function',
          function: { name: part.name, arguments: part.rawArguments },
        }));
      const reasoning = message.content
        .filter((part) => part.type === 'reasoning')
        .map((part) => part.text ?? '')
        .join('');
      output.push({
        role: 'assistant',
        content: mapContent(message.content),
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else output.push({ role: 'user', content: mapContent(message.content) });
  }
  return output;
}

function mapContent(
  content: readonly (
    | { readonly type: 'text'; readonly text: string }
    | {
        readonly type: 'image';
        readonly mediaType: string;
        readonly source:
          | { readonly type: 'url'; readonly url: string }
          | { readonly type: 'base64'; readonly data: string };
      }
    | { readonly type: 'reasoning'; readonly text?: string }
    | { readonly type: 'tool_call' }
  )[],
): string | readonly Record<string, string>[] {
  const values: Record<string, string>[] = [];
  for (const part of content) {
    if (part.type === 'text') values.push({ text: part.text });
    else if (part.type === 'image')
      values.push({
        image:
          part.source.type === 'url'
            ? part.source.url
            : `data:${part.mediaType};base64,${part.source.data}`,
      });
  }
  if (values.length === 1 && values[0]?.text !== undefined)
    return values[0].text;
  return values;
}

function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const parts = array(value);
  if (parts.length === 0) return value === undefined ? undefined : '';
  return parts.map((part) => string(object(part).text) ?? '').join('');
}

function mapUsage(value: unknown): Usage | undefined {
  const usage = object(value);
  const inputTokens = number(usage.input_tokens);
  const outputTokens = number(usage.output_tokens);
  const totalTokens = number(usage.total_tokens);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  )
    return undefined;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

function mergeUsage(
  current: Usage | undefined,
  next: Usage | undefined,
): Usage | undefined {
  if (!next) return current;
  return {
    inputTokens: next.inputTokens ?? current?.inputTokens,
    outputTokens: next.outputTokens ?? current?.outputTokens,
    totalTokens: next.totalTokens ?? current?.totalTokens,
  };
}

function makeReplay(
  request: ChatRequest<'dashscope'>,
  requestId: string,
): ReplayMetadata {
  return {
    version: 1,
    scope: 'same-provider',
    source: {
      providerInstanceId: request.model.providerInstanceId,
      modelId: request.model.id,
      protocol: request.model.protocol,
    },
    protocolId: 'dashscope',
    codecId: 'dashscope-request-id',
    codecVersion: 1,
    data: { requestId },
  };
}

function mapFinishReason(
  value: string,
): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
  if (value === 'length') return 'length';
  if (value === 'tool_calls') return 'tool_calls';
  if (value === 'content_filter') return 'content_filter';
  return 'stop';
}

async function discardLimited(
  body: AsyncIterable<Uint8Array>,
  limit: number,
  signal: AbortSignal,
): Promise<void> {
  let size = 0;
  try {
    for await (const chunk of body) {
      if (signal.aborted) return;
      size += chunk.byteLength;
      if (size >= limit) return;
    }
  } catch {
    // The status code is the authoritative error; response bodies are untrusted.
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new AiRuntimeError(
      'DASHSCOPE_INVALID_OPTION',
      'invalid_request',
      `${name} must be a non-negative safe integer`,
    );
  return value;
}

function finiteNumber(value: number, name: string): number {
  if (!Number.isFinite(value))
    throw new AiRuntimeError(
      'DASHSCOPE_INVALID_OPTION',
      'invalid_request',
      `${name} must be finite`,
    );
  return value;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof DOMException ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function cancelled(message: string): ProtocolTerminal {
  return {
    status: 'cancelled',
    error: new AiRuntimeError(
      'DASHSCOPE_CANCELLED',
      'cancelled',
      message,
    ) as AiError & { category: 'cancelled' },
  };
}

function failed(
  code: string,
  category: AiError['category'],
  message: string,
  retryable = false,
): ProtocolTerminal {
  if (category === 'cancelled') return cancelled(message);
  return {
    status: 'failed',
    error: new AiRuntimeError(code, category, message, retryable),
  };
}
