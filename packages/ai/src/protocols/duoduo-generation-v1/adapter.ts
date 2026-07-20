import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type { AiDiagnostic } from '../../core/events.js';
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
import type {
  VideoCancelRequest,
  VideoProtocolContract,
  VideoProtocolEventSink,
  VideoProtocolRequest,
  VideoProtocolTerminal,
  VideoResumeRequest,
  ResumableVideoProtocolAdapter,
  ResumableVideoProtocolEventSink,
} from '../../videos/contracts.js';
import type {
  DuoduoGenerationGateway,
  DuoduoGenerationGatewayTask,
} from './contracts.js';

export interface DuoduoGenerationCompatibility {
  readonly wireVersion: 1;
  readonly taskApi: 'duoduo-generation-v1';
}
export type DuoduoGenerationOptions = Readonly<Record<string, never>>;

declare module '../../images/contracts.js' {
  interface ImageProtocolOptionsMap {
    'duoduo-generation-v1': DuoduoGenerationOptions;
  }
  interface ImageProtocolCompatibilityMap {
    'duoduo-generation-v1': DuoduoGenerationCompatibility;
  }
}
declare module '../../videos/contracts.js' {
  interface VideoProtocolOptionsMap {
    'duoduo-generation-v1': DuoduoGenerationOptions;
  }
  interface VideoProtocolCompatibilityMap {
    'duoduo-generation-v1': DuoduoGenerationCompatibility;
  }
}

function contract<
  T extends
    | ImageProtocolContract<'duoduo-generation-v1'>
    | VideoProtocolContract<'duoduo-generation-v1'>,
>(): T {
  return Object.freeze({
    parseOptions(input: unknown) {
      if (!isRecord(input) || Object.keys(input).length !== 0)
        throw invalid('protocol options must be empty');
      return Object.freeze({});
    },
    mergeOptions(layers: readonly (DuoduoGenerationOptions | undefined)[]) {
      for (const layer of layers)
        if (layer !== undefined && Object.keys(layer).length !== 0)
          throw invalid('protocol options must be empty');
      return Object.freeze({});
    },
    parseCompatibility(input: unknown) {
      if (
        !isRecord(input) ||
        input.wireVersion !== 1 ||
        input.taskApi !== 'duoduo-generation-v1' ||
        Object.keys(input).length !== 2
      )
        throw invalid('invalid compatibility profile');
      return Object.freeze({
        wireVersion: 1 as const,
        taskApi: 'duoduo-generation-v1' as const,
      });
    },
  }) as T;
}

export const duoduoGenerationContract = Object.freeze({
  images: contract<ImageProtocolContract<'duoduo-generation-v1'>>(),
  videos: contract<VideoProtocolContract<'duoduo-generation-v1'>>(),
});

export interface DuoduoGenerationAdapter {
  readonly images: ResumableImageProtocolAdapter<'duoduo-generation-v1'>;
  readonly videos: ResumableVideoProtocolAdapter<'duoduo-generation-v1'>;
}

export function createDuoduoGenerationAdapter(
  gateway: DuoduoGenerationGateway,
): DuoduoGenerationAdapter {
  const images: ResumableImageProtocolAdapter<'duoduo-generation-v1'> =
    Object.freeze({
      id: 'duoduo-generation-v1',
      operationMode: 'resumable',
      contract: duoduoGenerationContract.images,
      parseOperationState: parseOperationState,
      async run(
        request: ImageProtocolRequest<'duoduo-generation-v1'>,
        sink: ResumableImageProtocolEventSink,
      ) {
        return runImage(gateway, request, sink);
      },
      async resume(
        request: ImageResumeRequest<'duoduo-generation-v1'>,
        sink: ImageProtocolEventSink,
      ) {
        return pollImage(
          gateway,
          request.operation.operationId,
          request.options.pollIntervalMs,
          request.signal,
          sink,
        );
      },
      async cancel(request: ImageCancelRequest<'duoduo-generation-v1'>) {
        await gateway.cancelTask(
          request.operation.operationId,
          request.signal.aborted ? undefined : request.signal,
        );
      },
    });
  const videos: ResumableVideoProtocolAdapter<'duoduo-generation-v1'> =
    Object.freeze({
      id: 'duoduo-generation-v1',
      operationMode: 'resumable',
      contract: duoduoGenerationContract.videos,
      parseOperationState: parseOperationState,
      async run(
        request: VideoProtocolRequest<'duoduo-generation-v1'>,
        sink: ResumableVideoProtocolEventSink,
      ) {
        return runVideo(gateway, request, sink);
      },
      async resume(
        request: VideoResumeRequest<'duoduo-generation-v1'>,
        sink: VideoProtocolEventSink,
      ) {
        return pollVideo(
          gateway,
          request.operation.operationId,
          request.options.pollIntervalMs,
          request.signal,
          sink,
        );
      },
      async cancel(request: VideoCancelRequest<'duoduo-generation-v1'>) {
        await gateway.cancelTask(
          request.operation.operationId,
          request.signal.aborted ? undefined : request.signal,
        );
      },
    });
  return Object.freeze({ images, videos });
}

