import type { JsonValue } from '../../core/content.js';
import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type {
  ResumableVideoProtocolAdapter,
  ResumableVideoProtocolEventSink,
  VideoProtocolContract,
  VideoProtocolEventSink,
  VideoProtocolRequest,
  VideoProtocolTerminal,
  VideoResumeRequest,
} from '../../videos/contracts.js';

export interface KlingVideoTasksCompatibility {
  readonly wireVersion: 2;
  readonly taskApi: 'kling-api-v2';
  readonly modelFamily: 'kling-video-3.0-omni';
}
export type KlingVideoTasksOptions = Readonly<Record<string, never>>;

declare module '../../videos/contracts.js' {
  interface VideoProtocolOptionsMap {
    'kling-video-tasks': KlingVideoTasksOptions;
  }
  interface VideoProtocolCompatibilityMap {
    'kling-video-tasks': KlingVideoTasksCompatibility;
  }
}

export const klingVideoTasksContract: VideoProtocolContract<'kling-video-tasks'> =
  Object.freeze({
    parseOptions(input: unknown): KlingVideoTasksOptions {
      if (!isRecord(input) || Object.keys(input).length !== 0)
        throw new AiRuntimeError(
          'KLING_VIDEO_TASKS_OPTIONS_INVALID',
          'invalid_request',
          'Kling video tasks does not accept protocol extension fields',
        );
      return Object.freeze({});
    },
    mergeOptions(layers: readonly (KlingVideoTasksOptions | undefined)[]) {
      for (const layer of layers) this.parseOptions(layer ?? {});
      return Object.freeze({});
    },
    parseCompatibility(input: unknown): KlingVideoTasksCompatibility {
      if (
        !isRecord(input) ||
        input.wireVersion !== 2 ||
        input.taskApi !== 'kling-api-v2' ||
        input.modelFamily !== 'kling-video-3.0-omni' ||
        Object.keys(input).length !== 3
      )
        throw new AiRuntimeError(
          'KLING_VIDEO_TASKS_COMPATIBILITY_INVALID',
          'invalid_request',
          'invalid Kling VIDEO 3.0 Omni video task compatibility profile',
        );
      return Object.freeze({
        wireVersion: 2,
        taskApi: 'kling-api-v2',
        modelFamily: 'kling-video-3.0-omni',
      });
    },
  });

export function createKlingVideoTasksAdapter(): ResumableVideoProtocolAdapter<'kling-video-tasks'> {
  return Object.freeze({
    id: 'kling-video-tasks',
    operationMode: 'resumable',
    contract: klingVideoTasksContract,
    parseOperationState(input: unknown): JsonValue | undefined {
      if (input === undefined) return undefined;
      if (
        !isRecord(input) ||
        Object.keys(input).some(
          (key) => !['taskId', 'generateAudio'].includes(key),
        )
      )
        return undefined;
      if (input.taskId !== undefined && !validOpaqueId(input.taskId))
        return undefined;
      if (
        input.generateAudio !== undefined &&
        typeof input.generateAudio !== 'boolean'
      )
        return undefined;
      return input as JsonValue;
    },
    async run(
      request: VideoProtocolRequest<'kling-video-tasks'>,
      sink: ResumableVideoProtocolEventSink,
    ): Promise<VideoProtocolTerminal> {
      try {
        const response = await request.transport.send({
          method: 'POST',
          headers: Object.freeze({}),
          body: JSON.stringify(createBody(request)),
          responseMode: 'bytes',
          signal: request.signal,
        });
        const value = await jsonBody(response.body);
        if (response.status < 200 || response.status >= 300)
          return {
            status: 'failed',
            error: providerError(response.status, value),
          };
        const envelope = requireRecord(
          value,
          'Kling video task create response',
        );
        const data = requireRecord(
          envelope.data,
          'Kling video task create data',
        );
        const taskId = validateKlingVideoTaskId(data.id);
        await sink.setOperation({
          operationId: taskId,
          operationState: {
            taskId,
            generateAudio: request.input.generateAudio,
          },
        });
        return pollLoop(
          {
            taskId,
            transport: await sink.operationTransport('poll'),
            signal: request.signal,
            pollIntervalMs: request.options.pollIntervalMs,
            generateAudio: request.input.generateAudio,
          },
          sink,
        );
      } catch (error) {
        return terminalFromError(error, request.signal);
      }
    },
    async resume(
      request: VideoResumeRequest<'kling-video-tasks'>,
      sink: VideoProtocolEventSink,
    ): Promise<VideoProtocolTerminal> {
      try {
        return await pollLoop(
          {
            taskId: validateKlingVideoTaskId(request.operation.operationId),
            transport: request.pollTransport,
            signal: request.signal,
            pollIntervalMs: request.options.pollIntervalMs,
            generateAudio:
              isRecord(request.operation.operationState) &&
              typeof request.operation.operationState.generateAudio ===
                'boolean'
                ? request.operation.operationState.generateAudio
                : undefined,
          },
          sink,
        );
      } catch (error) {
        return terminalFromError(error, request.signal);
      }
    },
  });
}

