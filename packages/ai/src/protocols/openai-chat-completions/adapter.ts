import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type {
  JsonPrimitive,
  JsonValue,
  ReplayMetadata,
} from '../../core/content.js';
import type { Message } from '../../core/messages.js';
import { parseToolArguments } from '../../core/tools.js';
import { calculateCost, type Usage } from '../../core/usage.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';
import { parseServerSentEvents } from '../openai-responses/sse.js';

export type SessionAffinityFormat =
  'openai' | 'openai-nosession' | 'openrouter';

export type OpenAiChatThinkingFormat =
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'together'
  | 'zai'
  | 'qwen'
  | 'chat-template'
  | 'qwen-chat-template'
  | 'string-thinking'
  | 'ant-ling';

export type ChatTemplateKwargValue =
  | JsonPrimitive
  | Readonly<{
      $var: 'thinking.enabled' | 'thinking.effort';
      omitWhenOff?: boolean;
    }>;

export interface OpenRouterRoutingProfile {
  readonly allow_fallbacks?: boolean;
  readonly require_parameters?: boolean;
  readonly data_collection?: 'deny' | 'allow';
  readonly zdr?: boolean;
  readonly enforce_distillable_text?: boolean;
  readonly order?: readonly string[];
  readonly only?: readonly string[];
  readonly ignore?: readonly string[];
  readonly quantizations?: readonly string[];
  readonly sort?: string | Readonly<{ by?: string; partition?: string | null }>;
  readonly max_price?: Readonly<{
    prompt?: number | string;
    completion?: number | string;
    image?: number | string;
    audio?: number | string;
    request?: number | string;
  }>;
  readonly preferred_min_throughput?:
    number | Readonly<Partial<Record<'p50' | 'p75' | 'p90' | 'p99', number>>>;
  readonly preferred_max_latency?:
    number | Readonly<Partial<Record<'p50' | 'p75' | 'p90' | 'p99', number>>>;
}

export interface VercelGatewayRoutingProfile {
  readonly only?: readonly string[];
  readonly order?: readonly string[];
}

export interface OpenAiChatCompatibility {
  readonly supportsStore?: boolean;
  readonly supportsDeveloperRole?: boolean;
  readonly supportsReasoningEffort?: boolean;
  readonly supportsUsageInStreaming?: boolean;
  readonly maxTokensField?: 'max_completion_tokens' | 'max_tokens';
  readonly requiresToolResultName?: boolean;
  readonly requiresAssistantAfterToolResult?: boolean;
  readonly requiresThinkingAsText?: boolean;
  readonly requiresReasoningContentOnAssistantMessages?: boolean;
  readonly thinkingFormat?: OpenAiChatThinkingFormat;
  readonly chatTemplateKwargs?: Readonly<
    Record<string, ChatTemplateKwargValue>
  >;
  readonly openRouterRouting?: Readonly<OpenRouterRoutingProfile>;
  readonly vercelGatewayRouting?: Readonly<VercelGatewayRoutingProfile>;
  readonly zaiToolStream?: boolean;
  readonly supportsStrictMode?: boolean;
  readonly cacheControlFormat?: 'anthropic';
  readonly sendSessionAffinityHeaders?: boolean;
  readonly deferredToolsMode?: 'kimi';
  readonly sessionAffinityFormat?: SessionAffinityFormat;
  readonly supportsLongCacheRetention?: boolean;
}

export interface OpenAiChatCompletionsAdapterOptions {
  readonly compatibility?: OpenAiChatCompatibility;
}

interface ChatChunk {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly choices?: unknown;
  readonly usage?: unknown;
  readonly error?: unknown;
}

interface ToolState {
  itemId: string;
  toolCallId: string;
  name: string;
  arguments: string;
  contentIndex: number;
}

export const openAiChatCompletionsContract = Object.freeze({
  protocol: 'openai-chat-completions' as const,
  route: 'chat/completions' as const,
  streaming: true,
  terminalOwner: 'runtime' as const,
});

export const openAiChatCompletionsReplayCodecs = Object.freeze([
  Object.freeze({ id: 'openai-chat-reasoning', version: 1 }),
]);

export function createOpenAiChatCompletionsAdapter(
  options: OpenAiChatCompletionsAdapterOptions = {},
) {
  const compatibility = Object.freeze({ ...options.compatibility });
  return (
    request: ChatRequest<'openai-chat-completions'>,
    sink: ProtocolEventSink,
  ) => runWithCompatibility(request, sink, compatibility);
}

