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

export interface ArkVideoTasksCompatibility {
  readonly wireVersion: 1;
  readonly taskApi: 'ark-contents-generations-v3';
  readonly modelFamily: 'seedance-2';
}
export type ArkVideoTasksOptions = Readonly<Record<string, never>>;

declare module '../../videos/contracts.js' {
  interface VideoProtocolOptionsMap {
    'ark-video-tasks': ArkVideoTasksOptions;
  }
  interface VideoProtocolCompatibilityMap {
    'ark-video-tasks': ArkVideoTasksCompatibility;
  }
}

export const arkVideoTasksContract: VideoProtocolContract<'ark-video-tasks'> =
  Object.freeze({
    parseOptions(input: unknown): ArkVideoTasksOptions {
      if (!isRecord(input) || Object.keys(input).length !== 0)
        throw new AiRuntimeError(
          'ARK_VIDEO_TASKS_OPTIONS_INVALID',
          'invalid_request',
          'Ark video tasks does not accept protocol extension fields',
        );
      return Object.freeze({});
    },
    mergeOptions(layers: readonly (ArkVideoTasksOptions | undefined)[]) {
      for (const layer of layers) this.parseOptions(layer ?? {});
      return Object.freeze({});
    },
    parseCompatibility(input: unknown): ArkVideoTasksCompatibility {
      if (
        !isRecord(input) ||
        input.wireVersion !== 1 ||
        input.taskApi !== 'ark-contents-generations-v3' ||
        input.modelFamily !== 'seedance-2' ||
        Object.keys(input).length !== 3
      )
        throw new AiRuntimeError(
          'ARK_VIDEO_TASKS_COMPATIBILITY_INVALID',
          'invalid_request',
          'invalid Ark Seedance video task compatibility profile',
        );
      return Object.freeze({
        wireVersion: 1,
        taskApi: 'ark-contents-generations-v3',
        modelFamily: 'seedance-2',
      });
    },
  });

