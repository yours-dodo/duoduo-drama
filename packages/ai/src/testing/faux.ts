import type { AiContext } from '../core/messages.js';
import type {
  ChatRequest,
  ProtocolContentEvent,
  ProtocolTerminal,
  ResolvedStreamOptions,
} from '../core/events.js';
import { AiRuntimeError, type AiError } from '../core/errors.js';
import type { ModelDefinition, ModelRef } from '../core/models.js';
import type { Cost, Usage } from '../core/usage.js';
import type { CompletedFinishReason } from '../core/messages.js';
import type { Provider, ProtocolEventSink } from '../runtime/registry.js';
import { parseToolArguments } from '../core/tools.js';

export interface ScriptedProtocolChunk {
  readonly afterMs?: number;
  readonly event: ProtocolContentEvent;
}

export interface FauxResponseScript {
  readonly chunks: readonly ScriptedProtocolChunk[];
  readonly terminal: ProtocolTerminal;
}

export interface FauxCallRecord {
  readonly callIndex: number;
  readonly modelId: string;
  readonly context: Readonly<AiContext>;
  readonly options: Readonly<ResolvedStreamOptions>;
  readonly startedAt: number;
  readonly aborted: boolean;
}

export interface FauxController {
  setResponses(scripts: readonly FauxResponseScript[]): void;
  appendResponse(script: FauxResponseScript): void;
  pendingCount(): number;
  callCount(): number;
  calls(): readonly FauxCallRecord[];
  reset(): void;
}

export interface FauxProviderFixture {
  readonly provider: Provider;
  readonly controller: FauxController;
  readonly modelRef: ModelRef<'faux'>;
}

export interface AdditionalModelInput<TProtocol extends string> {
  readonly id: string;
  readonly name?: string;
  readonly upstreamModelId?: string;
  readonly protocol?: TProtocol;
  readonly capabilities?: Partial<ModelDefinition<TProtocol>['capabilities']>;
  readonly limits?: Partial<ModelDefinition<TProtocol>['limits']>;
}

export function createFauxProvider(
  options: {
    id?: string;
    models?: readonly AdditionalModelInput<'faux'>[];
    initialResponses?: readonly FauxResponseScript[];
  } = {},
): FauxProviderFixture {
  const providerId = options.id ?? 'faux';
  const defaultModel = makeModel(providerId, {
    id: 'faux-text',
    name: 'Faux Text',
  });
  const models = [
    defaultModel,
    ...(options.models ?? []).map((input) => makeModel(providerId, input)),
  ];
  const queue = options.initialResponses
    ? [...options.initialResponses]
    : [fauxTextResponse('faux response')];
  const calls: FauxCallRecord[] = [];
  let inFlight = 0;
  const controller: FauxController = {
    setResponses: (scripts) => {
      queue.splice(0, queue.length, ...scripts);
    },
    appendResponse: (script) => queue.push(script),
    pendingCount: () => queue.length,
    callCount: () => calls.length,
    calls: () => Object.freeze(calls.map((call) => Object.freeze({ ...call }))),
    reset: () => {
      if (inFlight > 0)
        throw new AiRuntimeError(
          'FAUX_RESET_IN_FLIGHT',
          'invalid_request',
          'cannot reset Faux while a response is in flight',
        );
      queue.splice(0, queue.length);
      calls.splice(0, calls.length);
    },
  };
  const chat = {
    models: Object.freeze(models),
    runChat: async (
      request: ChatRequest<'faux'>,
      sink: ProtocolEventSink,
    ): Promise<ProtocolTerminal> => {
      const script =
        queue.shift() ??
        ({
          chunks: [],
          terminal: {
            status: 'failed',
            error: new AiRuntimeError(
              'FAUX_RESPONSE_QUEUE_EMPTY',
              'provider',
              'Faux response queue is empty',
              false,
            ),
          },
        } satisfies FauxResponseScript);
      const call = {
        callIndex: calls.length,
        modelId: request.model.id,
        context: request.context,
        options: request.options,
        startedAt: Date.now(),
        aborted: false,
      };
      calls.push(call);
      inFlight += 1;
      try {
        for (const chunk of script.chunks) {
          if (request.signal.aborted) return cancelled(call);
          if (chunk.afterMs) await delay(chunk.afterMs);
          if (request.signal.aborted) return cancelled(call);
          await sink.publish(chunk.event);
        }
        if (request.signal.aborted) return cancelled(call);
        return script.terminal;
      } finally {
        inFlight -= 1;
      }
    },
  };
  const provider: Provider = {
    id: providerId,
    kind: 'faux',
    name: 'Faux',
    chat,
  };
  return {
    provider,
    controller,
    modelRef: {
      providerInstanceId: providerId,
      modelId: defaultModel.id,
      protocol: 'faux',
    },
  };
}