export function runOpenAiChatCompletions(
  request: ChatRequest<'openai-chat-completions'>,
  sink: ProtocolEventSink,
): Promise<ProtocolTerminal> {
  return runWithCompatibility(request, sink, {});
}

async function runWithCompatibility(
  request: ChatRequest<'openai-chat-completions'>,
  sink: ProtocolEventSink,
  compatibility: OpenAiChatCompatibility,
): Promise<ProtocolTerminal> {
  if (!request.transport)
    return failed(
      'TRANSPORT_UNAVAILABLE',
      'invalid_request',
      'OpenAI Chat Completions requires a bound request transport',
    );

  let response;
  try {
    response = await request.transport.send({
      method: 'POST',
      headers: sessionHeaders(request, compatibility),
      body: JSON.stringify(makeRequestBody(request, compatibility)),
      responseMode: 'stream',
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted || isAbort(error))
      return failed(
        'OPENAI_CHAT_CANCELLED',
        'cancelled',
        'OpenAI Chat request was cancelled',
      );
    return failed(
      'OPENAI_CHAT_NETWORK',
      'network',
      'OpenAI Chat request failed before a response was received',
      true,
    );
  }

  if (response.status < 200 || response.status >= 300)
    return httpFailure(response.status);

  let responseId: string | undefined;
  let responseModelId: string | undefined;
  let usage: Usage | undefined;
  let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' =
    'stop';
  let completed = false;
  let textStarted = false;
  let reasoningStarted = false;
  let reasoningReplay: ReplayMetadata | undefined;
  const tools = new Map<number, ToolState>();

  try {
    for await (const frame of parseServerSentEvents(response.body)) {
      if (frame.data === '[DONE]') continue;
      let chunk: ChatChunk;
      try {
        chunk = JSON.parse(frame.data) as ChatChunk;
      } catch {
        throw invalidChunk('stream data is not valid JSON');
      }
      if (chunk.error) throw providerChunkError();
      responseId = string(chunk.id) ?? responseId;
      responseModelId = string(chunk.model) ?? responseModelId;
      usage = mergeUsage(usage, mapUsage(chunk.usage));
      const choices = array(chunk.choices);
      for (const rawChoice of choices) {
        const choice = object(rawChoice);
        const delta = object(choice.delta);
        const choiceIndex = number(choice.index) ?? 0;
        const reasoning = extractReasoning(delta);
        if (reasoning.text !== undefined) {
          if (!reasoningStarted) {
            reasoningStarted = true;
            await sink.publish({
              type: 'reasoning_start',
              itemId: `reasoning-${choiceIndex}`,
              contentIndex: choiceIndex,
            });
          }
          if (reasoning.text)
            await sink.publish({
              type: 'reasoning_delta',
              itemId: `reasoning-${choiceIndex}`,
              contentIndex: choiceIndex,
              delta: reasoning.text,
            });
          if (reasoning.replayData)
            reasoningReplay = makeReasoningReplay(
              request,
              compatibility.thinkingFormat ?? 'openai',
              reasoning.replayData,
            );
        }
        const content = string(delta.content);
        if (content !== undefined) {
          if (!textStarted) {
            textStarted = true;
            await sink.publish({
              type: 'text_start',
              itemId: `text-${choiceIndex}`,
              contentIndex: choiceIndex,
            });
          }
          if (content)
            await sink.publish({
              type: 'text_delta',
              itemId: `text-${choiceIndex}`,
              contentIndex: choiceIndex,
              delta: content,
            });
        }
        for (const rawTool of array(delta.tool_calls)) {
          const tool = object(rawTool);
          const index = number(tool.index) ?? tools.size;
          const fn = object(tool.function);
          let state = tools.get(index);
          const id = string(tool.id);
          const name = string(fn.name);
          if (!state) {
            state = {
              itemId: id ?? `tool-${choiceIndex}-${index}`,
              toolCallId: id ?? `tool-${choiceIndex}-${index}`,
              name: name ?? '',
              arguments: '',
              contentIndex: index,
            };
            tools.set(index, state);
            await sink.publish({
              type: 'tool_call_start',
              itemId: state.itemId,
              contentIndex: state.contentIndex,
              toolCallId: state.toolCallId,
              ...(state.name ? { name: state.name } : {}),
            });
          }
          const nameDelta = state.name ? undefined : name;
          if (nameDelta) state.name += nameDelta;
          const argumentsDelta = string(fn.arguments) ?? '';
          state.arguments += argumentsDelta;
          if (argumentsDelta || nameDelta)
            await sink.publish({
              type: 'tool_call_delta',
              itemId: state.itemId,
              contentIndex: state.contentIndex,
              argumentsDelta,
              ...(nameDelta ? { nameDelta } : {}),
            });
        }
        const finish = string(choice.finish_reason);
        if (finish) {
          finishReason = mapFinishReason(finish);
          completed = true;
        }
      }
    }

    if (!completed) throw invalidChunk('stream ended without a finish reason');
    if (reasoningStarted)
      await sink.publish({
        type: 'reasoning_end',
        itemId: 'reasoning-0',
        contentIndex: 0,
        ...(reasoningReplay ? { replay: reasoningReplay } : {}),
      });
    if (textStarted)
      await sink.publish({
        type: 'text_end',
        itemId: 'text-0',
        contentIndex: 0,
      });
    for (const state of tools.values()) {
      const parsed = parseToolArguments(state.arguments || '{}');
      await sink.publish({
        type: 'tool_call_end',
        itemId: state.itemId,
        contentIndex: state.contentIndex,
        toolCall: {
          type: 'tool_call',
          id: state.toolCallId,
          name: state.name,
          status: parsed.ok ? 'complete' : 'incomplete',
          rawArguments: state.arguments,
          ...(parsed.ok ? { arguments: parsed.value } : {}),
        },
      });
    }
    return {
      status: 'completed',
      finishReason,
      ...(responseId ? { responseId } : {}),
      ...(responseModelId ? { responseModelId } : {}),
      ...(usage ? { usage, cost: calculateCost(request.model, usage) } : {}),
      replay: {
        version: 1,
        scope: 'same-model',
        source: {
          providerInstanceId: request.model.providerInstanceId,
          modelId: request.model.id,
          protocol: request.model.protocol,
        },
        protocolId: 'openai-chat-completions',
        codecId: 'openai-chat-reasoning',
        codecVersion: 1,
        data: {
          kind: 'reasoning',
          format: compatibility.thinkingFormat ?? 'openai',
        },
      },
    };
  } catch (error) {
    if (request.signal.aborted || isAbort(error))
      return failed(
        'OPENAI_CHAT_CANCELLED',
        'cancelled',
        'OpenAI Chat request was cancelled',
      );
    const aiError =
      error instanceof AiRuntimeError
        ? error
        : new AiRuntimeError(
            'OPENAI_CHAT_INVALID_STREAM',
            'invalid_response',
            'OpenAI Chat stream was invalid',
          );
    return { status: 'failed', error: aiError };
  }
}

function makeRequestBody(
  request: ChatRequest<'openai-chat-completions'>,
  compatibility: OpenAiChatCompatibility,
): Record<string, unknown> {
  const options = object(request.options.protocolOptions);
  const maxTokensField = compatibility.maxTokensField ?? 'max_tokens';
  const cacheControl = resolveCacheControl(
    request.options.cacheRetention,
    options,
    compatibility,
  );
  const body: Record<string, unknown> = {
    model: request.model.upstreamModelId,
    messages: mapMessages(
      request.context.messages,
      request.context.systemPrompt,
      compatibility,
      cacheControl,
    ),
    ...(request.context.tools?.length
      ? {
          tools: request.context.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              ...(tool.description ? { description: tool.description } : {}),
              parameters: tool.inputSchema,
              ...(compatibility.supportsStrictMode && boolean(options.strict)
                ? { strict: true }
                : {}),
            },
            ...(cacheControl ? { cache_control: cacheControl } : {}),
          })),
        }
      : {}),
    [maxTokensField]: request.options.maxOutputTokens,
    ...(request.options.temperature === undefined
      ? {}
      : { temperature: request.options.temperature }),
    ...(request.options.topP === undefined
      ? {}
      : { top_p: request.options.topP }),
    ...(request.options.stop.length === 0
      ? {}
      : { stop: request.options.stop }),
    ...mapToolChoice(request.options.toolChoice),
    stream: true,
    ...(compatibility.supportsUsageInStreaming === false
      ? {}
      : { stream_options: { include_usage: true } }),
  };
  if (compatibility.supportsStore && boolean(options.store) !== undefined)
    body.store = boolean(options.store);
  applyThinking(body, request.options.reasoning, options, compatibility);
  if (compatibility.openRouterRouting)
    body.provider = compatibility.openRouterRouting;
  if (compatibility.vercelGatewayRouting)
    body.provider = compatibility.vercelGatewayRouting;
  return body;
}

