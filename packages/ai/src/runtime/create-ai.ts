import { AiRuntimeError, type AiError } from '../core/errors.js';
import { validateContext } from '../core/context.js';
import { parseToolArguments } from '../core/tools.js';
import { AttemptLocalSink } from '../stream/attempt-sink.js';
import type {
  AiResponseStream,
  AiStreamEvent,
  AssistantResponse,
  ChatRequest,
  ProtocolTerminal,
  ResolvedStreamOptions,
} from '../core/events.js';
import type { AiContext } from '../core/messages.js';
import type {
  ModelDefinition,
  ModelHandle,
  ModelRef,
  ProviderSnapshot,
} from '../core/models.js';
import { ResponseStream } from '../stream/response-stream.js';
import {
  ProviderRegistry,
  type Provider,
  type ProvidersApi,
} from './registry.js';

const handleProvider = new WeakMap<object, string>();
const handleRuntime = new WeakMap<object, symbol>();

export interface StreamOptionsInput {
  readonly signal?: AbortSignal;
  readonly maxOutputTokens?: number;
  readonly stop?: readonly string[];
  readonly timeoutMs?: number;
  readonly protocolOptions?: Readonly<Record<string, unknown>>;
}

export interface ModelListFilter {
  readonly providerInstanceId?: string;
  readonly protocol?: string;
  readonly input?: 'text' | 'image';
}

export interface ModelsApi<TScopeHandle> {
  find<TProtocol extends string>(
    ref: ModelRef<TProtocol>,
    scope: TScopeHandle,
  ): Promise<ModelHandle<TProtocol> | undefined>;
  require<TProtocol extends string>(
    ref: ModelRef<TProtocol>,
    scope: TScopeHandle,
  ): Promise<ModelHandle<TProtocol>>;
  list(
    scope: TScopeHandle,
    filter?: ModelListFilter,
  ): Promise<{ models: readonly ModelHandle[] }>;
}

export interface InventoryApi {
  readonly models: {
    find<TProtocol extends string>(
      ref: ModelRef<TProtocol>,
    ): Promise<
      | {
          definition: Readonly<ModelDefinition<TProtocol>>;
          source: 'static';
          availability: 'unknown';
        }
      | undefined
    >;
    list(filter?: ModelListFilter): Promise<
      readonly {
        definition: Readonly<ModelDefinition>;
        source: 'static';
        availability: 'unknown';
      }[]
    >;
  };
}

export interface AiRuntime<TScopeHandle = unknown> {
  readonly providers: ProvidersApi;
  readonly inventory: InventoryApi;
  readonly models: ModelsApi<TScopeHandle>;
  stream<TProtocol extends string>(
    model: ModelHandle<TProtocol>,
    context: AiContext,
    options?: StreamOptionsInput,
  ): AiResponseStream;
  complete<TProtocol extends string>(
    model: ModelHandle<TProtocol>,
    context: AiContext,
    options?: StreamOptionsInput,
  ): Promise<AssistantResponse>;
  dispose(): Promise<void>;
}

export interface RuntimeResourcePolicyInput {
  readonly streamQueue?: Readonly<{
    readonly maxEvents?: number;
    readonly maxBytes?: number;
  }>;
}

export interface CreateAiOptions<TScopeHandle = unknown> {
  readonly commonDefaults?: Readonly<{
    maxOutputTokens?: number;
    timeoutMs?: number;
  }>;
  readonly scope?: TScopeHandle;
  readonly resourcePolicy?: RuntimeResourcePolicyInput;
}

interface BlockState {
  readonly kind: 'text' | 'reasoning' | 'tool_call';
  readonly itemId: string;
  readonly contentIndex: number;
  text: string;
  name: string;
  toolCallId: string;
  rawArguments: string;
  closed: boolean;
  replay?: import('../core/content.js').ReplayMetadata;
  toolCall?: import('../core/content.js').ToolCallContent;
}

