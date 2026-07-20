import type { JsonValue } from '../core/content.js';
import type { ProviderInstanceId } from '../core/models.js';
import type { RetryPolicy } from '../transport/retry.js';

export type ImageSize =
  { readonly width: number; readonly height: number } | string;

export interface ImageModelRef<TProtocol extends string = string> {
  readonly providerInstanceId: ProviderInstanceId;
  readonly modelId: string;
  readonly protocol?: TProtocol;
}

export interface ImageModelCapabilities {
  readonly textToImage: boolean;
  readonly referenceImages: 'none' | 'single' | 'multiple';
  readonly streamingPreviews: boolean;
  readonly asyncOperation: boolean;
  readonly seed: boolean;
  readonly outputFormats: readonly ('url' | 'base64')[];
  readonly output: readonly ('text' | 'image')[];
  readonly sizes: readonly ImageSize[];
}

export interface ImageModelLimits {
  readonly maxPromptCharacters: number;
  readonly maxReferenceImages: number;
  readonly maxReferenceImageBytes: number;
  readonly maxOutputs: number;
}

export interface ImageModelPricing {
  readonly currency: 'USD';
  readonly perImage?: number;
  readonly perMegapixel?: number;
  readonly tokenRates?: Readonly<{
    inputPerMillion?: number;
    outputPerMillion?: number;
    cacheReadPerMillion?: number;
    cacheWritePerMillion?: number;
  }>;
  readonly serviceTierMultipliers?: Readonly<Record<string, number>>;
}

export interface CommonImageRequestDefaults {
  readonly timeoutMs?: number;
  readonly retry?: false | RetryPolicy;
  readonly responseFormat?: 'url' | 'base64';
  readonly pollIntervalMs?: number;
}

export interface ImageModelDefinition<TProtocol extends string = string> {
  readonly id: string;
  readonly upstreamModelId: string;
  readonly name: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly publisher?: string;
  readonly family?: string;
  readonly protocol: TProtocol;
  readonly protocolProfileId: string;
  readonly capabilities: Readonly<ImageModelCapabilities>;
  readonly limits: Readonly<ImageModelLimits>;
  readonly inputDefaults: Readonly<{ count: number; size: ImageSize }>;
  readonly requestDefaults?: Readonly<CommonImageRequestDefaults>;
  readonly pricing?: Readonly<ImageModelPricing>;
  readonly providerMetadata?: Readonly<Record<string, JsonValue>>;
}

export interface ImageModelHandle<TProtocol extends string = string> {
  readonly ref: Readonly<ImageModelRef<TProtocol>>;
  readonly definition: Readonly<ImageModelDefinition<TProtocol>>;
}

export interface ImageModelListFilter {
  readonly providerInstanceId?: string;
  readonly protocol?: string;
}

export function sameImageModelRef(
  definition: Readonly<ImageModelDefinition>,
  ref: Readonly<ImageModelRef>,
): boolean {
  return (
    definition.providerInstanceId === ref.providerInstanceId &&
    definition.id === ref.modelId &&
    (ref.protocol === undefined || definition.protocol === ref.protocol)
  );
}
