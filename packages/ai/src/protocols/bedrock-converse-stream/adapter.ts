import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type { Message } from '../../core/messages.js';
import type { ModelDefinition } from '../../core/models.js';
import { parseToolArguments } from '../../core/tools.js';
import { calculateCost, type Usage } from '../../core/usage.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';
import { parseBedrockEventStream } from './eventstream.js';

interface BlockState {
  readonly kind: 'text' | 'reasoning' | 'tool';
  readonly itemId: string;
  readonly contentIndex: number;
  readonly toolCallId?: string;
  readonly name?: string;
  arguments: string;
  signature: string;
}

export const bedrockConverseStreamContract = Object.freeze({
  protocol: 'bedrock-converse-stream' as const,
  streaming: true,
  terminalOwner: 'runtime' as const,
});

export const bedrockConverseStreamReplayCodecs = Object.freeze([
  Object.freeze({ id: 'bedrock-reasoning-signature', version: 1 }),
]);

export async function runBedrockConverseStream(
  request: ChatRequest<'bedrock-converse-stream'>,
  sink: ProtocolEventSink,
): Promise<ProtocolTerminal> {
  if (!request.transport)
    return failed(
      'TRANSPORT_UNAVAILABLE',
      'invalid_request',
      'Bedrock Converse Stream requires a bound request transport',
    );
  const response = await request.transport.send({
    method: 'POST',
    body: JSON.stringify(makeBedrockRequestBody(request)),
    responseMode: 'stream',
    signal: request.signal,
  });
  if (response.status < 200 || response.status >= 300)
    return bedrockHttpFailure(response.status);

  const blocks = new Map<number, BlockState>();
  let nextContentIndex = 0;
  let completed = false;
  let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' =
    'stop';
  let usage: Usage | undefined;
  let latencyMs: number | undefined;

  try {
    for await (const event of parseBedrockEventStream(response.body)) {
      const index = number(event.contentBlockIndex);
      switch (event.type) {
        case 'messageStart':
          if (string(event.role) !== 'assistant')
            throw invalidEvent('messageStart role must be assistant');
          break;
        case 'contentBlockStart': {
          if (index === undefined) throw invalidEvent('missing content index');
          const toolUse = object(object(event.start).toolUse);
          const toolCallId = string(toolUse.toolUseId);
          const name = string(toolUse.name);
          if (!toolCallId || !name)
            throw invalidEvent('tool use start is incomplete');
          const block: BlockState = {
            kind: 'tool',
            itemId: `bedrock-${index}`,
            contentIndex: nextContentIndex++,
            toolCallId,
            name,
            arguments: '',
            signature: '',
          };
          blocks.set(index, block);
          await sink.publish({
            type: 'tool_call_start',
            itemId: block.itemId,
            contentIndex: block.contentIndex,
            toolCallId,
            name,
          });
          break;
        }
        case 'contentBlockDelta': {
          if (index === undefined) throw invalidEvent('missing content index');
          const delta = object(event.delta);
          const text = string(delta.text);
          const reasoning = objectOrUndefined(delta.reasoningContent);
          const toolUse = objectOrUndefined(delta.toolUse);
          if (text !== undefined) {
            const result = await ensureTextBlock(
              blocks,
              index,
              'text',
              nextContentIndex,
              sink,
            );
            const block = result.block;
            if (result.created) nextContentIndex += 1;
            if (text)
              await sink.publish({
                type: 'text_delta',
                itemId: block.itemId,
                contentIndex: block.contentIndex,
                delta: text,
              });
          } else if (reasoning) {
            const result = await ensureTextBlock(
              blocks,
              index,
              'reasoning',
              nextContentIndex,
              sink,
            );
            const block = result.block;
            if (result.created) nextContentIndex += 1;
            const reasoningText =
              string(reasoning.text) ??
              string(object(reasoning.reasoningText).text);
            const signature =
              string(reasoning.signature) ??
              string(object(reasoning.reasoningText).signature);
            if (reasoningText)
              await sink.publish({
                type: 'reasoning_delta',
                itemId: block.itemId,
                contentIndex: block.contentIndex,
                delta: reasoningText,
              });
            if (signature) block.signature += signature;
          } else if (toolUse) {
            const block = blocks.get(index);
            if (!block || block.kind !== 'tool')
              throw invalidEvent('tool delta has no matching start');
            const input = string(toolUse.input) ?? '';
            block.arguments += input;
            if (input)
              await sink.publish({
                type: 'tool_call_delta',
                itemId: block.itemId,
                contentIndex: block.contentIndex,
                argumentsDelta: input,
              });
          }
          break;
        }
        case 'contentBlockStop': {
          if (index === undefined) throw invalidEvent('missing content index');
          const block = blocks.get(index);
          if (!block) break;
          if (block.kind === 'tool') {
            const parsed = parseToolArguments(block.arguments);
            await sink.publish({
              type: 'tool_call_end',
              itemId: block.itemId,
              contentIndex: block.contentIndex,
              toolCall: {
                type: 'tool_call',
                id: block.toolCallId!,
                name: block.name!,
                status: parsed.ok ? 'complete' : 'incomplete',
                rawArguments: block.arguments,
                ...(parsed.ok ? { arguments: parsed.value } : {}),
              },
            });
          } else {
            await sink.publish({
              type: block.kind === 'text' ? 'text_end' : 'reasoning_end',
              itemId: block.itemId,
              contentIndex: block.contentIndex,
              ...(block.signature
                ? {
                    replay: reasoningReplay(request.model, block.signature),
                  }
                : {}),
            });
          }
          blocks.delete(index);
          break;
        }
        case 'messageStop':
          finishReason = mapStopReason(string(event.stopReason));
          completed = true;
          break;
        case 'metadata': {
          const rawUsage = object(event.usage);
          usage = makeUsage({
            inputTokens: number(rawUsage.inputTokens),
            outputTokens: number(rawUsage.outputTokens),
            cacheReadTokens: number(rawUsage.cacheReadInputTokens),
            cacheWriteTokens: number(rawUsage.cacheWriteInputTokens),
            totalTokens: number(rawUsage.totalTokens),
          });
          latencyMs = number(object(event.metrics).latencyMs);
          break;
        }
        case 'internalServerException':
        case 'modelStreamErrorException':
        case 'serviceUnavailableException':
          return failed(
            'BEDROCK_SERVER_ERROR',
            'provider',
            string(event.message) ?? event.type,
            true,
          );
        case 'throttlingException':
          return failed(
            'BEDROCK_RATE_LIMITED',
            'rate_limit',
            string(event.message) ?? event.type,
            true,
          );
        case 'validationException':
          return failed(
            'BEDROCK_VALIDATION_FAILED',
            'invalid_request',
            string(event.message) ?? event.type,
          );
        default:
          throw invalidEvent(`unknown event ${event.type}`);
      }
    }
  } catch (error) {
    if (request.signal.aborted) return cancelled();
    if (error instanceof AiRuntimeError) return { status: 'failed', error };
    throw error;
  }

  if (!completed)
    return failed(
      'BEDROCK_STREAM_INCOMPLETE',
      'invalid_response',
      'Bedrock stream ended without messageStop',
    );
  return {
    status: 'completed',
    finishReason,
    responseId: response.headers['x-amzn-requestid'],
    usage,
    cost: usage ? calculateCost(request.model, usage) : undefined,
    ...(latencyMs === undefined
      ? {}
      : {
          diagnostics: [
            { code: 'BEDROCK_LATENCY_MS', message: String(latencyMs) },
          ],
        }),
  };
}