function parseOperationState(input: unknown): JsonValue | undefined {
  if (
    !isRecord(input) ||
    Object.keys(input).some((key) => key !== 'adapterId') ||
    typeof input.adapterId !== 'string'
  )
    return undefined;
  return Object.freeze({ adapterId: input.adapterId });
}

async function runImage(
  gateway: DuoduoGenerationGateway,
  request: ImageProtocolRequest<'duoduo-generation-v1'>,
  sink: ResumableImageProtocolEventSink,
): Promise<ImageProtocolTerminal> {
  try {
    const task = await gateway.createTask(
      {
        domain: 'images',
        modelId: request.model.upstreamModelId,
        input: request.input,
        metadata: request.options.metadata,
      },
      request.signal,
    );
    validateTaskId(task.id);
    await sink.setOperation({
      operationId: task.id,
      operationState: { adapterId: gateway.adapterId },
    });
    return pollImage(
      gateway,
      task.id,
      request.options.pollIntervalMs,
      request.signal,
      sink,
    );
  } catch (error) {
    return imageError(error, request.signal);
  }
}

async function runVideo(
  gateway: DuoduoGenerationGateway,
  request: VideoProtocolRequest<'duoduo-generation-v1'>,
  sink: ResumableVideoProtocolEventSink,
): Promise<VideoProtocolTerminal> {
  try {
    const task = await gateway.createTask(
      {
        domain: 'videos',
        modelId: request.model.upstreamModelId,
        input: request.input,
        metadata: request.options.metadata,
      },
      request.signal,
    );
    validateTaskId(task.id);
    await sink.setOperation({
      operationId: task.id,
      operationState: { adapterId: gateway.adapterId },
    });
    return pollVideo(
      gateway,
      task.id,
      request.options.pollIntervalMs,
      request.signal,
      sink,
    );
  } catch (error) {
    return videoError(error, request.signal);
  }
}

async function pollImage(
  gateway: DuoduoGenerationGateway,
  taskId: string,
  interval: number,
  signal: AbortSignal,
  sink: ImageProtocolEventSink,
): Promise<ImageProtocolTerminal> {
  try {
    for (;;) {
      await wait(interval, signal);
      const task = sanitizeTask(await gateway.getTask(taskId, signal));
      if (isProgress(task.status)) {
        await publishProgress(task, sink);
        continue;
      }
      if (task.status === 'succeeded') {
        for (const [outputIndex, artifact] of (task.artifacts ?? []).entries())
          await sink.publish({
            type: 'generation_output',
            outputIndex,
            output: {
              type: 'image',
              image: {
                mediaType: artifact.mediaType,
                source: artifact.source,
                metadata: artifact.metadata,
              },
            },
          });
        return {
          status: 'completed',
          responseId: task.responseId,
          usage: {
            generatedImages: task.artifacts?.length ?? 0,
            compute: task.compute,
          },
          diagnostics: diagnostics(task),
        };
      }
      if (task.status === 'cancelled') return cancelledImage();
      return {
        status: 'failed',
        error: task.error ?? invalid('generation gateway task failed'),
        diagnostics: diagnostics(task),
      };
    }
  } catch (error) {
    return imageError(error, signal);
  }
}