export function createArkVideoTasksAdapter(): ResumableVideoProtocolAdapter<'ark-video-tasks'> {
  return Object.freeze({
    id: 'ark-video-tasks',
    operationMode: 'resumable',
    contract: arkVideoTasksContract,
    parseOperationState(input: unknown): JsonValue | undefined {
      if (input === undefined) return undefined;
      if (
        !isRecord(input) ||
        Object.keys(input).some((key) => key !== 'taskId')
      )
        return undefined;
      if (input.taskId !== undefined && !validOpaqueId(input.taskId))
        return undefined;
      return input as JsonValue;
    },
    async run(
      request: VideoProtocolRequest<'ark-video-tasks'>,
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
        const envelope = requireRecord(value, 'Ark video task create response');
        const taskId = validateArkVideoTaskId(envelope.id);
        await sink.setOperation({
          operationId: taskId,
          operationState: { taskId },
        });
        return pollLoop(
          {
            taskId,
            transport: await sink.operationTransport('poll'),
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
      request: VideoResumeRequest<'ark-video-tasks'>,
      sink: VideoProtocolEventSink,
    ): Promise<VideoProtocolTerminal> {
      try {
        return await pollLoop(
          {
            taskId: validateArkVideoTaskId(request.operation.operationId),
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
  });
}

function createBody(
  request: VideoProtocolRequest<'ark-video-tasks'>,
): Record<string, unknown> {
  if (request.input.operation !== 'generate')
    throw unsupported(
      'ARK_VIDEO_OPERATION_UNSUPPORTED',
      'Seedance 2.0 only supports generation tasks',
    );
  if (request.input.fps !== undefined)
    throw unsupported(
      'ARK_VIDEO_FPS_UNSUPPORTED',
      'Seedance 2.0 has a fixed 24 fps output',
    );
  if (request.input.count !== 1)
    throw unsupported(
      'ARK_VIDEO_COUNT_UNSUPPORTED',
      'Seedance 2.0 creates one video per task',
    );
  if (
    request.input.seed !== undefined &&
    (!Number.isInteger(request.input.seed) ||
      request.input.seed < -1 ||
      request.input.seed > 4_294_967_295)
  )
    throw unsupported(
      'ARK_VIDEO_SEED_INVALID',
      'Seedance 2.0 seed must be an integer from -1 through 4294967295',
    );
  if (request.input.content.length > 5)
    throw unsupported(
      'ARK_VIDEO_CONTENT_LIMIT',
      'Seedance 2.0 accepts at most five content items',
    );

  const content = request.input.content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'image') {
      if (part.role !== 'reference')
        throw unsupported(
          'ARK_VIDEO_IMAGE_ROLE_UNSUPPORTED',
          'Seedance 2.0 only accepts reference images',
        );
      return {
        type: 'image_url',
        image_url: { url: resourceUrl(part.image) },
        role: 'reference_image',
      };
    }
    if (part.type === 'video') {
      if (part.role !== 'reference')
        throw unsupported(
          'ARK_VIDEO_SOURCE_ROLE_UNSUPPORTED',
          'Seedance 2.0 only accepts reference videos',
        );
      return {
        type: 'video_url',
        video_url: { url: resourceUrl(part.video) },
        role: 'reference_video',
      };
    }
    if (part.role !== 'reference')
      throw unsupported(
        'ARK_VIDEO_AUDIO_ROLE_UNSUPPORTED',
        'Seedance 2.0 only accepts reference audio',
      );
    return {
      type: 'audio_url',
      audio_url: { url: resourceUrl(part.audio) },
      role: 'reference_audio',
    };
  });

  return compact({
    model: request.model.upstreamModelId,
    content,
    duration: request.input.durationSeconds,
    resolution: wireResolution(request.input.resolution),
    ratio:
      request.input.aspectRatio === 'auto'
        ? 'adaptive'
        : request.input.aspectRatio,
    generate_audio: request.input.generateAudio,
    seed: request.input.seed,
  });
}

async function pollLoop(
  input: {
    taskId: string;
    transport: import('../../transport/types.js').RequestTransport;
    signal: AbortSignal;
    pollIntervalMs: number;
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
    const envelope = requireRecord(value, 'Ark video task status response');
    const status = String(envelope.status ?? '').toLowerCase();
    if (status === 'queued' || status === 'running') {
      await sink.publish({
        type: 'generation_progress',
        phase: status === 'queued' ? 'queued' : 'running',
      });
      await delay(input.pollIntervalMs, input.signal);
      continue;
    }
    if (status === 'succeeded') {
      const content = requireRecord(envelope.content, 'Ark video task content');
      if (typeof content.video_url !== 'string')
        throw invalidResponse('Ark video task response has no video URL');
      const durationSeconds = positiveNumber(envelope.duration);
      const fps = positiveNumber(envelope.framespersecond);
      const expiresAt = artifactExpiry(envelope.updated_at);
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
                url: content.video_url,
                ...(expiresAt === undefined ? {} : { expiresAt }),
              },
            },
            ...(typeof content.last_frame_url === 'string'
              ? {
                  poster: {
                    mediaType: 'image/jpeg',
                    source: {
                      type: 'url' as const,
                      url: content.last_frame_url,
                      ...(expiresAt === undefined ? {} : { expiresAt }),
                    },
                  },
                }
              : {}),
            ...(durationSeconds === undefined ? {} : { durationSeconds }),
            ...(fps === undefined ? {} : { fps }),
            ...(typeof envelope.generate_audio === 'boolean'
              ? { hasAudio: envelope.generate_audio }
              : {}),
            metadata: compactJson({
              ratio: envelope.ratio,
              resolution: envelope.resolution,
              seed: envelope.seed,
              ...(isRecord(envelope.usage)
                ? { providerUsage: envelope.usage }
                : {}),
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
    if (status === 'cancelled')
      return cancelledTerminal('provider cancelled task');
    if (status === 'expired')
      return {
        status: 'failed',
        error: new AiRuntimeError(
          'ARK_VIDEO_TASK_EXPIRED',
          'provider',
          'Ark video task expired',
        ),
      };
    const error = isRecord(envelope.error) ? envelope.error : envelope;
    return {
      status: 'failed',
      error: new AiRuntimeError(
        typeof error.code === 'string' ? error.code : 'ARK_VIDEO_TASK_FAILED',
        'provider',
        typeof error.message === 'string'
          ? error.message
          : `Ark video task ${status || 'failed'}`,
      ),
    };
  }
}

export function validateArkVideoTaskId(value: unknown): string {
  if (!validOpaqueId(value))
    throw new AiRuntimeError(
      'ARK_VIDEO_TASK_ID_INVALID',
      'invalid_request',
      'Ark video task id is invalid',
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
      'ARK_VIDEO_RESOURCE_URL_REQUIRED',
      'Ark Seedance media inputs must use official URL resources',
    );
  return resource.source.url;
}
function wireResolution(
  value: import('../../videos/models.js').VideoResolution | undefined,
): string | undefined {
  if (value === undefined || typeof value === 'string') return value;
  throw unsupported(
    'ARK_VIDEO_RESOLUTION_UNSUPPORTED',
    'Ark Seedance requires a named resolution',
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
  return milliseconds + 24 * 60 * 60 * 1000;
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
    throw invalidResponse('Ark video task response is not valid JSON');
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
    typeof error.code === 'string' ? error.code : 'ARK_VIDEO_TASK_ERROR',
    status === 429
      ? 'rate_limit'
      : status >= 500
        ? 'provider'
        : 'invalid_request',
    typeof error.message === 'string'
      ? error.message
      : `Ark video task request failed with HTTP ${status}`,
    status === 429 || status >= 500,
  );
}
function invalidResponse(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'ARK_VIDEO_TASK_RESPONSE_INVALID',
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
            'ARK_VIDEO_TASK_FAILED',
            'protocol',
            error instanceof Error
              ? error.message
              : 'Ark video task generation failed',
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