export function makeBedrockRequestBody(
  request: ChatRequest<'bedrock-converse-stream'>,
): Record<string, unknown> {
  const options = object(request.options.protocolOptions);
  const temperature = number(options.temperature);
  const topP = number(options.topP);
  const thinkingBudget = number(options.thinkingBudget);
  const cacheRetention = string(options.cacheRetention);
  const requestMetadata = objectOrUndefined(options.requestMetadata);
  return {
    messages: request.context.messages.map((message) =>
      mapMessage(message, request.model),
    ),
    ...(request.context.systemPrompt
      ? {
          system: [
            { text: request.context.systemPrompt },
            ...(cacheRetention === 'standard' || cacheRetention === 'one_hour'
              ? [
                  {
                    cachePoint: {
                      type: 'default',
                      ...(cacheRetention === 'one_hour' ? { ttl: '1h' } : {}),
                    },
                  },
                ]
              : []),
          ],
        }
      : {}),
    inferenceConfig: {
      maxTokens: request.options.maxOutputTokens,
      ...(request.options.stop.length
        ? { stopSequences: request.options.stop }
        : {}),
      ...(temperature === undefined ? {} : { temperature }),
      ...(topP === undefined ? {} : { topP }),
    },
    ...(request.context.tools?.length
      ? {
          toolConfig: {
            tools: request.context.tools.map((tool) => ({
              toolSpec: {
                name: tool.name,
                ...(tool.description ? { description: tool.description } : {}),
                inputSchema: { json: tool.inputSchema },
              },
            })),
            ...mapToolChoice(options.toolChoice),
          },
        }
      : {}),
    ...(thinkingBudget === undefined
      ? {}
      : {
          additionalModelRequestFields: {
            thinking: { type: 'enabled', budget_tokens: thinkingBudget },
          },
        }),
    ...(requestMetadata ? { requestMetadata } : {}),
  };
}

async function ensureTextBlock(
  blocks: Map<number, BlockState>,
  upstreamIndex: number,
  kind: 'text' | 'reasoning',
  contentIndex: number,
  sink: ProtocolEventSink,
): Promise<{ readonly block: BlockState; readonly created: boolean }> {
  const existing = blocks.get(upstreamIndex);
  if (existing) {
    if (existing.kind !== kind)
      throw invalidEvent('content block kind changed');
    return { block: existing, created: false };
  }
  const block: BlockState = {
    kind,
    itemId: `bedrock-${upstreamIndex}`,
    contentIndex,
    arguments: '',
    signature: '',
  };
  blocks.set(upstreamIndex, block);
  await sink.publish({
    type: kind === 'text' ? 'text_start' : 'reasoning_start',
    itemId: block.itemId,
    contentIndex,
  });
  return { block, created: true };
}

