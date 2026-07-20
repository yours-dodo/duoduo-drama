import type { RequestCredentialOverride } from '../auth/api-key.js';
import type { JsonValue } from '../core/content.js';
import type { AiDiagnostic } from '../core/events.js';
import type { AiError } from '../core/errors.js';
import type { ProviderSnapshot } from '../core/models.js';
import type { RetrySafety } from '../transport/dispatcher.js';
import type { RetryPolicy } from '../transport/retry.js';
import type { RequestTransport, TransportLimits } from '../transport/types.js';
import type {
  ImageGenerationInput,
  ResolvedImageGenerationInput,
} from './input.js';
import type {
  ImageModelDefinition,
  ImageModelHandle,
  ImageModelListFilter,
  ImageModelRef,
} from './models.js';
import type {
  GeneratedImage,
  ImageGenerationOutput,
  ImageGenerationResult,
} from './output.js';
import type { ImageUsage } from './cost.js';
import type { ImageGenerationStream } from './stream.js';

// These declaration-merging maps are intentionally empty until a protocol augments them.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ImageProtocolOptionsMap {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ImageProtocolCompatibilityMap {}

export type ImageProtocolOptions<TProtocol extends string> =
  TProtocol extends keyof ImageProtocolOptionsMap
    ? ImageProtocolOptionsMap[TProtocol]
    : Readonly<Record<string, JsonValue>>;

export type ImageProtocolCompatibility<TProtocol extends string> =
  TProtocol extends keyof ImageProtocolCompatibilityMap
    ? ImageProtocolCompatibilityMap[TProtocol]
    : Readonly<Record<string, JsonValue>>;

export interface ImageGenerationOptions<TProtocol extends string = string> {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly retry?: false | RetryPolicy;
  readonly responseFormat?: 'url' | 'base64';
  readonly pollIntervalMs?: number;
  readonly protocolOptions?: ImageProtocolOptions<TProtocol>;
  readonly credentialOverride?: RequestCredentialOverride;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface ResolvedImageGenerationOptions<
  TProtocol extends string = string,
> {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly retry: false | RetryPolicy;
  readonly responseFormat: 'url' | 'base64';
  readonly pollIntervalMs: number;
  readonly protocolOptions: ImageProtocolOptions<TProtocol>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export type ImageProtocolProgressEvent =
  | Readonly<{
      type: 'generation_progress';
      phase?: string;
      progress?: number;
      queuePosition?: number;
      estimatedWaitMs?: number;
    }>
  | Readonly<{
      type: 'generation_preview';
      outputIndex: number;
      image: GeneratedImage;
    }>
  | Readonly<{
      type: 'generation_output';
      outputIndex: number;
      output: ImageGenerationOutput;
    }>;

export interface ImageProtocolEventSink {
  publish(event: ImageProtocolProgressEvent): Promise<void>;
}

export interface ImageProtocolTerminalBase {
  readonly usage?: ImageUsage;
  readonly responseId?: string;
  readonly diagnostics?: readonly AiDiagnostic[];
}

export type ImageProtocolTerminal =
  | (ImageProtocolTerminalBase & { readonly status: 'completed' })
  | (ImageProtocolTerminalBase & {
      readonly status: 'failed';
      readonly error: AiError;
    })
  | (ImageProtocolTerminalBase & {
      readonly status: 'cancelled';
      readonly error: AiError & { readonly category: 'cancelled' };
    });

export interface ImageProtocolRequest<TProtocol extends string = string> {
  readonly provider: Readonly<ProviderSnapshot>;
  readonly model: Readonly<ImageModelDefinition<TProtocol>>;
  readonly input: Readonly<ResolvedImageGenerationInput>;
  readonly compatibility: Readonly<ImageProtocolCompatibility<TProtocol>>;
  readonly options: Readonly<ResolvedImageGenerationOptions<TProtocol>>;
  readonly transport: RequestTransport;
  readonly signal: AbortSignal;
}

export interface ImageProtocolContract<TProtocol extends string = string> {
  parseOptions(input: unknown): ImageProtocolOptions<TProtocol>;
  mergeOptions(
    layers: readonly (ImageProtocolOptions<TProtocol> | undefined)[],
  ): ImageProtocolOptions<TProtocol>;
  parseCompatibility(input: unknown): ImageProtocolCompatibility<TProtocol>;
}

export interface DirectImageProtocolAdapter<TProtocol extends string = string> {
  readonly id: TProtocol;
  readonly operationMode: 'direct';
  readonly contract: ImageProtocolContract<TProtocol>;
  run(
    request: ImageProtocolRequest<TProtocol>,
    sink: ImageProtocolEventSink,
  ): Promise<ImageProtocolTerminal>;
}

export interface ImageProtocolProfile<TProtocol extends string = string> {
  readonly id: string;
  readonly compatibility: Readonly<ImageProtocolCompatibility<TProtocol>>;
  readonly protocolDefaults?: Readonly<ImageProtocolOptions<TProtocol>>;
}

export interface DirectImageProtocolBinding<TProtocol extends string = string> {
  readonly protocol: TProtocol;
  readonly operationMode: 'direct';
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly credential?: Readonly<{
    headerName: string;
    defaultScheme?: string;
  }>;
  readonly limits?: Partial<TransportLimits>;
  readonly retrySafety: RetrySafety;
  readonly requestDefaults?: Readonly<{
    timeoutMs?: number;
    retry?: false | RetryPolicy;
    responseFormat?: 'url' | 'base64';
    pollIntervalMs?: number;
    protocolOptions?: ImageProtocolOptions<TProtocol>;
  }>;
  readonly defaultProfile: Readonly<ImageProtocolProfile<TProtocol>>;
  readonly profiles?: Readonly<Record<string, ImageProtocolProfile<TProtocol>>>;
  loadAdapter(): Promise<DirectImageProtocolAdapter<TProtocol>>;
}

export interface ImageProviderBinding {
  readonly catalogCompatibilityVersion: string;
  readonly models: readonly ImageModelDefinition[];
  readonly protocols: readonly DirectImageProtocolBinding[];
}

export interface ImageModelReadOptions {
  readonly signal?: AbortSignal;
  readonly credentialOverride?: RequestCredentialOverride;
}

export interface ImageModelsApi<TScopeHandle> {
  find<TProtocol extends string>(
    ref: ImageModelRef<TProtocol>,
    scope: TScopeHandle,
    options?: ImageModelReadOptions,
  ): Promise<ImageModelHandle<TProtocol> | undefined>;
  require<TProtocol extends string>(
    ref: ImageModelRef<TProtocol>,
    scope: TScopeHandle,
    options?: ImageModelReadOptions,
  ): Promise<ImageModelHandle<TProtocol>>;
  list(
    scope: TScopeHandle,
    filter?: ImageModelListFilter,
    options?: ImageModelReadOptions,
  ): Promise<{ models: readonly ImageModelHandle[] }>;
}

export interface ImagesApi<TScopeHandle> {
  readonly models: ImageModelsApi<TScopeHandle>;
  stream<TProtocol extends string>(
    model: ImageModelHandle<TProtocol>,
    input: ImageGenerationInput,
    options?: ImageGenerationOptions<TProtocol>,
  ): ImageGenerationStream;
  generate<TProtocol extends string>(
    model: ImageModelHandle<TProtocol>,
    input: ImageGenerationInput,
    options?: ImageGenerationOptions<TProtocol>,
  ): Promise<ImageGenerationResult>;
}
