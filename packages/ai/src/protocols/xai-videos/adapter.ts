import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type { JsonValue } from '../../core/content.js';
import type {
  ResumableVideoProtocolAdapter,
  ResumableVideoProtocolEventSink,
  VideoProtocolContract,
  VideoProtocolEventSink,
  VideoProtocolRequest,
  VideoProtocolTerminal,
  VideoResumeRequest,
} from '../../videos/contracts.js';

export interface XAiVideosCompatibility {
  readonly wireVersion: 1;
  readonly api: 'xai-v1';
}
export type XAiVideosOptions = Readonly<Record<string, never>>;

declare module '../../videos/contracts.js' {
  interface VideoProtocolOptionsMap {
    'xai-videos': XAiVideosOptions;
  }
  interface VideoProtocolCompatibilityMap {
    'xai-videos': XAiVideosCompatibility;
  }
}

export const xAiVideosContract: VideoProtocolContract<'xai-videos'> =
  Object.freeze({
    parseOptions(input: unknown): XAiVideosOptions {
      if (!isRecord(input) || Object.keys(input).length !== 0)
        throw new AiRuntimeError(
          'XAI_VIDEOS_OPTIONS_INVALID',
          'invalid_request',
          'xAI Videos does not accept protocol extension fields',
        );
      return Object.freeze({});
    },
    mergeOptions(layers: readonly (XAiVideosOptions | undefined)[]) {
      for (const layer of layers) this.parseOptions(layer ?? {});
      return Object.freeze({});
    },
    parseCompatibility(input: unknown): XAiVideosCompatibility {
      if (
        !isRecord(input) ||
        input.wireVersion !== 1 ||
        input.api !== 'xai-v1' ||
        Object.keys(input).length !== 2
      )
        throw new AiRuntimeError(
          'XAI_VIDEOS_COMPATIBILITY_INVALID',
          'invalid_request',
          'invalid xAI Videos compatibility profile',
        );
      return Object.freeze({ wireVersion: 1, api: 'xai-v1' });
    },
  });