async function pollVideo(
  gateway: DuoduoGenerationGateway,
  taskId: string,
  interval: number,
  signal: AbortSignal,
  sink: VideoProtocolEventSink,
): Promise<VideoProtocolTerminal> {
  try {
    for (;;) {
      await wait(interval, signal);
      const task = sanitizeTask(await gateway.getTask(taskId, signal));
      if (isProgress(task.status)) {
        await publishProgress(task, sink);
        continue;
      }
      if (task.status === 'succeeded') {
        for (const [outputIndex, artifact] of (task.artifacts ?? []).entries())
          await sink.publish({
            type: 'generation_output',
            outputIndex,
            output: { type: 'video', video: { artifact } },
          });
        return {
          status: 'completed',
          responseId: task.responseId,
          usage: {
            generatedVideos: task.artifacts?.length ?? 0,
            compute: task.compute,
          },
          diagnostics: diagnostics(task),
        };
      }
      if (task.status === 'cancelled') return cancelledVideo();
      return {
        status: 'failed',
        error: task.error ?? invalid('generation gateway task failed'),
        diagnostics: diagnostics(task),
      };
    }
  } catch (error) {
    return videoError(error, signal);
  }
}

async function publishProgress(
  task: DuoduoGenerationGatewayTask,
  sink: ImageProtocolEventSink | VideoProtocolEventSink,
): Promise<void> {
  if (!isProgress(task.status)) return;
  await sink.publish({
    type: 'generation_progress',
    phase: task.status,
    progress: task.progress,
    queuePosition: task.queuePosition,
    estimatedWaitMs: task.estimatedWaitMs,
  });
}
function sanitizeTask(
  task: DuoduoGenerationGatewayTask,
): DuoduoGenerationGatewayTask {
  return Object.freeze({
    id: task.id,
    status: task.status,
    progress: task.progress,
    queuePosition: task.queuePosition,
    estimatedWaitMs: task.estimatedWaitMs,
    artifacts: task.artifacts,
    compute: task.compute,
    responseId: task.responseId,
    error: task.error,
    diagnostics: task.diagnostics,
    ...(hasInfrastructure(task.extensions)
      ? { extensions: { infrastructureFieldsDropped: true } }
      : {}),
  });
}
function diagnostics(
  task: DuoduoGenerationGatewayTask,
): readonly AiDiagnostic[] | undefined {
  return task.extensions && 'infrastructureFieldsDropped' in task.extensions
    ? Object.freeze([
        ...(task.diagnostics ?? []),
        {
          code: 'GENERATION_GATEWAY_INFRASTRUCTURE_FIELDS_DROPPED',
          message: 'owned gateway infrastructure fields were discarded',
        },
      ])
    : task.diagnostics;
}
function hasInfrastructure(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).some((key) =>
      /(?:gpu|instance|container|ip|node|host)/iu.test(key),
    ) || Object.values(value).some(hasInfrastructure)
  );
}
function isProgress(
  status: DuoduoGenerationGatewayTask['status'],
): status is 'queued' | 'preparing' | 'running' | 'finalizing' {
  return ['queued', 'preparing', 'running', 'finalizing'].includes(status);
}
function validateTaskId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id))
    throw invalid('invalid generation gateway task id');
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
function invalid(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'DUODUO_GENERATION_INVALID',
    'invalid_response',
    message,
  );
}
function imageError(
  error: unknown,
  signal: AbortSignal,
): ImageProtocolTerminal {
  if (signal.aborted) return cancelledImage();
  return {
    status: 'failed',
    error:
      error instanceof AiRuntimeError
        ? error
        : new AiRuntimeError(
            'DUODUO_GENERATION_FAILED',
            'provider',
            'generation gateway failed',
            true,
          ),
  };
}
function videoError(
  error: unknown,
  signal: AbortSignal,
): VideoProtocolTerminal {
  if (signal.aborted) return cancelledVideo();
  return {
    status: 'failed',
    error:
      error instanceof AiRuntimeError
        ? error
        : new AiRuntimeError(
            'DUODUO_GENERATION_FAILED',
            'provider',
            'generation gateway failed',
            true,
          ),
  };
}
function cancelledImage(): ImageProtocolTerminal {
  return {
    status: 'cancelled',
    error: new AiRuntimeError(
      'GENERATION_CANCELLED',
      'cancelled',
      'generation cancelled',
    ) as AiError & { readonly category: 'cancelled' },
  };
}
function cancelledVideo(): VideoProtocolTerminal {
  return {
    status: 'cancelled',
    error: new AiRuntimeError(
      'GENERATION_CANCELLED',
      'cancelled',
      'generation cancelled',
    ) as AiError & { readonly category: 'cancelled' },
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