function cancelled(call: { aborted: boolean }): ProtocolTerminal {
  call.aborted = true;
  return {
    status: 'cancelled',
    error: {
      name: 'AiError',
      code: 'REQUEST_CANCELLED',
      category: 'cancelled',
      retryable: false,
      message: 'request cancelled',
    } as AiError & { category: 'cancelled' },
  };
}

export function fauxTextResponse(
  text: string,
  options: { paceMs?: number; usage?: Usage; cost?: Cost } = {},
): FauxResponseScript {
  return {
    chunks: [
      {
        afterMs: options.paceMs,
        event: { type: 'text_start', itemId: 'text-0', contentIndex: 0 },
      },
      {
        afterMs: options.paceMs,
        event: {
          type: 'text_delta',
          itemId: 'text-0',
          contentIndex: 0,
          delta: text,
        },
      },
      {
        afterMs: options.paceMs,
        event: { type: 'text_end', itemId: 'text-0', contentIndex: 0 },
      },
    ],
    terminal: {
      status: 'completed',
      finishReason: 'stop',
      usage: options.usage,
      cost: options.cost,
      responseId: 'faux-response-0',
    },
  };
}

export function fauxToolResponse(input: {
  id: string;
  name: string;
  rawArguments: string;
  paceMs?: number;
  usage?: Usage;
  finishReason?: CompletedFinishReason;
  repairTruncatedJson?: boolean;
}): FauxResponseScript {
  const parsed = parseToolArguments(input.rawArguments, {
    repairTruncatedJson: input.repairTruncatedJson ?? false,
  });
  const toolCall = {
    type: 'tool_call' as const,
    id: input.id,
    name: input.name,
    status: parsed.ok ? ('complete' as const) : ('incomplete' as const),
    rawArguments: input.rawArguments,
    ...(parsed.ok ? { arguments: parsed.value } : {}),
  };
  return {
    chunks: [
      {
        afterMs: input.paceMs,
        event: {
          type: 'tool_call_start',
          itemId: input.id,
          contentIndex: 0,
          toolCallId: input.id,
          name: input.name,
        },
      },
      {
        afterMs: input.paceMs,
        event: {
          type: 'tool_call_delta',
          itemId: input.id,
          contentIndex: 0,
          argumentsDelta: input.rawArguments,
        },
      },
      {
        afterMs: input.paceMs,
        event: {
          type: 'tool_call_end',
          itemId: input.id,
          contentIndex: 0,
          toolCall: toolCall,
        },
      },
    ],
    terminal: {
      status: 'completed',
      finishReason: input.finishReason ?? 'tool_calls',
      usage: input.usage,
    },
  };
}

export function fauxFailure(input: {
  error: AiError;
  afterChunks?: readonly ScriptedProtocolChunk[];
}): FauxResponseScript {
  return {
    chunks: input.afterChunks ?? [],
    terminal: { status: 'failed', error: input.error },
  };
}

function makeModel(
  providerId: string,
  input: AdditionalModelInput<'faux'>,
): ModelDefinition<'faux'> {
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId: providerId,
    protocol: 'faux',
    protocolProfileId: 'faux-default',
    capabilities: Object.freeze({
      input: ['text'] as const,
      streaming: true,
      reasoning: false,
      toolCalling: true,
      parallelToolCalls: false,
      deferredTools: false,
      thinkingLevels: [] as const,
      ...input.capabilities,
    }),
    limits: Object.freeze({
      contextTokens: 8_192,
      maxOutputTokens: 4_096,
      ...input.limits,
    }),
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
