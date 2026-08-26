import type { RequestCredentialOverride } from '../auth/api-key.js';
import type { JsonValue } from '../core/content.js';
import type { AiDiagnostic } from '../core/events.js';
import type { AiError } from '../core/errors.js';
import type { ProviderSnapshot } from '../core/models.js';
import type { GenerationPhase } from '../generation/progress.js';
import type { RetrySafety } from '../transport/dispatcher.js';
import type { RetryPolicy } from '../transport/retry.js';
import type { RequestTransport, TransportLimits } from '../transport/types.js';
import type {
  VideoGenerationInput,
  ResolvedVideoGenerationInput,
} from './input.js';
import type {
  VideoModelDefinition,
  VideoModelHandle,
  VideoModelListFilter,
  VideoModelRef,
} from './models.js';
import type {
  GeneratedVideo,
  VideoGenerationOutput,
  VideoGenerationResult,
} from './output.js';
import type { VideoUsage } from './cost.js';
import type { VideoGenerationStream } from './stream.js';
import type {
  VideoOperationClaims,
  VideoOperationRef,
  SerializedVideoOperationRef,
} from './operation-claims.js';

// These declaration-merging maps are intentionally empty until a protocol augments them.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface VideoProtocolOptionsMap {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface VideoProtocolCompatibilityMap {}

export type VideoProtocolOptions<TProtocol extends string> =
  TProtocol extends keyof VideoProtocolOptionsMap
    ? VideoProtocolOptionsMap[TProtocol]
    : Readonly<Record<string, JsonValue>>;

export type VideoProtocolCompatibility<TProtocol extends string> =
  TProtocol extends keyof VideoProtocolCompatibilityMap
    ? VideoProtocolCompatibilityMap[TProtocol]
    : Readonly<Record<string, JsonValue>>;