function mapMessage(
  message: Message,
  model: Readonly<ModelDefinition<'bedrock-converse-stream'>>,
): Record<string, unknown> {
  if (message.role === 'user')
    return {
      role: 'user',
      content: message.content.map((content) =>
        content.type === 'text'
          ? { text: content.text }
          : {
              image: {
                format: content.mediaType.split('/')[1] ?? 'png',
                source:
                  content.source.type === 'base64'
                    ? { bytes: content.source.data }
                    : { url: content.source.url },
              },
            },
      ),
    };
  if (message.role === 'tool_result')
    return {
      role: 'user',
      content: [
        {
          toolResult: {
            toolUseId: message.toolCallId,
            status: message.isError ? 'error' : 'success',
            content: message.content.map((content) =>
              content.type === 'text'
                ? { text: content.text }
                : { text: `[image:${content.mediaType}]` },
            ),
          },
        },
      ],
    };
  return {
    role: 'assistant',
    content: message.content.map((content) => {
      if (content.type === 'text') return { text: content.text };
      if (content.type === 'tool_call')
        return {
          toolUse: {
            toolUseId: content.id,
            name: content.name,
            input: content.arguments ?? parseJson(content.rawArguments),
          },
        };
      const signature = readReasoningSignature(content.replay, model);
      return supportsThinkingSignature(model)
        ? signature
          ? {
              reasoningContent: {
                reasoningText: { text: content.text ?? '', signature },
              },
            }
          : { text: content.text ?? '' }
        : {
            reasoningContent: {
              reasoningText: { text: content.text ?? '' },
            },
          };
    }),
  };
}

function mapToolChoice(value: unknown): Record<string, unknown> {
  if (value === 'required') return { toolChoice: { any: {} } };
  if (value === 'none') return {};
  const selected = objectOrUndefined(value);
  const name = string(selected?.name);
  return name ? { toolChoice: { tool: { name } } } : {};
}

function readReasoningSignature(
  replay: import('../../core/content.js').ReplayMetadata | undefined,
  model: Readonly<ModelDefinition<'bedrock-converse-stream'>>,
): string | undefined {
  if (
    replay?.protocolId !== 'bedrock-converse-stream' ||
    replay.codecId !== 'bedrock-reasoning-signature' ||
    replay.codecVersion !== 1 ||
    replay.source?.providerInstanceId !== model.providerInstanceId ||
    replay.source.modelId !== model.id
  )
    return undefined;
  return string(object(replay.data).signature);
}

function reasoningReplay(
  model: Readonly<ModelDefinition<'bedrock-converse-stream'>>,
  signature: string,
) {
  return {
    version: 1,
    scope: 'same-model',
    source: {
      providerInstanceId: model.providerInstanceId,
      modelId: model.id,
      protocol: model.protocol,
    },
    protocolId: 'bedrock-converse-stream',
    codecId: 'bedrock-reasoning-signature',
    codecVersion: 1,
    data: { signature },
  } as const;
}

function supportsThinkingSignature(
  model: Readonly<ModelDefinition<'bedrock-converse-stream'>>,
): boolean {
  return /(?:anthropic|claude)/i.test(
    `${model.id} ${model.upstreamModelId} ${model.name}`,
  );
}

function mapStopReason(
  value: string | undefined,
): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
  if (value === 'tool_use') return 'tool_calls';
  if (value === 'max_tokens') return 'length';
  if (value === 'content_filtered' || value === 'guardrail_intervened')
    return 'content_filter';
  return 'stop';
}

function bedrockHttpFailure(
  status: number,
): Extract<ProtocolTerminal, { status: 'failed' }> {
  if (status === 401 || status === 403)
    return failed(
      'BEDROCK_AUTH_FAILED',
      'auth',
      'Bedrock authentication failed',
    );
  if (status === 429)
    return failed(
      'BEDROCK_RATE_LIMITED',
      'rate_limit',
      'Bedrock request was rate limited',
      true,
    );
  if (status >= 500)
    return failed(
      'BEDROCK_SERVER_ERROR',
      'provider',
      'Bedrock service failed',
      true,
    );
  return failed(
    'BEDROCK_REQUEST_FAILED',
    'invalid_request',
    'Bedrock request failed',
  );
}

function makeUsage(input: Usage): Usage | undefined {
  return Object.values(input).some((value) => value !== undefined)
    ? Object.freeze(input)
    : undefined;
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

function invalidEvent(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'BEDROCK_EVENT_INVALID',
    'invalid_response',
    message,
  );
}

function parseJson(value: string): Record<string, unknown> {
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

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
