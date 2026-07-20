import type {
  ImageModelDefinition,
  ImageModelRef,
} from '../../images/models.js';
import type {
  DirectImageProtocolBinding,
  ImageProviderBinding,
  ResumableImageProtocolBinding,
} from '../../images/contracts.js';
import { createDashScopeImagesAdapter } from '../../protocols/dashscope-images/index.js';
import {
  createDashScopeImageTasksAdapter,
  validateDashScopeTaskId,
} from '../../protocols/dashscope-image-tasks/index.js';
import { appendPath, type QwenEndpoints } from './endpoints.js';

export const qwenDefaultImageModelId = 'wan2.6-image';
export const qwenDefaultTaskImageModelId = 'wan2.6-image@task';

export interface QwenAdditionalImageModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly mode?: 'direct' | 'task';
  readonly referenceImages?: 'none' | 'single' | 'multiple';
  readonly sizes?: readonly string[];
  readonly maxOutputs?: number;
  readonly seed?: boolean;
  readonly pricing?: ImageModelDefinition['pricing'];
}

export function createQwenImagesBinding(input: {
  providerInstanceId: string;
  endpoints: QwenEndpoints;
  additionalModels?: readonly QwenAdditionalImageModelInput[];
}): ImageProviderBinding {
  const direct = model(input.providerInstanceId, {
    id: qwenDefaultImageModelId,
    upstreamModelId: 'wan2.6-image',
    name: 'Qwen Wan 2.6 Image',
    mode: 'direct',
    referenceImages: 'multiple',
    seed: true,
  });
  const task = model(input.providerInstanceId, {
    id: qwenDefaultTaskImageModelId,
    upstreamModelId: 'wan2.6-image',
    name: 'Qwen Wan 2.6 Image Task',
    mode: 'task',
    referenceImages: 'none',
    seed: true,
  });
  const models = [
    direct,
    task,
    ...(input.additionalModels ?? []).map((entry) =>
      model(input.providerInstanceId, entry),
    ),
  ];
  const directEndpoint = appendPath(
    input.endpoints.nativeBaseUrl,
    'services/aigc/multimodal-generation/generation',
  );
  const taskEndpoint = appendPath(
    input.endpoints.nativeBaseUrl,
    'services/aigc/image-generation/generation',
  );
  const directBinding: DirectImageProtocolBinding<'dashscope-images'> =
    Object.freeze({
      protocol: 'dashscope-images',
      operationMode: 'direct',
      endpoint: directEndpoint,
      headers: Object.freeze({ 'content-type': 'application/json' }),
      credential: Object.freeze({
        headerName: 'authorization',
        defaultScheme: 'Bearer',
      }),
      retrySafety: Object.freeze({ mode: 'idempotent' as const }),
      requestDefaults: Object.freeze({
        timeoutMs: 120_000,
        retry: false,
        responseFormat: 'url',
      }),
      defaultProfile: Object.freeze({
        id: 'qwen-wan-direct-v1',
        compatibility: Object.freeze({
          wireVersion: 1,
          route: 'multimodal-generation',
        }),
      }),
      loadAdapter: async () => createDashScopeImagesAdapter(),
    });
  const taskBinding: ResumableImageProtocolBinding<'dashscope-image-tasks'> =
    Object.freeze({
      protocol: 'dashscope-image-tasks',
      operationMode: 'resumable',
      operationCompatibilityVersion: 'dashscope-image-tasks-v1',
      operationActions: Object.freeze(['poll', 'cancel'] as const),
      endpoint: taskEndpoint,
      headers: Object.freeze({
        'content-type': 'application/json',
        'x-dashscope-async': 'enable',
      }),
      credential: Object.freeze({
        headerName: 'authorization',
        defaultScheme: 'Bearer',
      }),
      retrySafety: Object.freeze({ mode: 'idempotent' as const }),
      requestDefaults: Object.freeze({
        timeoutMs: 600_000,
        retry: false,
        responseFormat: 'url',
        pollIntervalMs: 1_000,
      }),
      defaultProfile: Object.freeze({
        id: 'qwen-wan-task-v1',
        compatibility: Object.freeze({
          wireVersion: 1,
          taskApi: 'dashscope-v1',
        }),
      }),
      resolveOperationEndpoint: ({
        action,
        operation,
      }: {
        action: 'poll' | 'cancel';
        operation: { operationId: string };
      }) => {
        const taskId = validateDashScopeTaskId(operation.operationId);
        return appendPath(
          input.endpoints.nativeBaseUrl,
          `tasks/${encodeURIComponent(taskId)}${action === 'cancel' ? '/cancel' : ''}`,
        );
      },
      loadAdapter: async () => createDashScopeImageTasksAdapter(),
    });
  return Object.freeze({
    catalogCompatibilityVersion: 'qwen-images-v1',
    models: Object.freeze(models),
    protocols: Object.freeze([directBinding, taskBinding]),
  });
}

