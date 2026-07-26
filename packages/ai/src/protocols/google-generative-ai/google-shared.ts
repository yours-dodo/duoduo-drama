import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type { Message } from '../../core/messages.js';
import type { ModelDefinition } from '../../core/models.js';
import { parseToolArguments } from '../../core/tools.js';
import { calculateCost, type Usage } from '../../core/usage.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';
import { parseServerSentEvents } from '../../transport/sse.js';

export type GoogleProtocolId = 'google-generative-ai' | 'google-vertex';

interface GoogleAdapterOptions<TProtocol extends GoogleProtocolId> {
  readonly protocolId: TProtocol;
}

interface GooglePart {
  readonly text?: unknown;
  readonly thought?: unknown;
  readonly thoughtSignature?: unknown;
  readonly functionCall?: unknown;
}

interface ActiveTextBlock {
  readonly kind: 'text' | 'reasoning';
  readonly itemId: string;
  readonly contentIndex: number;
  signature?: string;
}

export function createGoogleStreamingAdapter<
  TProtocol extends GoogleProtocolId,
>(options: GoogleAdapterOptions<TProtocol>) {
  return (
    request: ChatRequest<TProtocol>,
    sink: ProtocolEventSink,
  ): Promise<ProtocolTerminal> =>
    runGoogleStreaming(request, sink, options.protocolId);
}