function createBody(
  request: VideoProtocolRequest<'kling-video-tasks'>,
): Record<string, unknown> {
  if (request.input.operation !== 'generate')
    throw unsupported(
      'KLING_VIDEO_OPERATION_UNSUPPORTED',
      'Kling VIDEO 3.0 Omni only supports generation tasks',
    );
  if (request.input.fps !== undefined)
    throw unsupported(
      'KLING_VIDEO_FPS_UNSUPPORTED',
      'Kling VIDEO 3.0 Omni has a fixed 24 fps output',
    );
  if (request.input.seed !== undefined)
    throw unsupported(
      'KLING_VIDEO_SEED_UNSUPPORTED',
      'Kling VIDEO 3.0 Omni does not expose a seed control',
    );
  if (request.input.count !== 1)
    throw unsupported(
      'KLING_VIDEO_COUNT_UNSUPPORTED',
      'Kling VIDEO 3.0 Omni creates one video per task',
    );

  let imageIndex = 0;
  const contents = request.input.content.map((part) => {
    if (part.type === 'text') return { type: 'prompt', text: part.text };
    if (part.type !== 'image')
      throw unsupported(
        'KLING_VIDEO_MEDIA_UNSUPPORTED',
        'Kling VIDEO 3.0 Omni adapter accepts text and image inputs only',
      );
    const type =
      part.role === 'first_frame'
        ? 'first_frame'
        : part.role === 'last_frame'
          ? 'last_frame'
          : part.role === 'reference'
            ? 'refer_image'
            : undefined;
    if (!type)
      throw unsupported(
        'KLING_VIDEO_IMAGE_ROLE_UNSUPPORTED',
        'Kling VIDEO 3.0 Omni accepts first_frame, last_frame, and reference images',
      );
    imageIndex += 1;
    return {
      type,
      url: resourceUrl(part.image),
      id: `image_${imageIndex}`,
    };
  });

  return {
    contents,
    settings: compact({
      resolution: wireResolution(request.input.resolution),
      aspect_ratio: request.input.aspectRatio,
      duration: request.input.durationSeconds,
      audio: request.input.generateAudio ? 'native' : 'off',
      multi_shot: false,
    }),
  };
}

async function pollLoop(
  input: {
    taskId: string;
    transport: import('../../transport/types.js').RequestTransport;
    signal: AbortSignal;
    pollIntervalMs: number;
    generateAudio?: boolean;
  },
  sink: VideoProtocolEventSink,
): Promise<VideoProtocolTerminal> {
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
    const envelope = requireRecord(value, 'Kling video task status response');
    if (typeof envelope.code === 'number' && envelope.code !== 0)
      return { status: 'failed', error: providerError(response.status, value) };
    if (!Array.isArray(envelope.data) || envelope.data.length !== 1)
      throw invalidResponse('Kling video task response must contain one task');
    const task = requireRecord(envelope.data[0], 'Kling video task');
    if (validateKlingVideoTaskId(task.id) !== input.taskId)
      throw invalidResponse(
        'Kling video task response id does not match query',
      );
    const status = String(task.status ?? '').toLowerCase();
    if (status === 'submitted' || status === 'processing') {
      await sink.publish({
        type: 'generation_progress',
        phase: status === 'submitted' ? 'queued' : 'running',
      });
      await delay(input.pollIntervalMs, input.signal);
      continue;
    }
    if (status === 'succeeded') {
      const expiresAt = artifactExpiry(task.update_time);
      if (expiresAt !== undefined && Date.now() >= expiresAt)
        return {
          status: 'failed',
          error: new AiRuntimeError(
            'KLING_VIDEO_TASK_EXPIRED',
            'provider',
            'Kling video task artifact retention period has expired',
          ),
        };
      if (!Array.isArray(task.outputs))
        throw invalidResponse('Kling video task response has no outputs');
      const output = task.outputs.find(
        (candidate) => isRecord(candidate) && candidate.type === 'video',
      );
      if (!isRecord(output) || typeof output.url !== 'string')
        throw invalidResponse('Kling video task response has no video URL');
      const durationSeconds = positiveNumber(
        typeof output.duration === 'string'
          ? Number(output.duration)
          : output.duration,
      );
      await sink.publish({
        type: 'generation_output',
        outputIndex: 0,
        output: {
          type: 'video',
          video: {
            artifact: {
              mediaType: 'video/mp4',
              source: {
                type: 'url',
                url: output.url,
                ...(expiresAt === undefined ? {} : { expiresAt }),
              },
            },
            ...(durationSeconds === undefined ? {} : { durationSeconds }),
            fps: 24,
            ...(input.generateAudio === undefined
              ? {}
              : { hasAudio: input.generateAudio }),
            metadata: compactJson({
              providerOutputId: output.id,
              watermarkUrl: output.watermark_url,
              billing: task.billing,
              requestId: envelope.request_id,
            }),
          },
        },
      });
      return {
        status: 'completed',
        responseId: input.taskId,
        usage: {
          generatedVideos: 1,
          ...(durationSeconds === undefined
            ? {}
            : { generatedSeconds: durationSeconds }),
        },
      };
    }
    const error = isRecord(task.error) ? task.error : task;
    return {
      status: 'failed',
      error: new AiRuntimeError(
        typeof error.code === 'string' ? error.code : 'KLING_VIDEO_TASK_FAILED',
        'provider',
        typeof error.message === 'string'
          ? error.message
          : `Kling video task ${status || 'failed'}`,
      ),
    };
  }
}

