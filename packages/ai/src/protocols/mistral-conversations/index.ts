import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';
import type {
  BoundTransportRequest,
  RequestTransport,
  TransportResponse,
} from '../../transport/types.js';
import { createOpenAiChatCompletionsAdapter } from '../openai-chat-completions/adapter.js';

export interface MistralConversationsProtocolOptions {
  readonly promptMode?: 'reasoning';
  readonly reasoningEffort?: 'none' | 'high';
}

export const mistralConversationsContract = Object.freeze({
  protocol: 'mistral-conversations' as const,
  route: 'chat.stream' as const,
  streaming: true,
  terminalOwner: 'runtime' as const,
});

export const mistralConversationsReplayCodecs = Object.freeze([
  Object.freeze({ id: 'mistral-reasoning', version: 1 }),
]);

export interface MistralConversationsAdapterOptions {
  readonly normalizeToolCallIds?: boolean;
}

export function createMistralConversationsAdapter(
  options: MistralConversationsAdapterOptions = {},
) {
  const chatAdapter = createOpenAiChatCompletionsAdapter({
    compatibility: {
      supportsDeveloperRole: false,
      supportsUsageInStreaming: true,
      supportsReasoningEffort: true,
      thinkingFormat: 'openai',
      maxTokensField: 'max_tokens',
    },
  });
  return async (
    request: ChatRequest<'mistral-conversations'>,
    sink: ProtocolEventSink,
  ): Promise<ProtocolTerminal> => {
    if (!request.transport)
      return chatAdapter(
        request as unknown as ChatRequest<'openai-chat-completions'>,
        sink,
      );
    const protocolOptions = request.options
      .protocolOptions as MistralConversationsProtocolOptions;
    const transport = decorateTransport(
      request.transport,
      protocolOptions,
      options.normalizeToolCallIds !== false,
    );
    const terminal = await chatAdapter(
      {
        ...request,
        transport,
      } as unknown as ChatRequest<'openai-chat-completions'>,
      sink,
    );
    if (terminal.status !== 'completed') return terminal;
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
        protocolId: 'mistral-conversations',
        codecId: 'mistral-reasoning',
        codecVersion: 1,
        data: { promptMode: protocolOptions.promptMode ?? null },
      },
    };
  };
}

export const runMistralConversations = createMistralConversationsAdapter();

function decorateTransport(
  transport: RequestTransport,
  options: MistralConversationsProtocolOptions,
  normalizeToolCallIds: boolean,
): RequestTransport {
  return {
    send: async (input: BoundTransportRequest) => {
      const body = parseBody(input.body);
      if (options.promptMode) body.prompt_mode = options.promptMode;
      if (options.reasoningEffort)
        body.reasoning_effort = options.reasoningEffort;
      const response = await transport.send({
        ...input,
        body: JSON.stringify(body),
      });
      return normalizeToolCallIds ? normalizeResponse(response) : response;
    },
  };
}

function normalizeResponse(response: TransportResponse): TransportResponse {
  return {
    ...response,
    body: (async function* () {
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      for await (const chunk of response.body) {
        const text = decoder.decode(chunk, { stream: true });
        yield encoder.encode(
          text.replace(
            /"id"\s*:\s*"([^"]+)"/gu,
            (_match, id: string) => `"id":"${normalizeMistralToolCallId(id)}"`,
          ),
        );
      }
    })(),
  };
}

export function normalizeMistralToolCallId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 64);
  return normalized || 'tool_call';
}

function parseBody(
  body: BoundTransportRequest['body'],
): Record<string, unknown> {
  if (typeof body !== 'string') return {};
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}