function mapMessages(
  messages: readonly Message[],
  systemPrompt: string | undefined,
  compatibility: OpenAiChatCompatibility,
  cacheControl?: Readonly<Record<string, string>>,
): readonly Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  if (systemPrompt)
    output.push({
      role: compatibility.supportsDeveloperRole ? 'developer' : 'system',
      content: cacheControl
        ? [{ type: 'text', text: systemPrompt, cache_control: cacheControl }]
        : systemPrompt,
    });
  for (const message of messages) {
    if (message.role === 'tool_result') {
      output.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        ...(compatibility.requiresToolResultName
          ? { name: message.toolName }
          : {}),
        content: mapToolResultContent(message.content),
      });
      if (compatibility.requiresAssistantAfterToolResult)
        output.push({ role: 'assistant', content: '' });
      continue;
    }
    const content = mapContent(message.content);
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
        content: Array.isArray(content) && content.length === 0 ? '' : content,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        ...(reasoning &&
        compatibility.requiresReasoningContentOnAssistantMessages
          ? { reasoning_content: reasoning }
          : {}),
      });
    } else output.push({ role: 'user', content });
  }
  return output;
}

function mapContent(
  content: Extract<Message, { role: 'user' | 'assistant' }>['content'],
): string | readonly Record<string, unknown>[] {
  const mapped: Record<string, unknown>[] = [];
  for (const part of content) {
    if (part.type === 'text') mapped.push({ type: 'text', text: part.text });
    else if (part.type === 'image')
      mapped.push({
        type: 'image_url',
        image_url: {
          url:
            part.source.type === 'url'
              ? part.source.url
              : `data:${part.mediaType};base64,${part.source.data}`,
        },
      });
  }
  return mapped.length === 1 && mapped[0]?.type === 'text'
    ? String(mapped[0].text)
    : mapped;
}

