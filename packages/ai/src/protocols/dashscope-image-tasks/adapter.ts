import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type { JsonValue } from '../../core/content.js';
import type {
  ImageCancelRequest,
  ImageProtocolContract,
  ImageProtocolEventSink,
  ImageProtocolRequest,
  ImageProtocolTerminal,
  ImageResumeRequest,
  ResumableImageProtocolAdapter,
  ResumableImageProtocolEventSink,
} from '../../images/contracts.js';

export interface DashScopeImageTasksCompatibility {
  readonly wireVersion: 1;
  readonly taskApi: 'dashscope-v1';
}
export type DashScopeImageTasksOptions = Readonly<Record<string, never>>;

declare module '../../images/contracts.js' {
  interface ImageProtocolOptionsMap {
    'dashscope-image-tasks': DashScopeImageTasksOptions;
  }
  interface ImageProtocolCompatibilityMap {
    'dashscope-image-tasks': DashScopeImageTasksCompatibility;
  }
}

export const dashScopeImageTasksContract: ImageProtocolContract<'dashscope-image-tasks'> =
  Object.freeze({
    parseOptions(input: unknown): DashScopeImageTasksOptions {
      if (!isRecord(input) || Object.keys(input).length !== 0)
        throw new AiRuntimeError(
          'DASHSCOPE_IMAGE_TASKS_OPTIONS_INVALID',
          'invalid_request',
          'DashScope Image Tasks does not accept protocol extension fields',
        );
      return Object.freeze({});
    },
    mergeOptions(layers: readonly (DashScopeImageTasksOptions | undefined)[]) {
      for (const layer of layers) this.parseOptions(layer ?? {});
      return Object.freeze({});
    },
    parseCompatibility(input: unknown): DashScopeImageTasksCompatibility {
      if (
        !isRecord(input) ||
        input.wireVersion !== 1 ||
        input.taskApi !== 'dashscope-v1' ||
        Object.keys(input).length !== 2
      )
        throw new AiRuntimeError(
          'DASHSCOPE_IMAGE_TASKS_COMPATIBILITY_INVALID',
          'invalid_request',
          'invalid DashScope Image Tasks compatibility profile',
        );
      return Object.freeze({ wireVersion: 1, taskApi: 'dashscope-v1' });
    },
  });

export function createDashScopeImageTasksAdapter(): ResumableImageProtocolAdapter<'dashscope-image-tasks'> {
  return Object.freeze({
    id: 'dashscope-image-tasks',
    operationMode: 'resumable',
    contract: dashScopeImageTasksContract,
    parseOperationState(input: unknown): JsonValue | undefined {
      if (input === undefined) return undefined;
      if (
        !isRecord(input) ||
        Object.keys(input).some((key) => key !== 'requestId')
      )
        return undefined;
      if (input.requestId !== undefined && typeof input.requestId !== 'string')
        return undefined;
      return input as JsonValue;
    },
    async run(
      request: ImageProtocolRequest<'dashscope-image-tasks'>,
      sink: ResumableImageProtocolEventSink,
    ): Promise<ImageProtocolTerminal> {
      try {
        const response = await request.transport.send({
          method: 'POST',
          headers: Object.freeze({}),
          body: JSON.stringify({
            model: request.model.upstreamModelId,
            input: { prompt: promptText(request) },
            parameters: {
              n: request.input.count,
              size: wireSize(request.input.size),
              ...(request.input.seed === undefined
                ? {}
                : { seed: request.input.seed }),
            },
          }),
          responseMode: 'bytes',
          signal: request.signal,
        });
        const value = await jsonBody(response.body);
        if (response.status < 200 || response.status >= 300)
          return {
            status: 'failed',
            error: providerError(response.status, value),
          };
        const envelope = requireRecord(value, 'DashScope task create response');
        const output = requireRecord(
          envelope.output,
          'DashScope task create output',
        );
        const taskId = validateDashScopeTaskId(output.task_id);
        await sink.setOperation({
          operationId: taskId,
          ...(typeof envelope.request_id === 'string'
            ? { operationState: { requestId: envelope.request_id } }
            : {}),
        });
        const pollTransport = await sink.operationTransport('poll');
        return pollLoop(
          {
            operationId: taskId,
            transport: pollTransport,
            signal: request.signal,
            pollIntervalMs: request.options.pollIntervalMs,
          },
          sink,
        );
      } catch (error) {
        return terminalFromError(error, request.signal);
      }
    },
    async resume(
      request: ImageResumeRequest<'dashscope-image-tasks'>,
      sink: ImageProtocolEventSink,
    ): Promise<ImageProtocolTerminal> {
      try {
        return await pollLoop(
          {
            operationId: validateDashScopeTaskId(request.operation.operationId),
            transport: request.pollTransport,
            signal: request.signal,
            pollIntervalMs: request.options.pollIntervalMs,
          },
          sink,
        );
      } catch (error) {
        return terminalFromError(error, request.signal);
      }
    },
    async cancel(
      request: ImageCancelRequest<'dashscope-image-tasks'>,
    ): Promise<void> {
      const response = await request.transport.send({
        method: 'POST',
        headers: Object.freeze({}),
        responseMode: 'bytes',
        signal: request.signal,
      });
      const value = await jsonBody(response.body);
      if (response.status < 200 || response.status >= 300)
        throw providerError(response.status, value);
    },
  });
}