export function validateKlingVideoTaskId(value: unknown): string {
  if (!validOpaqueId(value))
    throw new AiRuntimeError(
      'KLING_VIDEO_TASK_ID_INVALID',
      'invalid_request',
      'Kling video task id is invalid',
    );
  return value;
}

function validOpaqueId(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 512 ||
    /[/?#\\]/u.test(value)
  )
    return false;
  try {
    return !decodeURIComponent(value).includes('/');
  } catch {
    return false;
  }
}
function resourceUrl(resource: {
  source: { type: 'url'; url: string } | { type: 'base64'; data: string };
}): string {
  if (resource.source.type !== 'url')
    throw unsupported(
      'KLING_VIDEO_RESOURCE_URL_REQUIRED',
      'Kling VIDEO 3.0 Omni media inputs must use official URL resources',
    );
  return resource.source.url;
}
function wireResolution(
  value: import('../../videos/models.js').VideoResolution | undefined,
): string | undefined {
  if (value === undefined || typeof value === 'string') return value;
  throw unsupported(
    'KLING_VIDEO_RESOLUTION_UNSUPPORTED',
    'Kling VIDEO 3.0 Omni requires a named resolution',
  );
}
function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
function compactJson(
  input: Record<string, unknown>,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, JsonValue] =>
      isJsonValue(entry[1]),
    ),
  );
}
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
    return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
function artifactExpiry(updatedAt: unknown): number | undefined {
  if (!Number.isSafeInteger(updatedAt) || (updatedAt as number) <= 0)
    return undefined;
  const milliseconds =
    (updatedAt as number) < 10_000_000_000
      ? (updatedAt as number) * 1000
      : (updatedAt as number);
  return milliseconds + 30 * 24 * 60 * 60 * 1000;
}
function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
function unsupported(code: string, message: string): AiRuntimeError {
  return new AiRuntimeError(code, 'invalid_request', message);
}
async function jsonBody(body: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw invalidResponse('Kling video task response is not valid JSON');
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
  const error = isRecord(record.error) ? record.error : record;
  return new AiRuntimeError(
    typeof error.code === 'string' ? error.code : 'KLING_VIDEO_TASK_ERROR',
    status === 429
      ? 'rate_limit'
      : status >= 500
        ? 'provider'
        : 'invalid_request',
    typeof error.message === 'string'
      ? error.message
      : `Kling video task request failed with HTTP ${status}`,
    status === 429 || status >= 500,
  );
}
function invalidResponse(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'KLING_VIDEO_TASK_RESPONSE_INVALID',
    'invalid_response',
    message,
  );
}
function cancelledTerminal(message: string): VideoProtocolTerminal {
  return {
    status: 'cancelled',
    error: new AiRuntimeError(
      'VIDEO_CANCELLED',
      'cancelled',
      message,
    ) as AiError & { readonly category: 'cancelled' },
  };
}
function terminalFromError(
  error: unknown,
  signal: AbortSignal,
): VideoProtocolTerminal {
  if (signal.aborted)
    return cancelledTerminal('video generation was cancelled');
  return {
    status: 'failed',
    error:
      error instanceof AiRuntimeError
        ? error
        : new AiRuntimeError(
            'KLING_VIDEO_TASK_FAILED',
            'protocol',
            error instanceof Error
              ? error.message
              : 'Kling video task generation failed',
          ),
  };
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