function mapToolResultContent(
  content: Extract<Message, { role: 'tool_result' }>['content'],
): string | readonly Record<string, unknown>[] {
  return mapContent(content as Extract<Message, { role: 'user' }>['content']);
}

function resolveCacheControl(
  commonRetention: import('../../core/models.js').CacheRetention | undefined,
  options: Record<string, unknown>,
  compatibility: OpenAiChatCompatibility,
): Readonly<Record<string, string>> | undefined {
  if (compatibility.cacheControlFormat !== 'anthropic') return undefined;
  const retention =
    string(options.cacheRetention) ??
    (commonRetention === 'short'
      ? 'standard'
      : commonRetention === 'long'
        ? 'one_hour'
        : undefined);
  if (retention !== 'standard' && retention !== 'one_hour') return undefined;
  return retention === 'one_hour' && compatibility.supportsLongCacheRetention
    ? { type: 'ephemeral', ttl: '1h' }
    : { type: 'ephemeral' };
}

function applyThinking(
  body: Record<string, unknown>,
  commonReasoning: import('../../core/models.js').ReasoningLevel | undefined,
  options: Record<string, unknown>,
  compatibility: OpenAiChatCompatibility,
): void {
  const enabled =
    commonReasoning === undefined
      ? (boolean(options.thinkingEnabled) ?? false)
      : commonReasoning !== 'none';
  const effort =
    commonReasoning === undefined || commonReasoning === 'none'
      ? (string(options.reasoningEffort) ?? 'medium')
      : commonReasoning;
  const format = compatibility.thinkingFormat;
  if (!format) return;
  switch (format) {
    case 'openai':
      body.reasoning_effort = enabled ? effort : 'none';
      break;
    case 'openrouter':
    case 'together':
      body.reasoning = { enabled, effort };
      break;
    case 'deepseek':
    case 'zai':
    case 'ant-ling':
      body.thinking = { type: enabled ? 'enabled' : 'disabled' };
      break;
    case 'qwen':
      body.enable_thinking = enabled;
      break;
    case 'chat-template':
    case 'qwen-chat-template':
      body.chat_template_kwargs = resolveChatTemplateKwargs(
        compatibility.chatTemplateKwargs,
        enabled,
        effort,
      );
      break;
    case 'string-thinking':
      body.thinking = enabled ? 'enabled' : 'disabled';
      break;
  }
}

function mapToolChoice(
  value: import('../../core/models.js').ToolChoice | undefined,
): Record<string, unknown> {
  if (value === undefined || value === 'auto') return {};
  if (value === 'none' || value === 'required') return { tool_choice: value };
  return {
    tool_choice: {
      type: 'function',
      function: { name: value.name },
    },
  };
}