export function createXAiVideosAdapter(): ResumableVideoProtocolAdapter<'xai-videos'> {
  return Object.freeze({
    id: 'xai-videos',
    operationMode: 'resumable',
    contract: xAiVideosContract,
    parseOperationState(input: unknown): JsonValue | undefined {
      if (input === undefined) return undefined;
      if (
        !isRecord(input) ||
        Object.keys(input).some((key) => key !== 'requestId')
      )
        return undefined;
      if (input.requestId !== undefined && !validOpaqueId(input.requestId))
        return undefined;
      return input as JsonValue;
    },
    async run(
      request: VideoProtocolRequest<'xai-videos'>,
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
        const envelope = requireRecord(value, 'xAI video create response');
        const requestId = validateXAiVideoRequestId(
          envelope.request_id ?? envelope.id,
        );
        await sink.setOperation({
          operationId: requestId,
          operationState: { requestId },
          ...(providerExpiry(envelope) === undefined
            ? {}
            : { providerExpiresAt: providerExpiry(envelope)! }),
        });
        const pollTransport = await sink.operationTransport('poll');
        return pollLoop(
          {
            requestId,
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
      request: VideoResumeRequest<'xai-videos'>,
      sink: VideoProtocolEventSink,
    ): Promise<VideoProtocolTerminal> {
      try {
        return await pollLoop(
          {
            requestId: validateXAiVideoRequestId(request.operation.operationId),
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
  request: VideoProtocolRequest<'xai-videos'>,
): Record<string, unknown> {
  const prompt = request.input.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
  const images = request.input.content.filter((part) => part.type === 'image');
  const videos = request.input.content.filter((part) => part.type === 'video');
  const audios = request.input.content.filter((part) => part.type === 'audio');
  if (audios.length > 0)
    throw unsupported(
      'XAI_VIDEO_AUDIO_INPUT_UNSUPPORTED',
      'xAI Videos does not accept audio input',
    );
  if (request.input.fps !== undefined)
    throw unsupported(
      'XAI_VIDEO_FPS_UNSUPPORTED',
      'xAI Videos does not accept an fps control',
    );
  if (request.input.seed !== undefined)
    throw unsupported(
      'XAI_VIDEO_SEED_UNSUPPORTED',
      'xAI Videos does not accept a seed',
    );
  if (!request.input.generateAudio)
    throw unsupported(
      'XAI_VIDEO_AUDIO_CONTROL_UNSUPPORTED',
      'xAI Videos does not support disabling generated audio',
    );
  if (request.input.count !== 1)
    throw unsupported(
      'XAI_VIDEO_COUNT_UNSUPPORTED',
      'xAI Videos creates one video per request',
    );

  if (request.input.operation === 'generate') {
    if (videos.length > 0)
      throw unsupported(
        'XAI_VIDEO_SOURCE_UNEXPECTED',
        'xAI video generation does not accept a source video',
      );
    const image = images[0];
    return compact({
      model: request.model.upstreamModelId,
      prompt,
      duration: request.input.durationSeconds,
      resolution: wireResolution(request.input.resolution),
      aspect_ratio: request.input.aspectRatio,
      ...(image ? { image: { url: resourceValue(image.image) } } : {}),
    });
  }

  if (images.length > 0)
    throw unsupported(
      'XAI_VIDEO_IMAGE_UNSUPPORTED',
      `xAI video ${request.input.operation} does not accept image input`,
    );
  if (
    request.input.durationSeconds !== undefined ||
    request.input.resolution !== undefined ||
    request.input.aspectRatio !== undefined
  )
    throw unsupported(
      'XAI_VIDEO_OUTPUT_CONTROL_UNSUPPORTED',
      `xAI video ${request.input.operation} does not accept output controls`,
    );
  const source = videos.find((part) => part.role === 'source');
  if (!source)
    throw unsupported(
      'XAI_VIDEO_SOURCE_REQUIRED',
      `xAI video ${request.input.operation} requires a source video`,
    );
  if (
    request.input.operation === 'edit' &&
    source.video.durationSeconds !== undefined &&
    source.video.durationSeconds > 8.7
  )
    throw unsupported(
      'XAI_VIDEO_EDIT_DURATION_UNSUPPORTED',
      'xAI video edit source duration cannot exceed 8.7 seconds',
    );
  return {
    model: request.model.upstreamModelId,
    prompt,
    video: { url: resourceValue(source.video) },
  };
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function unsupported(code: string, message: string): AiRuntimeError {
  return new AiRuntimeError(code, 'invalid_request', message);
}

async function pollLoop(
  input: {
    requestId: string;
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
    const envelope = requireRecord(value, 'xAI video status response');
    const status = String(envelope.status ?? '').toLowerCase();
    if (
      status === 'pending' ||
      status === 'queued' ||
      status === 'processing' ||
      status === 'in_progress'
    ) {
      await sink.publish({
        type: 'generation_progress',
        phase:
          status === 'queued' || status === 'pending' ? 'queued' : 'running',
        ...(numberInRange(envelope.progress, 0, 1) === undefined
          ? {}
          : { progress: numberInRange(envelope.progress, 0, 1)! }),
      });
      await delay(input.pollIntervalMs, input.signal);
      continue;
    }
    if (status === 'done' || status === 'completed' || status === 'succeeded') {
      const video = isRecord(envelope.video) ? envelope.video : envelope;
      const url =
        typeof video.url === 'string'
          ? video.url
          : typeof envelope.url === 'string'
            ? envelope.url
            : undefined;
      if (!url) throw invalidResponse('xAI video response has no output URL');
      const durationSeconds = positiveNumber(
        video.duration ?? video.duration_seconds ?? envelope.duration,
      );
      const expiresAt = parseExpiry(video.expires_at ?? envelope.expires_at);
      await sink.publish({
        type: 'generation_output',
        outputIndex: 0,
        output: {
          type: 'video',
          video: {
            artifact: {
              mediaType:
                typeof video.mime_type === 'string'
                  ? video.mime_type
                  : 'video/mp4',
              source: {
                type: 'url',
                url,
                ...(expiresAt === undefined ? {} : { expiresAt }),
              },
            },
            ...(durationSeconds === undefined ? {} : { durationSeconds }),
            ...(positiveInteger(video.width) === undefined
              ? {}
              : { width: positiveInteger(video.width)! }),
            ...(positiveInteger(video.height) === undefined
              ? {}
              : { height: positiveInteger(video.height)! }),
            ...(positiveNumber(video.fps) === undefined
              ? {}
              : { fps: positiveNumber(video.fps)! }),
            ...(typeof video.has_audio === 'boolean'
              ? { hasAudio: video.has_audio }
              : {}),
          },
        },
      });
      return {
        status: 'completed',
        responseId: input.requestId,
        usage: {
          generatedVideos: 1,
          ...(durationSeconds === undefined
            ? {}
            : { generatedSeconds: durationSeconds }),
        },
      };
    }
    if (status === 'expired')
      return {
        status: 'failed',
        error: new AiRuntimeError(
          'XAI_VIDEO_EXPIRED',
          'provider',
          'xAI video operation expired',
        ),
      };
    const error = isRecord(envelope.error) ? envelope.error : envelope;
    return {
      status: 'failed',
      error: new AiRuntimeError(
        typeof error.code === 'string' ? error.code : 'XAI_VIDEO_FAILED',
        'provider',
        typeof error.message === 'string'
          ? error.message
          : `xAI video operation ${status || 'failed'}`,
      ),
    };
  }
}

export function validateXAiVideoRequestId(value: unknown): string {
  if (!validOpaqueId(value))
    throw new AiRuntimeError(
      'XAI_VIDEO_REQUEST_ID_INVALID',
      'invalid_request',
      'xAI video request id is invalid',
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
function resourceValue(resource: {
  mediaType: string;
  source: { type: 'url'; url: string } | { type: 'base64'; data: string };
}): string {
  return resource.source.type === 'url'
    ? resource.source.url
    : `data:${resource.mediaType};base64,${resource.source.data}`;
}
function wireResolution(
  value: import('../../videos/models.js').VideoResolution | undefined,
): string | undefined {
  if (value === undefined || typeof value === 'string') return value;
  return `${value.width}x${value.height}`;
}
function providerExpiry(envelope: Record<string, unknown>): number | undefined {
  return parseExpiry(envelope.expires_at);
}
function parseExpiry(value: unknown): number | undefined {
  if (Number.isSafeInteger(value) && (value as number) > 0)
    return (value as number) < 10_000_000_000
      ? (value as number) * 1000
      : (value as number);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
function positiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) > 0
    ? (value as number)
    : undefined;
}
function numberInRange(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined;
}
async function jsonBody(body: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw invalidResponse('xAI video response is not valid JSON');
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
    typeof error.code === 'string' ? error.code : 'XAI_VIDEO_ERROR',
    status === 429
      ? 'rate_limit'
      : status >= 500
        ? 'provider'
        : 'invalid_request',
    typeof error.message === 'string'
      ? error.message
      : `xAI video request failed with HTTP ${status}`,
    status === 429 || status >= 500,
  );
}
function invalidResponse(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'XAI_VIDEO_RESPONSE_INVALID',
    'invalid_response',
    message,
  );
}
function terminalFromError(
  error: unknown,
  signal: AbortSignal,
): VideoProtocolTerminal {
  if (signal.aborted)
    return {
      status: 'cancelled',
      error: new AiRuntimeError(
        'VIDEO_CANCELLED',
        'cancelled',
        'video generation was cancelled',
      ) as AiError & { readonly category: 'cancelled' },
    };
  return {
    status: 'failed',
    error:
      error instanceof AiRuntimeError
        ? error
        : new AiRuntimeError(
            'XAI_VIDEO_FAILED',
            'protocol',
            error instanceof Error
              ? error.message
              : 'xAI video generation failed',
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