export interface VideoGenerationOptions<TProtocol extends string = string> {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly retry?: false | RetryPolicy;
  readonly responseFormat?: 'url' | 'base64';
  readonly pollIntervalMs?: number;
  readonly protocolOptions?: VideoProtocolOptions<TProtocol>;
  readonly credentialOverride?: RequestCredentialOverride;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface ResolvedVideoGenerationOptions<
  TProtocol extends string = string,
> {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly retry: false | RetryPolicy;
  readonly responseFormat: 'url' | 'base64';
  readonly pollIntervalMs: number;
  readonly protocolOptions: VideoProtocolOptions<TProtocol>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export type VideoProtocolProgressEvent =
  | Readonly<{
      type: 'generation_progress';
      phase?: GenerationPhase;
      progress?: number;
      queuePosition?: number;
      estimatedWaitMs?: number;
    }>
  | Readonly<{
      type: 'generation_preview';
      outputIndex: number;
      video: GeneratedVideo;
    }>
  | Readonly<{
      type: 'generation_output';
      outputIndex: number;
      output: VideoGenerationOutput;
    }>;

export interface VideoProtocolEventSink {
  publish(event: VideoProtocolProgressEvent): Promise<void>;
}

export interface VideoProtocolTerminalBase {
  readonly usage?: VideoUsage;
  readonly responseId?: string;
  readonly diagnostics?: readonly AiDiagnostic[];
}

export type VideoProtocolTerminal =
  | (VideoProtocolTerminalBase & { readonly status: 'completed' })
  | (VideoProtocolTerminalBase & {
      readonly status: 'failed';
      readonly error: AiError;
    })
  | (VideoProtocolTerminalBase & {
      readonly status: 'cancelled';
      readonly error: AiError & { readonly category: 'cancelled' };
    });

export interface VideoProtocolRequest<TProtocol extends string = string> {
  readonly provider: Readonly<ProviderSnapshot>;
  readonly model: Readonly<VideoModelDefinition<TProtocol>>;
  readonly input: Readonly<ResolvedVideoGenerationInput>;
  readonly compatibility: Readonly<VideoProtocolCompatibility<TProtocol>>;
  readonly options: Readonly<ResolvedVideoGenerationOptions<TProtocol>>;
  readonly transport: RequestTransport;
  readonly signal: AbortSignal;
  /** Runtime clock, injectable so protocol expiry checks are deterministic. */
  readonly now?: () => number;
}

export interface VideoProtocolContract<TProtocol extends string = string> {
  parseOptions(input: unknown): VideoProtocolOptions<TProtocol>;
  mergeOptions(
    layers: readonly (VideoProtocolOptions<TProtocol> | undefined)[],
  ): VideoProtocolOptions<TProtocol>;
  parseCompatibility(input: unknown): VideoProtocolCompatibility<TProtocol>;
}

export interface DirectVideoProtocolAdapter<TProtocol extends string = string> {
  readonly id: TProtocol;
  readonly operationMode: 'direct';
  readonly contract: VideoProtocolContract<TProtocol>;
  run(
    request: VideoProtocolRequest<TProtocol>,
    sink: VideoProtocolEventSink,
  ): Promise<VideoProtocolTerminal>;
}

export interface ResumableVideoProtocolEventSink extends VideoProtocolEventSink {
  setOperation(input: {
    readonly operationId: string;
    readonly operationState?: JsonValue;
    readonly providerExpiresAt?: number;
  }): Promise<void>;
  operationTransport(action: 'poll' | 'cancel'): Promise<RequestTransport>;
}

export interface ResolvedVideoOperationResumeOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly retry: false | RetryPolicy;
  readonly pollIntervalMs: number;
  readonly allowCatalogNetwork: boolean;
}

export interface VideoResumeRequest<TProtocol extends string = string> {
  readonly operation: Readonly<VideoOperationClaims & { protocol: TProtocol }>;
  readonly provider: Readonly<ProviderSnapshot>;
  readonly model: Readonly<VideoModelDefinition<TProtocol>>;
  readonly compatibility: Readonly<VideoProtocolCompatibility<TProtocol>>;
  readonly options: Readonly<ResolvedVideoOperationResumeOptions>;
  readonly pollTransport: RequestTransport;
  readonly cancelTransport?: RequestTransport;
  readonly signal: AbortSignal;
  /** Runtime clock, injectable so protocol expiry checks are deterministic. */
  readonly now?: () => number;
}

export interface VideoCancelRequest<TProtocol extends string = string> {
  readonly operation: Readonly<VideoOperationClaims & { protocol: TProtocol }>;
  readonly provider: Readonly<ProviderSnapshot>;
  readonly model: Readonly<VideoModelDefinition<TProtocol>>;
  readonly compatibility: Readonly<VideoProtocolCompatibility<TProtocol>>;
  readonly transport: RequestTransport;
  readonly signal: AbortSignal;
}

export interface ResumableVideoProtocolAdapter<
  TProtocol extends string = string,
> {
  readonly id: TProtocol;
  readonly operationMode: 'resumable';
  readonly contract: VideoProtocolContract<TProtocol>;
  parseOperationState(input: unknown): JsonValue | undefined;
  run(
    request: VideoProtocolRequest<TProtocol>,
    sink: ResumableVideoProtocolEventSink,
  ): Promise<VideoProtocolTerminal>;
  resume(
    request: VideoResumeRequest<TProtocol>,
    sink: VideoProtocolEventSink,
  ): Promise<VideoProtocolTerminal>;
  cancel?(request: VideoCancelRequest<TProtocol>): Promise<void>;
}

export type VideoProtocolAdapter<TProtocol extends string = string> =
  | DirectVideoProtocolAdapter<TProtocol>
  | ResumableVideoProtocolAdapter<TProtocol>;

export interface VideoProtocolProfile<TProtocol extends string = string> {
  readonly id: string;
  readonly compatibility: Readonly<VideoProtocolCompatibility<TProtocol>>;
  readonly protocolDefaults?: Readonly<VideoProtocolOptions<TProtocol>>;
}

interface VideoProtocolBindingBase<TProtocol extends string = string> {
  readonly protocol: TProtocol;
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly credential?: Readonly<{
    headerName: string;
    defaultScheme?: string;
  }>;
  readonly limits?: Partial<TransportLimits>;
  readonly retrySafety: RetrySafety;
  resolveEndpoint?(
    context: Readonly<{
      provider: Readonly<ProviderSnapshot>;
      model: Readonly<VideoModelDefinition<TProtocol>>;
      input: Readonly<ResolvedVideoGenerationInput>;
      options: Readonly<ResolvedVideoGenerationOptions<TProtocol>>;
      signal: AbortSignal;
    }>,
  ): Promise<string | URL> | string | URL;
  readonly requestDefaults?: Readonly<{
    timeoutMs?: number;
    retry?: false | RetryPolicy;
    responseFormat?: 'url' | 'base64';
    pollIntervalMs?: number;
    protocolOptions?: VideoProtocolOptions<TProtocol>;
  }>;
  readonly defaultProfile: Readonly<VideoProtocolProfile<TProtocol>>;
  readonly profiles?: Readonly<Record<string, VideoProtocolProfile<TProtocol>>>;
}

export interface DirectVideoProtocolBinding<
  TProtocol extends string = string,
> extends VideoProtocolBindingBase<TProtocol> {
  readonly operationMode: 'direct';
  loadAdapter(): Promise<DirectVideoProtocolAdapter<TProtocol>>;
}

export interface VideoOperationEndpointContext<
  TProtocol extends string = string,
> {
  readonly action: 'poll' | 'cancel';
  readonly operation: Readonly<VideoOperationClaims & { protocol: TProtocol }>;
  readonly provider: Readonly<ProviderSnapshot>;
  readonly model: Readonly<VideoModelDefinition<TProtocol>>;
  readonly options: Readonly<ResolvedVideoOperationResumeOptions>;
  readonly signal: AbortSignal;
}

export interface ResumableVideoProtocolBinding<
  TProtocol extends string = string,
> extends VideoProtocolBindingBase<TProtocol> {
  readonly operationMode: 'resumable';
  readonly operationCompatibilityVersion: string;
  readonly operationActions: readonly ('poll' | 'cancel')[];
  resolveOperationEndpoint(
    context: VideoOperationEndpointContext<TProtocol>,
  ): Promise<string | URL> | string | URL;
  readonly operationHeaders?: Readonly<Record<string, string>>;
  loadAdapter(): Promise<ResumableVideoProtocolAdapter<TProtocol>>;
}

export type VideoProtocolBinding<TProtocol extends string = string> =
  | DirectVideoProtocolBinding<TProtocol>
  | ResumableVideoProtocolBinding<TProtocol>;

export interface VideoProviderBinding {
  readonly catalogCompatibilityVersion: string;
  readonly models: readonly VideoModelDefinition[];
  readonly protocols: readonly VideoProtocolBinding[];
}

export interface VideoModelReadOptions {
  readonly signal?: AbortSignal;
  readonly credentialOverride?: RequestCredentialOverride;
}

export interface VideoModelsApi<TScopeHandle> {
  find<TProtocol extends string>(
    ref: VideoModelRef<TProtocol>,
    scope: TScopeHandle,
    options?: VideoModelReadOptions,
  ): Promise<VideoModelHandle<TProtocol> | undefined>;
  require<TProtocol extends string>(
    ref: VideoModelRef<TProtocol>,
    scope: TScopeHandle,
    options?: VideoModelReadOptions,
  ): Promise<VideoModelHandle<TProtocol>>;
  list(
    scope: TScopeHandle,
    filter?: VideoModelListFilter,
    options?: VideoModelReadOptions,
  ): Promise<{ models: readonly VideoModelHandle[] }>;
}

export interface VideoOperationResumeOptions<TScopeHandle> {
  readonly scope: TScopeHandle;
  readonly signal?: AbortSignal;
  readonly credentialOverride?: RequestCredentialOverride;
  readonly timeoutMs?: number;
  readonly retry?: false | RetryPolicy;
  readonly pollIntervalMs?: number;
  readonly allowCatalogNetwork?: boolean;
}

export interface VideosApi<TScopeHandle> {
  readonly models: VideoModelsApi<TScopeHandle>;
  stream<TProtocol extends string>(
    model: VideoModelHandle<TProtocol>,
    input: VideoGenerationInput,
    options?: VideoGenerationOptions<TProtocol>,
  ): VideoGenerationStream;
  generate<TProtocol extends string>(
    model: VideoModelHandle<TProtocol>,
    input: VideoGenerationInput,
    options?: VideoGenerationOptions<TProtocol>,
  ): Promise<VideoGenerationResult>;
  resume(
    operation: VideoOperationRef,
    options: VideoOperationResumeOptions<TScopeHandle>,
  ): Promise<VideoGenerationStream>;
  serializeOperation(
    operation: VideoOperationRef,
  ): Promise<SerializedVideoOperationRef>;
  parseOperation(serialized: string): Promise<VideoOperationRef>;
}
