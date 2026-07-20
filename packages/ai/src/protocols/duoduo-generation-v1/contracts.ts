import type { AiDiagnostic } from '../../core/events.js';
import type { AiError } from '../../core/errors.js';
import type {
  GenerationArtifact,
  GenerationComputeUsage,
  GenerationPhase,
} from '../../generation/index.js';

export type DuoduoGenerationDomain = 'images' | 'videos';

export interface DuoduoGenerationGatewayModel {
  readonly domain: DuoduoGenerationDomain;
  readonly id: string;
  readonly upstreamModelId: string;
  readonly name: string;
  readonly online?: boolean;
  readonly publisher?: string;
  readonly family?: string;
}

export interface DuoduoGenerationGatewayCatalog {
  readonly revision: string;
  readonly models: readonly DuoduoGenerationGatewayModel[];
}

export interface DuoduoGenerationGatewayTaskRequest {
  readonly domain: DuoduoGenerationDomain;
  readonly modelId: string;
  readonly input: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DuoduoGenerationGatewayTask {
  readonly id: string;
  readonly status: GenerationPhase | 'succeeded' | 'failed' | 'cancelled';
  readonly progress?: number;
  readonly queuePosition?: number;
  readonly estimatedWaitMs?: number;
  readonly artifacts?: readonly GenerationArtifact[];
  readonly compute?: GenerationComputeUsage;
  readonly responseId?: string;
  readonly error?: AiError;
  readonly diagnostics?: readonly AiDiagnostic[];
  /** Raw owned-gateway extensions are untrusted and are intentionally not projected. */
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface DuoduoGenerationGateway {
  readonly adapterId: string;
  listModels(signal?: AbortSignal): Promise<DuoduoGenerationGatewayCatalog>;
  createTask(
    request: DuoduoGenerationGatewayTaskRequest,
    signal?: AbortSignal,
  ): Promise<DuoduoGenerationGatewayTask>;
  getTask(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<DuoduoGenerationGatewayTask>;
  cancelTask(taskId: string, signal?: AbortSignal): Promise<void>;
}
