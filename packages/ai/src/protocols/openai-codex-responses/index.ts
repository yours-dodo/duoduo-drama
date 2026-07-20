import type { JsonValue } from '../../core/content.js';
import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';
import type {
  BoundTransportRequest,
  RequestTransport,
} from '../../transport/types.js';
import { runOpenAiResponses } from '../openai-responses/adapter.js';

export interface OpenAiCodexResponsesProtocolOptions {
  readonly reasoningSummary?:
    'auto' | 'concise' | 'detailed' | 'off' | 'on' | null;
  readonly serviceTier?: 'auto' | 'default' | 'flex' | 'priority';
  readonly textVerbosity?: 'low' | 'medium' | 'high';
  readonly transport?: 'sse' | 'websocket' | 'websocket-cached' | 'auto';
  readonly websocketConnectTimeoutMs?: number;
}

export const openAiCodexResponsesContract = Object.freeze({
  protocol: 'openai-codex-responses' as const,
  route: 'codex/responses' as const,
  transports: Object.freeze(['sse', 'websocket', 'websocket-cached'] as const),
  streaming: true,
  terminalOwner: 'runtime' as const,
});

export const openAiCodexResponsesReplayCodecs = Object.freeze([
  Object.freeze({ id: 'openai-codex-response-id', version: 1 }),
  Object.freeze({ id: 'openai-codex-reasoning', version: 1 }),
]);

export interface OpenAiCodexResponsesAdapterOptions {
  readonly sessionHeaderName?: string;
  readonly accountHeaderName?: string;
}

export function createOpenAiCodexResponsesAdapter(
  options: OpenAiCodexResponsesAdapterOptions = {},
) {
  return (
    request: ChatRequest<'openai-codex-responses'>,
    sink: ProtocolEventSink,
  ) => runOpenAiCodexResponses(request, sink, options);
}

export async function runOpenAiCodexResponses(
  request: ChatRequest<'openai-codex-responses'>,
  sink: ProtocolEventSink,
  adapterOptions: OpenAiCodexResponsesAdapterOptions = {},
): Promise<ProtocolTerminal> {
  if (!request.transport)
    return runOpenAiResponses(
      request as unknown as ChatRequest<'openai-responses'>,
      sink,
    );
  const options = request.options
    .protocolOptions as OpenAiCodexResponsesProtocolOptions;
  if (
    options.transport === 'websocket' ||
    options.transport === 'websocket-cached'
  ) {
    return {
      status: 'failed',
      error: Object.assign(
        new Error('Codex WebSocket transport is not bound for this request'),
        {
          name: 'AiError' as const,
          code: 'CODEX_WEBSOCKET_UNAVAILABLE',
          category: 'invalid_request' as const,
          retryable: false,
        },
      ),
    };
  }
  const previousResponseId = findPreviousResponseId(request);
  const transport = decorateTransport(
    request.transport,
    request,
    options,
    previousResponseId,
    adapterOptions,
  );
  const terminal = await runOpenAiResponses(
    { ...request, transport } as unknown as ChatRequest<'openai-responses'>,
    sink,
  );
  if (terminal.status !== 'completed' || !terminal.responseId) return terminal;
  return {
    ...terminal,
    replay: {
      version: 1,
      scope: 'same-model',
      source: {
        providerInstanceId: request.model.providerInstanceId,
        modelId: request.model.id,
        protocol: request.model.protocol,
      },
      protocolId: 'openai-codex-responses',
      codecId: 'openai-codex-response-id',
      codecVersion: 1,
      data: { responseId: terminal.responseId },
    },
  };
}

function decorateTransport(
  transport: RequestTransport,
  request: ChatRequest<'openai-codex-responses'>,
  options: OpenAiCodexResponsesProtocolOptions,
  previousResponseId: string | undefined,
  adapterOptions: OpenAiCodexResponsesAdapterOptions,
): RequestTransport {
  return {
    send: async (input: BoundTransportRequest) => {
      const body = parseBody(input.body);
      if (previousResponseId) body.previous_response_id = previousResponseId;
      if (options.reasoningSummary !== undefined) {
        const reasoning = object(body.reasoning);
        reasoning.summary = options.reasoningSummary;
        body.reasoning = reasoning;
      }
      if (options.serviceTier) body.service_tier = options.serviceTier;
      if (options.textVerbosity)
        body.text = { ...object(body.text), verbosity: options.textVerbosity };
      const headers: Record<string, string> = {
        ...input.headers,
        accept: 'text/event-stream',
        'openai-beta': 'responses=experimental',
        [adapterOptions.sessionHeaderName ?? 'session_id']:
          request.options.sessionId ?? request.model.providerInstanceId,
      };
      const accountId = request.model.providerInstanceId.includes(':')
        ? request.model.providerInstanceId.split(':')[1]
        : undefined;
      if (accountId)
        headers[adapterOptions.accountHeaderName ?? 'chatgpt-account-id'] =
          accountId;
      return transport.send({ ...input, headers, body: JSON.stringify(body) });
    },
  };
}

function findPreviousResponseId(
  request: ChatRequest<'openai-codex-responses'>,
): string | undefined {
  for (
    let index = request.context.messages.length - 1;
    index >= 0;
    index -= 1
  ) {
    const message = request.context.messages[index];
    if (message?.role !== 'assistant') continue;
    if (message.responseId) return message.responseId;
    const replay = message.replay;
    if (
      replay?.protocolId === 'openai-codex-responses' &&
      typeof replay.data === 'object' &&
      replay.data !== null &&
      !Array.isArray(replay.data)
    ) {
      const data = replay.data as Readonly<Record<string, JsonValue>>;
      if (typeof data.responseId === 'string') return data.responseId;
    }
  }
  return undefined;
}

function parseBody(
  body: BoundTransportRequest['body'],
): Record<string, unknown> {
  if (typeof body !== 'string') return {};
  try {
    const value = JSON.parse(body) as unknown;
    return object(value);
  } catch {
    return {};
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