function resolveChatTemplateKwargs(
  input: Readonly<Record<string, ChatTemplateKwargValue>> | undefined,
  enabled: boolean,
  effort: string,
): Readonly<Record<string, JsonPrimitive>> {
  const output: Record<string, JsonPrimitive> = {};
  const source = input ?? { enable_thinking: { $var: 'thinking.enabled' } };
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'object' || value === null) output[key] = value;
    else if (value.$var === 'thinking.enabled') {
      if (enabled || !value.omitWhenOff) output[key] = enabled;
    } else if (enabled || !value.omitWhenOff) output[key] = effort;
  }
  return output;
}

function sessionHeaders(
  request: ChatRequest<'openai-chat-completions'>,
  compatibility: OpenAiChatCompatibility,
): Readonly<Record<string, string>> | undefined {
  if (!compatibility.sendSessionAffinityHeaders || !request.options.sessionId)
    return undefined;
  switch (compatibility.sessionAffinityFormat ?? 'openai') {
    case 'openrouter':
      return { 'x-openrouter-session': request.options.sessionId };
    case 'openai-nosession':
      return { 'x-session-affinity': request.options.sessionId };
    case 'openai':
      return { 'x-session-id': request.options.sessionId };
  }
}

function extractReasoning(delta: Record<string, unknown>): {
  text?: string;
  replayData?: JsonValue;
} {
  for (const field of [
    'reasoning_content',
    'reasoning',
    'reasoning_text',
    'thinking',
  ]) {
    const value = string(delta[field]);
    if (value !== undefined) return { text: value };
  }
  const details = array(delta.reasoning_details);
  if (details.length) {
    const texts: string[] = [];
    for (const raw of details) {
      const detail = object(raw);
      const text = string(detail.text) ?? string(detail.summary);
      if (text) texts.push(text);
    }
    return {
      text: texts.join(''),
      replayData: details as JsonValue,
    };
  }
  return {};
}

function makeReasoningReplay(
  request: ChatRequest<'openai-chat-completions'>,
  format: OpenAiChatThinkingFormat,
  data: JsonValue,
): ReplayMetadata {
  return {
    version: 1,
    scope: 'same-model',
    source: {
      providerInstanceId: request.model.providerInstanceId,
      modelId: request.model.id,
      protocol: request.model.protocol,
    },
    protocolId: 'openai-chat-completions',
    codecId: 'openai-chat-reasoning',
    codecVersion: 1,
    data: { kind: 'reasoning', format, encryptedData: JSON.stringify(data) },
  };
}

function mapUsage(value: unknown): Usage | undefined {
  const usage = object(value);
  if (!Object.keys(usage).length) return undefined;
  const promptDetails = object(usage.prompt_tokens_details);
  const completionDetails = object(usage.completion_tokens_details);
  const inputTokens = number(usage.prompt_tokens);
  const outputTokens = number(usage.completion_tokens);
  const totalTokens = number(usage.total_tokens);
  const reasoningTokens = number(completionDetails.reasoning_tokens);
  const cacheReadTokens =
    number(promptDetails.cached_tokens) ??
    number(usage.cache_read_input_tokens);
  const cacheWriteTokens = number(usage.cache_creation_input_tokens);
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  };
}

function mergeUsage(
  current: Usage | undefined,
  next: Usage | undefined,
): Usage | undefined {
  return next ? { ...current, ...next } : current;
}

function mapFinishReason(
  value: string,
): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
  if (value === 'length') return 'length';
  if (value === 'tool_calls' || value === 'function_call') return 'tool_calls';
  if (value === 'content_filter') return 'content_filter';
  return 'stop';
}

function httpFailure(status: number): ProtocolTerminal {
  const category =
    status === 401 || status === 403
      ? 'auth'
      : status === 429
        ? 'rate_limit'
        : 'provider';
  return failed(
    `OPENAI_CHAT_HTTP_${status}`,
    category,
    `OpenAI Chat request failed with HTTP ${status}`,
    status === 429 || status >= 500,
  );
}

function providerChunkError(): AiRuntimeError {
  return new AiRuntimeError(
    'OPENAI_CHAT_STREAM_ERROR',
    'provider',
    'OpenAI Chat provider returned a stream error',
  );
}

function invalidChunk(reason: string): AiRuntimeError {
  return new AiRuntimeError(
    'OPENAI_CHAT_INVALID_STREAM',
    'invalid_response',
    `OpenAI Chat stream is invalid: ${reason}`,
  );
}

function failed(
  code: string,
  category: AiError['category'],
  message: string,
  retryable = false,
): ProtocolTerminal {
  const error = new AiRuntimeError(code, category, message, retryable);
  return category === 'cancelled'
    ? {
        status: 'cancelled',
        error: error as AiError & { category: 'cancelled' },
      }
    : { status: 'failed', error };
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
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

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