async function runGoogleStreaming<TProtocol extends GoogleProtocolId>(
  request: ChatRequest<TProtocol>,
  sink: ProtocolEventSink,
  protocolId: TProtocol,
): Promise<ProtocolTerminal> {
  if (!request.transport)
    return failed(
      'TRANSPORT_UNAVAILABLE',
      'invalid_request',
      'Google streaming requires a bound request transport',
    );
  let response;
  try {
    response = await request.transport.send({
      method: 'POST',
      body: JSON.stringify(makeGoogleRequestBody(request, protocolId)),
      responseMode: 'stream',
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) return cancelled();
    throw error;
  }
  if (response.status < 200 || response.status >= 300)
    return googleHttpFailure(response.status);

  let responseId: string | undefined;
  let responseModelId: string | undefined;
  let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' =
    'stop';
  let completed = false;
  let sawToolCall = false;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let reasoningTokens: number | undefined;
  let cacheReadTokens: number | undefined;
  let totalTokens: number | undefined;
  let active: ActiveTextBlock | undefined;
  let nextContentIndex = 0;
  let nextItemId = 0;
  let nextToolId = 0;

  const closeActive = async () => {
    if (!active) return;
    await sink.publish({
      type: active.kind === 'text' ? 'text_end' : 'reasoning_end',
      itemId: active.itemId,
      contentIndex: active.contentIndex,
      ...(active.signature
        ? {
            replay: thoughtSignatureReplay(
              request.model,
              protocolId,
              active.signature,
            ),
          }
        : {}),
    });
    active = undefined;
  };

  try {
    for await (const frame of parseServerSentEvents(response.body)) {
      if (frame.data === '[DONE]') continue;
      let chunk: Record<string, unknown>;
      try {
        chunk = object(JSON.parse(frame.data));
      } catch {
        throw invalidGoogleEvent('invalid JSON');
      }
      if (chunk.error)
        return { status: 'failed', error: googleApiError(chunk) };
      responseId = string(chunk.responseId) ?? responseId;
      responseModelId = string(chunk.modelVersion) ?? responseModelId;
      const candidates = array(chunk.candidates);
      const candidate = object(candidates[0]);
      const content = object(candidate.content);
      for (const rawPart of array(content.parts)) {
        const part = object(rawPart) as GooglePart;
        const functionCall = objectOrUndefined(part.functionCall);
        if (functionCall) {
          await closeActive();
          const name = string(functionCall.name);
          if (!name) throw invalidGoogleEvent('function call name is missing');
          const rawArguments = JSON.stringify(
            objectOrUndefined(functionCall.args) ?? {},
          );
          const toolCallId =
            string(functionCall.id) ?? `google-tool-${++nextToolId}`;
          const itemId = `google-item-${++nextItemId}`;
          const contentIndex = nextContentIndex++;
          await sink.publish({
            type: 'tool_call_start',
            itemId,
            contentIndex,
            toolCallId,
            name,
          });
          await sink.publish({
            type: 'tool_call_delta',
            itemId,
            contentIndex,
            argumentsDelta: rawArguments,
          });
          const parsed = parseToolArguments(rawArguments);
          const signature = string(part.thoughtSignature);
          await sink.publish({
            type: 'tool_call_end',
            itemId,
            contentIndex,
            toolCall: {
              type: 'tool_call',
              id: toolCallId,
              name,
              status: parsed.ok ? 'complete' : 'incomplete',
              rawArguments,
              ...(parsed.ok ? { arguments: parsed.value } : {}),
              ...(signature
                ? {
                    replay: thoughtSignatureReplay(
                      request.model,
                      protocolId,
                      signature,
                    ),
                  }
                : {}),
            },
          });
          sawToolCall = true;
          continue;
        }
        const text = string(part.text);
        if (text === undefined) continue;
        const kind = part.thought === true ? 'reasoning' : 'text';
        if (!active || active.kind !== kind) {
          await closeActive();
          active = {
            kind,
            itemId: `google-item-${++nextItemId}`,
            contentIndex: nextContentIndex++,
          };
          await sink.publish({
            type: kind === 'text' ? 'text_start' : 'reasoning_start',
            itemId: active.itemId,
            contentIndex: active.contentIndex,
          });
        }
        const signature = string(part.thoughtSignature);
        if (signature) active.signature = signature;
        if (text)
          await sink.publish({
            type: kind === 'text' ? 'text_delta' : 'reasoning_delta',
            itemId: active.itemId,
            contentIndex: active.contentIndex,
            delta: text,
          });
      }
      const usage = object(chunk.usageMetadata);
      const prompt = number(usage.promptTokenCount);
      cacheReadTokens =
        number(usage.cachedContentTokenCount) ?? cacheReadTokens;
      inputTokens =
        prompt === undefined
          ? inputTokens
          : Math.max(0, prompt - (cacheReadTokens ?? 0));
      reasoningTokens = number(usage.thoughtsTokenCount) ?? reasoningTokens;
      const candidatesTokens = number(usage.candidatesTokenCount);
      outputTokens =
        candidatesTokens === undefined
          ? outputTokens
          : candidatesTokens + (reasoningTokens ?? 0);
      totalTokens = number(usage.totalTokenCount) ?? totalTokens;
      const upstreamFinish = string(candidate.finishReason);
      if (upstreamFinish) {
        finishReason = mapGoogleFinishReason(upstreamFinish, sawToolCall);
        completed = true;
      }
    }
    await closeActive();
  } catch (error) {
    if (request.signal.aborted) return cancelled();
    if (error instanceof AiRuntimeError) return { status: 'failed', error };
    throw error;
  }

  if (!completed)
    return failed(
      'GOOGLE_STREAM_INCOMPLETE',
      'invalid_response',
      'Google stream ended without a finish reason',
    );
  const usage = makeUsage({
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    totalTokens,
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

export function makeGoogleRequestBody<TProtocol extends GoogleProtocolId>(
  request: ChatRequest<TProtocol>,
  protocolId: TProtocol,
): Record<string, unknown> {
  const protocolOptions = object(request.options.protocolOptions);
  const thinkingBudget = number(protocolOptions.thinkingBudget);
  const thinkingLevel =
    request.options.reasoning === undefined ||
    request.options.reasoning === 'none'
      ? string(protocolOptions.thinkingLevel)
      : request.options.reasoning;
  const temperature =
    request.options.temperature ?? number(protocolOptions.temperature);
  const topP = request.options.topP ?? number(protocolOptions.topP);
  const toolChoice = request.options.toolChoice ?? protocolOptions.toolChoice;
  const thinkingConfig =
    thinkingBudget !== undefined || thinkingLevel !== undefined
      ? {
          includeThoughts: true,
          ...(thinkingBudget === undefined ? {} : { thinkingBudget }),
          ...(thinkingLevel === undefined
            ? {}
            : { thinkingLevel: thinkingLevel.toUpperCase() }),
        }
      : undefined;
  return {
    ...(request.context.systemPrompt
      ? {
          systemInstruction: {
            parts: [{ text: request.context.systemPrompt }],
          },
        }
      : {}),
    contents: request.context.messages.map((message) =>
      mapGoogleMessage(message, request.model, protocolId),
    ),
    ...(request.context.tools?.length
      ? {
          tools: [
            {
              functionDeclarations: request.context.tools.map((tool) => ({
                name: tool.name,
                ...(tool.description ? { description: tool.description } : {}),
                parameters: tool.inputSchema,
              })),
            },
          ],
          ...(toolChoice === undefined || toolChoice === 'auto'
            ? {}
            : {
                toolConfig: {
                  functionCallingConfig: mapToolChoice(toolChoice),
                },
              }),
        }
      : {}),
    generationConfig: {
      maxOutputTokens: request.options.maxOutputTokens,
      ...(request.options.stop.length
        ? { stopSequences: request.options.stop }
        : {}),
      ...(temperature === undefined ? {} : { temperature }),
      ...(topP === undefined ? {} : { topP }),
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
  };
}

function mapGoogleMessage<TProtocol extends GoogleProtocolId>(
  message: Message,
  model: Readonly<ModelDefinition<TProtocol>>,
  protocolId: TProtocol,
): Record<string, unknown> {
  if (message.role === 'user')
    return {
      role: 'user',
      parts: message.content.map((content) =>
        content.type === 'text'
          ? { text: content.text }
          : content.source.type === 'base64'
            ? {
                inlineData: {
                  mimeType: content.mediaType,
                  data: content.source.data,
                },
              }
            : {
                fileData: {
                  mimeType: content.mediaType,
                  fileUri: content.source.url,
                },
              },
      ),
    };
  if (message.role === 'tool_result')
    return {
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: message.toolCallId,
            name: message.toolName,
            response: {
              output: message.content
                .filter((item) => item.type === 'text')
                .map((item) => item.text)
                .join(''),
              isError: message.isError,
            },
          },
        },
      ],
    };
  return {
    role: 'model',
    parts: message.content.map((content) => {
      const signature = readThoughtSignature(content.replay, model, protocolId);
      if (content.type === 'text')
        return {
          text: content.text,
          ...(signature ? { thoughtSignature: signature } : {}),
        };
      if (content.type === 'reasoning')
        return {
          text: content.text ?? '',
          thought: true,
          ...(signature ? { thoughtSignature: signature } : {}),
        };
      return {
        functionCall: {
          id: content.id,
          name: content.name,
          args: content.arguments ?? parseJsonObject(content.rawArguments),
        },
        ...(signature ? { thoughtSignature: signature } : {}),
      };
    }),
  };
}

function readThoughtSignature<TProtocol extends GoogleProtocolId>(
  replay: import('../../core/content.js').ReplayMetadata | undefined,
  model: Readonly<ModelDefinition<TProtocol>>,
  protocolId: TProtocol,
): string | undefined {
  if (
    replay?.protocolId !== protocolId ||
    replay.codecId !== 'google-thought-signature' ||
    replay.codecVersion !== 1 ||
    replay.source?.providerInstanceId !== model.providerInstanceId ||
    replay.source.modelId !== model.id
  )
    return undefined;
  return string(object(replay.data).thoughtSignature);
}

function thoughtSignatureReplay<TProtocol extends GoogleProtocolId>(
  model: Readonly<ModelDefinition<TProtocol>>,
  protocolId: TProtocol,
  thoughtSignature: string,
) {
  return {
    version: 1,
    scope: 'same-model',
    source: {
      providerInstanceId: model.providerInstanceId,
      modelId: model.id,
      protocol: model.protocol,
    },
    protocolId,
    codecId: 'google-thought-signature',
    codecVersion: 1,
    data: { thoughtSignature },
  } as const;
}

function mapToolChoice(value: unknown): Record<string, unknown> {
  if (value === 'none') return { mode: 'NONE' };
  if (value === 'required') return { mode: 'ANY' };
  const selected = objectOrUndefined(value);
  const name = string(selected?.name);
  return name
    ? { mode: 'ANY', allowedFunctionNames: [name] }
    : { mode: 'AUTO' };
}

function mapGoogleFinishReason(
  value: string,
  sawToolCall: boolean,
): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
  if (sawToolCall) return 'tool_calls';
  if (value === 'MAX_TOKENS') return 'length';
  if (
    [
      'SAFETY',
      'RECITATION',
      'BLOCKLIST',
      'PROHIBITED_CONTENT',
      'SPII',
    ].includes(value)
  )
    return 'content_filter';
  return 'stop';
}

function makeUsage(input: Usage): Usage | undefined {
  return Object.values(input).some((value) => value !== undefined)
    ? Object.freeze(input)
    : undefined;
}

function googleHttpFailure(
  status: number,
): Extract<ProtocolTerminal, { status: 'failed' }> {
  if (status === 401 || status === 403)
    return failed('GOOGLE_AUTH_FAILED', 'auth', 'Google authentication failed');
  if (status === 429)
    return failed(
      'GOOGLE_RATE_LIMITED',
      'rate_limit',
      'Google request was rate limited',
      true,
    );
  if (status >= 500)
    return failed(
      'GOOGLE_SERVER_ERROR',
      'provider',
      'Google service failed',
      true,
    );
  return failed(
    'GOOGLE_REQUEST_FAILED',
    'invalid_request',
    'Google request failed',
  );
}

function googleApiError(value: Record<string, unknown>): AiError {
  const error = object(value.error);
  const code = number(error.code);
  const message = string(error.message) ?? 'Google stream returned an error';
  const terminal = googleHttpFailure(code ?? 500);
  return new AiRuntimeError(
    terminal.error.code,
    terminal.error.category,
    message,
    terminal.error.retryable,
  );
}

function failed(
  code: string,
  category: AiError['category'],
  message: string,
  retryable = false,
): Extract<ProtocolTerminal, { status: 'failed' }> {
  return {
    status: 'failed',
    error: new AiRuntimeError(code, category, message, retryable),
  };
}

function cancelled(): Extract<ProtocolTerminal, { status: 'cancelled' }> {
  return {
    status: 'cancelled',
    error: new AiRuntimeError(
      'REQUEST_CANCELLED',
      'cancelled',
      'request cancelled',
    ) as AiError & { category: 'cancelled' },
  };
}

function invalidGoogleEvent(detail: string): AiRuntimeError {
  return new AiRuntimeError(
    'GOOGLE_EVENT_INVALID',
    'invalid_response',
    `invalid Google stream event: ${detail}`,
  );
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    return object(JSON.parse(value));
  } catch {
    return {};
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function objectOrUndefined(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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
