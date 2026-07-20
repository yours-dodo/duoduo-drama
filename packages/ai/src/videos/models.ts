import type { JsonValue } from '../core/content.js';
import type { ProviderInstanceId } from '../core/models.js';
import type { RetryPolicy } from '../transport/retry.js';

export type VideoOperationKind = 'generate' | 'edit' | 'extend';
export type VideoResolution =
  string | Readonly<{ width: number; height: number }>;
export type VideoSize = VideoResolution;

export interface VideoNumericRange {
  readonly min: number;
  readonly max: number;
  readonly step?: number;
}

export interface VideoModelRef<TProtocol extends string = string> {
  readonly providerInstanceId: ProviderInstanceId;
  readonly modelId: string;
  readonly protocol?: TProtocol;
}

export interface VideoModelCapabilities {
  readonly operations: readonly VideoOperationKind[];
  readonly inputModalities: readonly ('text' | 'image' | 'video' | 'audio')[];
  readonly imageRoles: readonly ('reference' | 'first_frame' | 'last_frame')[];
  readonly videoRoles: readonly ('source' | 'reference')[];
  readonly audioInput: boolean;
  readonly audioOutput: boolean;
  readonly streamingPreviews: boolean;
  readonly asyncOperation: boolean;
  readonly seed: boolean;
  readonly durationsSeconds: readonly number[] | VideoNumericRange;
  readonly resolutions: readonly VideoResolution[];
  readonly aspectRatios: readonly string[];
  readonly frameRates: readonly number[];
  readonly outputFormats: readonly ('url' | 'base64')[];
}

export interface VideoModelLimits {
  readonly maxPromptCharacters: number;
  readonly maxReferenceImages: number;
  readonly maxReferenceImageBytes: number;
  readonly maxInputVideos: number;
  readonly maxInputVideoBytes: number;
  readonly maxInputVideoSeconds: number;
  readonly maxInputAudioBytes: number;
  readonly maxOutputs: number;
}

export interface VideoModelPricing {
  readonly currency: 'USD';
  readonly perRequest?: number;
  readonly perOutputSecond?: number;
  readonly perInputVideoSecond?: number;
  readonly perOutputMegapixelSecond?: number;
  readonly serviceTierMultipliers?: Readonly<Record<string, number>>;
}

export interface CommonVideoRequestDefaults {
  readonly timeoutMs?: number;
  readonly retry?: false | RetryPolicy;
  readonly responseFormat?: 'url' | 'base64';
  readonly pollIntervalMs?: number;
}

export interface VideoModelDefinition<TProtocol extends string = string> {
  readonly id: string;
  readonly upstreamModelId: string;
  readonly name: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly publisher?: string;
  readonly family?: string;
  readonly protocol: TProtocol;
  readonly protocolProfileId: string;
  readonly capabilities: Readonly<VideoModelCapabilities>;
  readonly limits: Readonly<VideoModelLimits>;
  readonly inputDefaults: Readonly<{
    durationSeconds?: number;
    resolution?: VideoResolution;
    aspectRatio?: string;
    fps?: number;
    generateAudio?: boolean;
    count?: number;
  }>;
  readonly requestDefaults?: Readonly<CommonVideoRequestDefaults>;
  readonly pricing?: Readonly<VideoModelPricing>;
  readonly providerMetadata?: Readonly<Record<string, JsonValue>>;
}

export interface VideoModelHandle<TProtocol extends string = string> {
  readonly ref: Readonly<VideoModelRef<TProtocol>>;
  readonly definition: Readonly<VideoModelDefinition<TProtocol>>;
}

export interface VideoModelListFilter {
  readonly providerInstanceId?: string;
  readonly protocol?: string;
  readonly operation?: VideoOperationKind;
  readonly input?: 'text' | 'image' | 'video' | 'audio';
  readonly supports?:
    'streamingPreviews' | 'asyncOperation' | 'audioOutput' | 'seed';
}

export function sameVideoModelRef(
  definition: Readonly<VideoModelDefinition>,
  ref: Readonly<VideoModelRef>,
): boolean {
  return (
    definition.providerInstanceId === ref.providerInstanceId &&
    definition.id === ref.modelId &&
    (ref.protocol === undefined || definition.protocol === ref.protocol)
  );
}