export function createAi<TScopeHandle = unknown>(
  options: CreateAiOptions<TScopeHandle> = {},
): AiRuntime<TScopeHandle> {
  const registry = new ProviderRegistry();
  const runtimeId = Symbol('duoduo-ai-runtime');
  let disposed = false;

  const inventory: InventoryApi = {
    models: {
      find: async <TProtocol extends string>(ref: ModelRef<TProtocol>) => {
        const definition = registry
          .models()
          .find((candidate) => sameRef(candidate, ref));
        return definition
          ? {
              definition: definition as ModelDefinition<TProtocol>,
              source: 'static' as const,
              availability: 'unknown' as const,
            }
          : undefined;
      },
      list: async (filter) =>
        registry
          .models()
          .filter((model) => matchesFilter(model, filter))
          .map((definition) => ({
            definition,
            source: 'static' as const,
            availability: 'unknown' as const,
          })),
    },
  };

  const models: ModelsApi<TScopeHandle> = {
    find: async <TProtocol extends string>(ref: ModelRef<TProtocol>) => {
      const entry = registry.get(ref.providerInstanceId);
      const definition = entry?.provider.chat?.models.find((model) =>
        sameRef(model, ref),
      );
      return definition && entry
        ? makeHandle<TProtocol>(
            definition as ModelDefinition<TProtocol>,
            entry.snapshot,
            runtimeId,
          )
        : undefined;
    },
    require: async <TProtocol extends string>(
      ref: ModelRef<TProtocol>,
      scope: TScopeHandle,
    ) => {
      const model = await models.find(ref, scope);
      if (!model)
        throw new AiRuntimeError(
          'MODEL_NOT_FOUND',
          'invalid_request',
          `model not found: ${ref.providerInstanceId}/${ref.modelId}`,
        );
      return model;
    },
    list: async (_scope, filter) => {
      const handles: ModelHandle[] = [];
      for (const snapshot of registry.list()) {
        if (
          filter?.providerInstanceId &&
          filter.providerInstanceId !== snapshot.id
        )
          continue;
        const entry = registry.get(snapshot.id);
        for (const model of entry?.provider.chat?.models ?? []) {
          if (matchesFilter(model, filter))
            handles.push(makeHandle(model, snapshot, runtimeId));
        }
      }
      return { models: handles };
    },
  };

  const runtime: AiRuntime<TScopeHandle> = {
    providers: registry,
    inventory,
    models,
    stream: (model, context, streamOptions) => {
      if (disposed)
        throw new AiRuntimeError(
          'RUNTIME_DISPOSED',
          'invalid_request',
          'runtime is disposed',
        );
      const providerId = handleProvider.get(model as object);
      if (
        providerId === undefined ||
        handleRuntime.get(model as object) !== runtimeId
      ) {
        throw new AiRuntimeError(
          'MODEL_HANDLE_INVALID',
          'invalid_request',
          'model handle was not created by this runtime',
        );
      }
      const entry = registry.get(providerId);
      if (
        !entry ||
        entry.snapshot.registrationGeneration !==
          model.identity.providerRegistrationGeneration
      ) {
        throw new AiRuntimeError(
          'MODEL_HANDLE_STALE',
          'invalid_request',
          'model handle belongs to an unregistered provider',
        );
      }
      const chat = entry.provider.chat;
      if (!chat)
        throw new AiRuntimeError(
          'PROVIDER_CAPABILITY_UNAVAILABLE',
          'invalid_request',
          'provider does not support chat',
        );
      const resolved = resolveOptions(
        model.definition,
        streamOptions,
        options.commonDefaults,
      );
      const stream = new ResponseStream(
        async (ownedStream) => {
          await runChat({
            entry,
            chat,
            model,
            context,
            resolved,
            stream: ownedStream,
          });
        },
        {
          observerMaxItems: options.resourcePolicy?.streamQueue?.maxEvents,
          observerMaxBytes: options.resourcePolicy?.streamQueue?.maxBytes,
        },
      );
      if (streamOptions?.signal) {
        if (streamOptions.signal.aborted) stream.abort('caller aborted');
        else
          streamOptions.signal.addEventListener(
            'abort',
            () => stream.abort('caller aborted'),
            { once: true },
          );
      }
      return stream;
    },
    complete: (model, context, streamOptions) => {
      const stream = runtime.stream(model, context, streamOptions);
      return stream.result();
    },
    dispose: async () => {
      disposed = true;
    },
  };

  return runtime;
}

function makeHandle<TProtocol extends string>(
  definition: ModelDefinition<TProtocol>,
  snapshot: ProviderSnapshot,
  runtimeId: symbol,
): ModelHandle<TProtocol> {
  const handle = Object.freeze({
    ref: Object.freeze({
      providerInstanceId: definition.providerInstanceId,
      modelId: definition.id,
      protocol: definition.protocol,
    }),
    definition: Object.freeze(definition),
    identity: Object.freeze({
      providerRegistrationGeneration: snapshot.registrationGeneration,
      providerConfigFingerprint: snapshot.configFingerprint,
    }),
  });
  handleProvider.set(handle, definition.providerInstanceId);
  handleRuntime.set(handle, runtimeId);
  return handle;
}

