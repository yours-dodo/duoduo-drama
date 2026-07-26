import { AiRuntimeError } from '../../core/errors.js';
import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';
import type {
  BoundTransportRequest,
  RequestTransport,
  TransportResponse,
} from '../../transport/types.js';
import { runOpenAiResponses } from '../openai-responses/adapter.js';

export interface ArkResponsesCompatibility {
  readonly wireVersion: 'ark-v3';
  readonly thinkingField: 'thinking.type';
  readonly supportsPreviousResponseId: boolean;
  readonly supportsFunctionTools: boolean;
}

export interface ArkResponsesAdapterOptions {
  readonly compatibility?: Partial<ArkResponsesCompatibility>;
}

export const arkResponsesContract = Object.freeze({
  protocol: 'ark-responses' as const,
  wireVersion: 'ark-v3' as const,
  thinkingField: 'thinking.type' as const,
  supportsPreviousResponseId: true,
  supportsFunctionTools: true,
  terminalOwner: 'runtime' as const,
});

export const arkResponsesReplayCodecs = Object.freeze([
  Object.freeze({ id: 'ark-response-id', version: 1 }),
]);

export function createArkResponsesAdapter(
  options: ArkResponsesAdapterOptions = {},
) {
  const compatibility = resolveCompatibility(options.compatibility);
  return (
    request: ChatRequest<'ark-responses'>,
    sink: ProtocolEventSink,
  ): Promise<ProtocolTerminal> =>
    runArkResponses(request, sink, { compatibility });
}

export async function runArkResponses(
  request: ChatRequest<'ark-responses'>,
  sink: ProtocolEventSink,
  options: ArkResponsesAdapterOptions = {},
): Promise<ProtocolTerminal> {
  const compatibility = resolveCompatibility(options.compatibility);
  if (Object.keys(request.options.protocolOptions).length > 0) {
    return {
      status: 'failed',
      error: new AiRuntimeError(
        'ARK_PROTOCOL_OPTIONS_UNSUPPORTED',
        'invalid_request',
        'Ark Responses does not accept caller protocol extension fields',
      ),
    };
  }
  if (!request.transport) {
    return runOpenAiResponses(
      request as unknown as ChatRequest<'openai-responses'>,
      sink,
    );
  }
  const transport = decorateTransport(
    request.transport,
    request,
    compatibility,
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
        protocol: 'ark-responses',
      },
      protocolId: 'ark-responses',
      codecId: 'ark-response-id',
      codecVersion: 1,
      data: { responseId: terminal.responseId },
    },
  };
}

function resolveCompatibility(
  input: Partial<ArkResponsesCompatibility> | undefined,
): ArkResponsesCompatibility {
  const compatibility = {
    wireVersion: input?.wireVersion ?? 'ark-v3',
    thinkingField: input?.thinkingField ?? 'thinking.type',
    supportsPreviousResponseId: input?.supportsPreviousResponseId ?? true,
    supportsFunctionTools: input?.supportsFunctionTools ?? true,
  } as const;
  if (
    compatibility.wireVersion !== 'ark-v3' ||
    compatibility.thinkingField !== 'thinking.type' ||
    !compatibility.supportsPreviousResponseId ||
    !compatibility.supportsFunctionTools
  )
    throw new Error('unsupported Ark Responses compatibility profile');
  return Object.freeze(compatibility);
}

function decorateTransport(
  transport: RequestTransport,
  request: ChatRequest<'ark-responses'>,
  compatibility: ArkResponsesCompatibility,
): RequestTransport {
  return Object.freeze({
    send: async (input: BoundTransportRequest): Promise<TransportResponse> => {
      const body = parseBody(input.body);
      const previousResponseId = findPreviousResponseId(request);
      if (previousResponseId && compatibility.supportsPreviousResponseId)
        body.previous_response_id = previousResponseId;
      delete body.reasoning;
      body.thinking = {
        type: request.options.reasoning === 'none' ? 'disabled' : 'enabled',
      };
      assertFunctionTools(body.tools);
      const response = await transport.send({
        ...input,
        body: JSON.stringify(body),
      });
      return {
        ...response,
        body: translateArkEvents(response.body),
      };
    },
  });
}

function findPreviousResponseId(
  request: ChatRequest<'ark-responses'>,
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
      replay?.protocolId === 'ark-responses' &&
      replay.codecId === 'ark-response-id' &&
      isRecord(replay.data) &&
      typeof replay.data.responseId === 'string'
    )
      return replay.data.responseId;
  }
  return undefined;
}

function assertFunctionTools(value: unknown): void {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.some((tool) => !isRecord(tool) || tool.type !== 'function')
  )
    throw new AiRuntimeError(
      'ARK_TOOL_UNSUPPORTED',
      'invalid_request',
      'Ark Responses only supports common function tools',
    );
}

async function* translateArkEvents(
  body: AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  for await (const chunk of body)
    text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  text = text
    .replaceAll(
      'response.reasoning.delta',
      'response.reasoning_summary_text.delta',
    )
    .replaceAll(
      'response.reasoning.done',
      'response.reasoning_summary_text.done',
    );
  if (!text.endsWith('\n\n')) text += text.endsWith('\n') ? '\n' : '\n\n';
  yield new TextEncoder().encode(text);
}

function parseBody(
  body: BoundTransportRequest['body'],
): Record<string, unknown> {
  if (typeof body !== 'string') return {};
  try {
    const value = JSON.parse(body) as unknown;
    return isRecord(value) ? { ...value } : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