async function pollLoop(
  input: {
    operationId: string;
    transport: ImageResumeRequest<'dashscope-image-tasks'>['pollTransport'];
    signal: AbortSignal;
    pollIntervalMs: number;
  },
  sink: ImageProtocolEventSink,
): Promise<ImageProtocolTerminal> {
  while (true) {
    const response = await input.transport.send({
      method: 'GET',
      headers: Object.freeze({}),
      responseMode: 'bytes',
      signal: input.signal,
    });
    const value = await jsonBody(response.body);
    if (response.status < 200 || response.status >= 300)
      return { status: 'failed', error: providerError(response.status, value) };
    const envelope = requireRecord(value, 'DashScope task response');
    const output = requireRecord(envelope.output, 'DashScope task output');
    const status = output.task_status;
    if (status === 'PENDING' || status === 'RUNNING') {
      await sink.publish({
        type: 'generation_progress',
        phase: status === 'PENDING' ? 'queued' : 'running',
      });
      await delay(input.pollIntervalMs, input.signal);
      continue;
    }
    if (status === 'SUCCEEDED') {
      const results = Array.isArray(output.results) ? output.results : [];
      let index = 0;
      for (const result of results) {
        if (!isRecord(result)) continue;
        const source =
          typeof result.url === 'string'
            ? { type: 'url' as const, url: result.url }
            : typeof result.b64_image === 'string'
              ? { type: 'base64' as const, data: result.b64_image }
              : undefined;
        if (!source) continue;
        await sink.publish({
          type: 'generation_output',
          outputIndex: index++,
          output: {
            type: 'image',
            image: { mediaType: 'image/png', source },
          },
        });
      }
      if (index === 0)
        throw invalidResponse('DashScope task returned no images');
      const usage = isRecord(envelope.usage) ? envelope.usage : undefined;
      return {
        status: 'completed',
        ...(typeof envelope.request_id === 'string'
          ? { responseId: envelope.request_id }
          : {}),
        ...(usage && Number.isInteger(usage.image_count)
          ? { usage: { generatedImages: usage.image_count as number } }
          : {}),
      };
    }
    if (status === 'CANCELED')
      return { status: 'cancelled', error: cancelledError() };
    const code =
      typeof output.code === 'string'
        ? output.code
        : 'DASHSCOPE_IMAGE_TASK_FAILED';
    const message =
      typeof output.message === 'string'
        ? output.message
        : `DashScope image task ${String(status ?? 'UNKNOWN')}`;
    return {
      status: 'failed',
      error: new AiRuntimeError(code, 'provider', message),
    };
  }
}

function promptText(
  request: ImageProtocolRequest<'dashscope-image-tasks'>,
): string {
  const references = request.input.content.filter(
    (part) => part.type === 'image',
  );
  if (references.length > 0)
    throw new AiRuntimeError(
      'DASHSCOPE_IMAGE_TASK_REFERENCE_UNSUPPORTED',
      'invalid_request',
      'DashScope image task profile does not support reference images',
    );
  return request.input.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}
export function validateDashScopeTaskId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    /[/?#\\]/u.test(value) ||
    decodeURIComponentSafe(value).includes('/')
  )
    throw new AiRuntimeError(
      'DASHSCOPE_TASK_ID_INVALID',
      'invalid_request',
      'DashScope task id is invalid',
    );
  return value;
}
function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '/';
  }
}
function wireSize(
  size: string | { readonly width: number; readonly height: number },
): string {
  if (typeof size === 'string') return size.replace('x', '*');
  return `${size.width}*${size.height}`;
}
async function jsonBody(body: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw invalidResponse('DashScope image task response is not valid JSON');
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResponse(`${name} is invalid`);
  return value;
}
function providerError(status: number, value: unknown): AiError {
  const record = isRecord(value) ? value : {};
  return new AiRuntimeError(
    typeof record.code === 'string'
      ? record.code
      : 'DASHSCOPE_IMAGE_TASK_ERROR',
    status === 429
      ? 'rate_limit'
      : status >= 500
        ? 'provider'
        : 'invalid_request',
    typeof record.message === 'string'
      ? record.message
      : `DashScope image task request failed with HTTP ${status}`,
    status === 429 || status >= 500,
  );
}
function invalidResponse(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'DASHSCOPE_IMAGE_TASK_RESPONSE_INVALID',
    'invalid_response',
    message,
  );
}
function terminalFromError(
  error: unknown,
  signal: AbortSignal,
): ImageProtocolTerminal {
  if (signal.aborted) return { status: 'cancelled', error: cancelledError() };
  return {
    status: 'failed',
    error:
      error instanceof AiRuntimeError
        ? error
        : new AiRuntimeError(
            'DASHSCOPE_IMAGE_TASK_FAILED',
            'protocol',
            error instanceof Error
              ? error.message
              : 'DashScope image task failed',
          ),
  };
}
function cancelledError(): AiError & { readonly category: 'cancelled' } {
  return new AiRuntimeError(
    'IMAGE_CANCELLED',
    'cancelled',
    'image generation was cancelled',
  ) as AiError & { readonly category: 'cancelled' };
}
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