function sameRef<TProtocol extends string>(
  model: ModelDefinition<TProtocol>,
  ref: ModelRef<TProtocol>,
): boolean {
  return (
    model.providerInstanceId === ref.providerInstanceId &&
    model.id === ref.modelId &&
    (ref.protocol === undefined || model.protocol === ref.protocol)
  );
}

function matchesFilter(
  model: ModelDefinition,
  filter: ModelListFilter | undefined,
): boolean {
  return (
    (filter?.providerInstanceId === undefined ||
      filter.providerInstanceId === model.providerInstanceId) &&
    (filter?.protocol === undefined || filter.protocol === model.protocol) &&
    (filter?.input === undefined ||
      model.capabilities.input.includes(filter.input))
  );
}

function resolveOptions<TProtocol extends string>(
  model: ModelDefinition<TProtocol>,
  input: StreamOptionsInput | undefined,
  defaults: CreateAiOptions['commonDefaults'],
): ResolvedStreamOptions<TProtocol> {
  const controller = new AbortController();
  const timeoutMs = input?.timeoutMs ?? defaults?.timeoutMs ?? 30_000;
  const maxOutputTokens =
    input?.maxOutputTokens ??
    model.limits.maxOutputTokens ??
    defaults?.maxOutputTokens ??
    4096;
  return {
    signal: controller.signal,
    maxOutputTokens,
    stop: input?.stop ?? model.requestDefaults?.stop ?? [],
    timeoutMs,
    protocolOptions: (input?.protocolOptions ??
      {}) as ResolvedStreamOptions<TProtocol>['protocolOptions'],
  };
}

async function runChat<TProtocol extends string>(input: {
  entry: { provider: Provider; snapshot: ProviderSnapshot };
  chat: NonNullable<Provider['chat']>;
  model: ModelHandle<TProtocol>;
  context: AiContext;
  resolved: ResolvedStreamOptions<TProtocol>;
  stream: ResponseStream;
}): Promise<void> {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  let sequence = 0;
  const blocks = new Map<string, BlockState>();
  const content: AggregatedContent[] = [];
  const responseStart: AiStreamEvent = {
    type: 'response_start',
    sequence: ++sequence,
    requestId,
    startedAt,
    model: input.model.definition,
  };
  await input.stream.publish(responseStart);

  let lateEventCount = 0;
  const sink = new AttemptLocalSink({
    onLateEvent: () => {
      lateEventCount += 1;
    },
    onPublish: async (event) => {
      const full = { ...event, sequence: ++sequence } as AiStreamEvent;
      updateAggregate(blocks, content, full);
      await input.stream.publish(full);
    },
  });

  let terminal: ProtocolTerminal;
  try {
    const contextResult = validateContext(input.context);
    if (!contextResult.valid) {
      terminal = {
        status: 'failed',
        error: new AiRuntimeError(
          'CONTEXT_INVALID',
          'invalid_request',
          contextResult.issues.map((issue) => issue.message).join('; '),
          false,
          { issues: contextResult.issues },
        ),
      };
    } else {
      const abortTimer = setTimeout(
        () => input.stream.abort('stream timeout'),
        input.resolved.timeoutMs,
      );
      try {
        const request: ChatRequest<TProtocol> = {
          model: input.model.definition,
          context: input.context,
          options: { ...input.resolved, signal: input.stream.signal },
          signal: input.stream.signal,
        };
        terminal = await input.chat.runChat(request, sink);
      } finally {
        clearTimeout(abortTimer);
      }
    }
  } catch (error: unknown) {
    terminal = input.stream.signal.aborted
      ? { status: 'cancelled', error: cancelledError(error) }
      : { status: 'failed', error: failedError(error) };
  } finally {
    const sinkError = await sink.close();
    if (sinkError && terminal!.status === 'completed')
      terminal = { status: 'failed', error: failedError(sinkError) };
  }

  if (lateEventCount > 0) {
    terminal = addDiagnostic(terminal, {
      code: 'LATE_PROVIDER_EVENT_DROPPED',
      message: `${lateEventCount} provider event(s) arrived after the attempt closed`,
    });
  }

  if (terminal.status === 'completed') {
    const terminalError = validateCompletedTerminal(terminal, blocks, content);
    if (terminalError) terminal = { status: 'failed', error: terminalError };
  }
  if (terminal.status !== 'completed') finalizeOpenBlocks(blocks, content);

  const completedAt = Date.now();
  const response = makeResponse({
    requestId,
    startedAt,
    completedAt,
    model: input.model.definition,
    content,
    terminal,
  });
  const event: AiStreamEvent =
    response.status === 'completed'
      ? { type: 'response_end', sequence: ++sequence, response }
      : { type: 'response_error', sequence: ++sequence, response };
  await input.stream.complete(response, event);
}