function model(
  providerInstanceId: string,
  input: QwenAdditionalImageModelInput & { upstreamModelId?: string },
): ImageModelDefinition<'dashscope-images' | 'dashscope-image-tasks'> {
  const mode = input.mode ?? 'direct';
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id.replace(/@task$/u, ''),
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: 'Alibaba Cloud',
    family: 'Wan',
    protocol: mode === 'task' ? 'dashscope-image-tasks' : 'dashscope-images',
    protocolProfileId:
      mode === 'task' ? 'qwen-wan-task-v1' : 'qwen-wan-direct-v1',
    capabilities: Object.freeze({
      textToImage: true,
      referenceImages:
        input.referenceImages ?? (mode === 'task' ? 'none' : 'multiple'),
      streamingPreviews: false,
      asyncOperation: mode === 'task',
      seed: input.seed ?? true,
      outputFormats: Object.freeze(['url', 'base64'] as const),
      output: Object.freeze(['image'] as const),
      sizes: Object.freeze(input.sizes ?? ['1024x1024']),
    }),
    limits: Object.freeze({
      maxPromptCharacters: 8_000,
      maxReferenceImages: mode === 'task' ? 1 : 4,
      maxReferenceImageBytes: 10 * 1024 * 1024,
      maxOutputs: input.maxOutputs ?? 4,
    }),
    inputDefaults: Object.freeze({ count: 1, size: '1024x1024' }),
    requestDefaults: Object.freeze({
      timeoutMs: mode === 'task' ? 600_000 : 120_000,
      retry: false as const,
      responseFormat: 'url' as const,
      ...(mode === 'task' ? { pollIntervalMs: 1_000 } : {}),
    }),
    ...(input.pricing ? { pricing: Object.freeze(input.pricing) } : {}),
  });
}

export function qwenImageModelRef(
  modelId?: typeof qwenDefaultImageModelId,
  protocol?: 'dashscope-images',
  providerInstanceId?: string,
): ImageModelRef<'dashscope-images'>;
export function qwenImageModelRef(
  modelId: typeof qwenDefaultTaskImageModelId,
  protocol?: 'dashscope-image-tasks',
  providerInstanceId?: string,
): ImageModelRef<'dashscope-image-tasks'>;
export function qwenImageModelRef<
  TProtocol extends 'dashscope-images' | 'dashscope-image-tasks',
>(
  modelId: string,
  protocol: TProtocol,
  providerInstanceId?: string,
): ImageModelRef<TProtocol>;
export function qwenImageModelRef(
  modelId: string = qwenDefaultImageModelId,
  protocol?: 'dashscope-images' | 'dashscope-image-tasks',
  providerInstanceId = 'qwen',
): ImageModelRef<'dashscope-images' | 'dashscope-image-tasks'> {
  return Object.freeze({
    providerInstanceId,
    modelId,
    protocol:
      protocol ??
      (modelId === qwenDefaultTaskImageModelId
        ? 'dashscope-image-tasks'
        : 'dashscope-images'),
  });
}
