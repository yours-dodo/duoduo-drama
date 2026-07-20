import { AiRuntimeError } from '../core/errors.js';
import type {
  DuoduoGenerationDomain,
  DuoduoGenerationGateway,
  DuoduoGenerationGatewayCatalog,
  DuoduoGenerationGatewayModel,
  DuoduoGenerationGatewayTask,
  DuoduoGenerationGatewayTaskRequest,
} from '../protocols/duoduo-generation-v1/index.js';

export interface FakeGenerationGateway extends DuoduoGenerationGateway {
  publishModel(model: DuoduoGenerationGatewayModel): void;
  removeModel(domain: DuoduoGenerationDomain, modelId: string): void;
  setModelOnline(
    domain: DuoduoGenerationDomain,
    modelId: string,
    online: boolean,
  ): void;
  taskState(taskId: string): DuoduoGenerationGatewayTask | undefined;
}
export interface FakeGenerationGatewayOptions {
  readonly adapterId?: string;
  readonly pollDelayMs?: number;
}

export function createFakeGenerationGateway(
  options: FakeGenerationGatewayOptions = {},
): FakeGenerationGateway {
  const models = new Map<string, DuoduoGenerationGatewayModel>();
  const tasks = new Map<
    string,
    {
      request: DuoduoGenerationGatewayTaskRequest;
      index: number;
      cancelled: boolean;
      error?: AiRuntimeError;
    }
  >();
  let revision = 0;
  let taskSequence = 0;
  const key = (domain: DuoduoGenerationDomain, id: string) =>
    `${domain}\0${id}`;
  const snapshot = (
    id: string,
    state: {
      request: DuoduoGenerationGatewayTaskRequest;
      index: number;
      cancelled: boolean;
      error?: AiRuntimeError;
    },
  ): DuoduoGenerationGatewayTask => {
    if (state.cancelled) return Object.freeze({ id, status: 'cancelled' });
    if (state.error)
      return Object.freeze({ id, status: 'failed', error: state.error });
    const phases = [
      'queued',
      'preparing',
      'running',
      'finalizing',
      'succeeded',
    ] as const;
    const status = phases[Math.min(state.index, phases.length - 1)]!;
    const extensions = Object.freeze({
      gpuInstanceId: 'gpu-instance-secret',
      containerId: 'container-secret',
      workerIp: '10.0.0.8',
    });
    if (status !== 'succeeded')
      return Object.freeze({
        id,
        status,
        progress: state.index / 4,
        ...(status === 'queued'
          ? { queuePosition: 2, estimatedWaitMs: 50 }
          : {}),
        extensions,
      });
    const source = Object.freeze({
      type: 'url' as const,
      url: `https://artifacts.example/${id}.${state.request.domain === 'images' ? 'png' : 'mp4'}`,
      expiresAt: Date.now() + 60_000,
    });
    return Object.freeze({
      id,
      status,
      responseId: `response-${id}`,
      artifacts: Object.freeze([
        {
          mediaType:
            state.request.domain === 'images' ? 'image/png' : 'video/mp4',
          source,
        },
      ]),
      compute: Object.freeze({
        acceleratorType: 'L40S',
        acceleratorCount: 1,
        activeMilliseconds: 900,
        billedMilliseconds: 1_000,
        queueMilliseconds: 50,
        modelLoadMilliseconds: 100,
      }),
      extensions,
    });
  };
  return Object.freeze({
    adapterId: options.adapterId ?? 'fake-generation-gateway',
    publishModel(model: DuoduoGenerationGatewayModel) {
      models.set(key(model.domain, model.id), Object.freeze({ ...model }));
      revision += 1;
    },
    removeModel(domain: DuoduoGenerationDomain, modelId: string) {
      if (models.delete(key(domain, modelId))) revision += 1;
    },
    setModelOnline(
      domain: DuoduoGenerationDomain,
      modelId: string,
      online: boolean,
    ) {
      const current = models.get(key(domain, modelId));
      if (!current) throw new Error(`model not found: ${modelId}`);
      models.set(key(domain, modelId), Object.freeze({ ...current, online }));
      revision += 1;
    },
    async listModels(): Promise<DuoduoGenerationGatewayCatalog> {
      return Object.freeze({
        revision: `revision-${revision}`,
        models: Object.freeze([...models.values()]),
      });
    },
    async createTask(
      request: DuoduoGenerationGatewayTaskRequest,
      signal?: AbortSignal,
    ) {
      if (signal?.aborted) throw signal.reason;
      const found = [...models.values()].find(
        (model) =>
          model.domain === request.domain &&
          model.upstreamModelId === request.modelId &&
          model.online !== false,
      );
      const id = `task-${++taskSequence}`;
      const state = {
        request,
        index: 0,
        cancelled: false,
        ...(!found
          ? {
              error: new AiRuntimeError(
                'GENERATION_MODEL_OFFLINE',
                'provider',
                'generation model is offline',
              ),
            }
          : {}),
      };
      tasks.set(id, state);
      return snapshot(id, state);
    },
    async getTask(taskId: string, signal?: AbortSignal) {
      if (signal?.aborted) throw signal.reason;
      if (options.pollDelayMs)
        await new Promise((resolve) =>
          setTimeout(resolve, options.pollDelayMs),
        );
      const state = tasks.get(taskId);
      if (!state)
        throw new AiRuntimeError(
          'GENERATION_TASK_NOT_FOUND',
          'provider',
          'generation task not found',
        );
      state.index += 1;
      return snapshot(taskId, state);
    },
    async cancelTask(taskId: string, signal?: AbortSignal) {
      if (signal?.aborted) throw signal.reason;
      const state = tasks.get(taskId);
      if (state) state.cancelled = true;
    },
    taskState(taskId: string) {
      const state = tasks.get(taskId);
      return state ? snapshot(taskId, state) : undefined;
    },
  });
}