type AggregatedContent = {
  readonly contentIndex: number;
  readonly value:
    | import('../core/content.js').ToolCallContent
    | import('../core/content.js').TextContent
    | import('../core/content.js').ReasoningContent;
};

function updateAggregate(
  blocks: Map<string, BlockState>,
  content: AggregatedContent[],
  event: AiStreamEvent,
): void {
  switch (event.type) {
    case 'text_start':
    case 'reasoning_start':
      assertNewBlock(blocks, event.itemId, event.contentIndex);
      blocks.set(event.itemId, {
        kind: event.type === 'text_start' ? 'text' : 'reasoning',
        itemId: event.itemId,
        contentIndex: event.contentIndex,
        text: '',
        name: '',
        toolCallId: '',
        rawArguments: '',
        closed: false,
      });
      return;
    case 'tool_call_start':
      assertNewBlock(blocks, event.itemId, event.contentIndex);
      blocks.set(event.itemId, {
        kind: 'tool_call',
        itemId: event.itemId,
        contentIndex: event.contentIndex,
        text: '',
        name: event.name ?? '',
        toolCallId: event.toolCallId,
        rawArguments: '',
        closed: false,
      });
      return;
    case 'text_delta':
    case 'reasoning_delta': {
      const block = requireBlock(blocks, event.itemId, event.contentIndex);
      if (
        block.closed ||
        block.kind !== (event.type === 'text_delta' ? 'text' : 'reasoning')
      )
        throw protocolError(
          `invalid ${event.type} for content item ${event.itemId}`,
        );
      block.text += event.delta;
      return;
    }
    case 'tool_call_delta': {
      const block = requireBlock(blocks, event.itemId, event.contentIndex);
      if (block.closed || block.kind !== 'tool_call')
        throw protocolError(
          `invalid tool_call_delta for content item ${event.itemId}`,
        );
      block.rawArguments += event.argumentsDelta;
      if (event.nameDelta) block.name += event.nameDelta;
      return;
    }
    case 'text_end':
    case 'reasoning_end': {
      const block = requireBlock(blocks, event.itemId, event.contentIndex);
      if (
        block.closed ||
        block.kind !== (event.type === 'text_end' ? 'text' : 'reasoning')
      )
        throw protocolError(
          `invalid ${event.type} for content item ${event.itemId}`,
        );
      block.closed = true;
      block.replay = event.replay;
      content.push({
        contentIndex: block.contentIndex,
        value:
          event.type === 'text_end'
            ? {
                type: 'text',
                text: block.text,
                ...(event.replay ? { replay: event.replay } : {}),
              }
            : {
                type: 'reasoning',
                text: block.text,
                ...(event.replay ? { replay: event.replay } : {}),
              },
      });
      return;
    }
    case 'tool_call_end': {
      const block = requireBlock(blocks, event.itemId, event.contentIndex);
      if (block.closed || block.kind !== 'tool_call')
        throw protocolError(
          `invalid tool_call_end for content item ${event.itemId}`,
        );
      if (
        event.toolCall.id !== block.toolCallId ||
        event.toolCall.rawArguments !== block.rawArguments
      )
        throw protocolError(
          `tool call ${event.itemId} does not contain the collected arguments`,
        );
      if (event.toolCall.name !== block.name)
        throw protocolError(
          `tool call ${event.itemId} name does not match its start event`,
        );
      block.closed = true;
      block.toolCall = canonicalToolCall(block, event.toolCall);
      content.push({ contentIndex: block.contentIndex, value: block.toolCall });
      return;
    }
    default:
      return;
  }
}

function canonicalToolCall(
  block: BlockState,
  supplied: import('../core/content.js').ToolCallContent,
): import('../core/content.js').ToolCallContent {
  const parsed = parseToolArguments(block.rawArguments, {
    repairTruncatedJson: true,
  });
  return {
    type: 'tool_call',
    id: block.toolCallId,
    name: block.name,
    status: parsed.ok ? 'complete' : 'incomplete',
    rawArguments: block.rawArguments,
    ...(parsed.ok ? { arguments: parsed.value } : {}),
    ...(supplied.replay ? { replay: supplied.replay } : {}),
  };
}

function validateCompletedTerminal(
  terminal: Extract<ProtocolTerminal, { status: 'completed' }>,
  blocks: Map<string, BlockState>,
  content: readonly AggregatedContent[],
): AiError | undefined {
  for (const block of blocks.values()) {
    if (!block.closed)
      return protocolError(`content item ${block.itemId} was not closed`);
  }
  if (
    terminal.finishReason === 'stop' ||
    terminal.finishReason === 'tool_calls'
  ) {
    const incomplete = content.some(
      (item) =>
        item.value.type === 'tool_call' && item.value.status !== 'complete',
    );
    if (incomplete)
      return protocolError('completed tool call contains incomplete JSON');
  }
  return undefined;
}

function finalizeOpenBlocks(
  blocks: Map<string, BlockState>,
  content: AggregatedContent[],
): void {
  const present = new Set(content.map((item) => item.contentIndex));
  for (const block of blocks.values()) {
    if (block.closed || present.has(block.contentIndex)) continue;
    block.closed = true;
    const value =
      block.kind === 'text'
        ? ({ type: 'text', text: block.text } as const)
        : block.kind === 'reasoning'
          ? ({ type: 'reasoning', text: block.text } as const)
          : canonicalToolCall(block, {
              type: 'tool_call',
              id: block.toolCallId,
              name: block.name,
              status: 'incomplete',
              rawArguments: block.rawArguments,
            });
    content.push({ contentIndex: block.contentIndex, value });
  }
}

function assertNewBlock(
  blocks: Map<string, BlockState>,
  itemId: string,
  contentIndex: number,
): void {
  if (blocks.has(itemId)) throw protocolError('duplicate content item');
  if (contentIndex !== blocks.size)
    throw protocolError(
      `content index ${contentIndex} is not the next logical block`,
    );
}

function requireBlock(
  blocks: Map<string, BlockState>,
  itemId: string,
  contentIndex: number,
): BlockState {
  const block = blocks.get(itemId);
  if (!block) throw protocolError(`content item ${itemId} has no start event`);
  if (block.contentIndex !== contentIndex)
    throw protocolError(`content item ${itemId} changed content index`);
  return block;
}

function protocolError(message: string): AiError {
  return new AiRuntimeError('PROTOCOL_VIOLATION', 'protocol', message, false);
}

function addDiagnostic(
  terminal: ProtocolTerminal,
  diagnostic: { code: string; message: string },
): ProtocolTerminal {
  return {
    ...terminal,
    diagnostics: [...(terminal.diagnostics ?? []), diagnostic],
  } as ProtocolTerminal;
}

function makeResponse(input: {
  requestId: string;
  startedAt: number;
  completedAt: number;
  model: Readonly<ModelDefinition>;
  content: readonly AggregatedContent[];
  terminal: ProtocolTerminal;
}): AssistantResponse {
  const orderedContent = Object.freeze(
    [...input.content]
      .sort((left, right) => left.contentIndex - right.contentIndex)
      .map((item) => item.value),
  );
  const base = {
    requestId: input.requestId,
    model: input.model,
    ...(input.terminal.responseModelId
      ? {
          responseModel: {
            providerInstanceId: input.model.providerInstanceId,
            modelId: input.terminal.responseModelId,
            protocol: input.model.protocol,
          },
        }
      : {}),
    ...(input.terminal.responseId
      ? { responseId: input.terminal.responseId }
      : {}),
    ...(input.terminal.replay ? { replay: input.terminal.replay } : {}),
    content: orderedContent,
    usage: input.terminal.usage,
    cost: input.terminal.cost,
    diagnostics: input.terminal.diagnostics,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
  if (input.terminal.status === 'completed')
    return {
      ...base,
      status: 'completed',
      finishReason: input.terminal.finishReason,
      partial: false,
    };
  if (input.terminal.status === 'cancelled')
    return {
      ...base,
      status: 'cancelled',
      finishReason: 'cancelled',
      partial: orderedContent.length > 0,
      error: input.terminal.error,
    };
  return {
    ...base,
    status: 'failed',
    finishReason: 'error',
    partial: orderedContent.length > 0,
    error: input.terminal.error,
  };
}

function failedError(error: unknown): AiError {
  if (isAiError(error)) return error;
  return new AiRuntimeError(
    'INTERNAL_ERROR',
    'internal',
    'AI provider failed internally',
    false,
  );
}

function cancelledError(error: unknown): AiError & { category: 'cancelled' } {
  if (isAiError(error) && error.category === 'cancelled')
    return error as AiError & { category: 'cancelled' };
  return new AiRuntimeError(
    'REQUEST_CANCELLED',
    'cancelled',
    error instanceof Error ? error.message : 'request cancelled',
    false,
  ) as AiError & { category: 'cancelled' };
}

function isAiError(error: unknown): error is AiError {
  return (
    error instanceof Error &&
    error.name === 'AiError' &&
    typeof (error as Partial<AiError>).code === 'string'
  );
}
