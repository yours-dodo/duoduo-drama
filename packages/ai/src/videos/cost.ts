import type { GenerationComputeUsage } from '../generation/index.js';
import type { VideoModelDefinition } from './models.js';

export interface VideoUsage {
  readonly generatedVideos?: number;
  readonly generatedSeconds?: number;
  readonly inputVideoSeconds?: number;
  readonly outputMegapixelSeconds?: number;
  readonly compute?: GenerationComputeUsage;
  readonly serviceTier?: string;
  readonly providerReportedCost?: Readonly<{
    currency: string;
    amount: number;
  }>;
}

export interface VideoCost {
  readonly currency: 'USD';
  readonly requests?: number;
  readonly outputSeconds?: number;
  readonly inputVideoSeconds?: number;
  readonly outputMegapixelSeconds?: number;
  readonly total?: number;
  readonly source: 'computed' | 'provider' | 'mixed';
}

export function calculateVideoCost(
  model: Readonly<VideoModelDefinition>,
  usage: Readonly<VideoUsage>,
): VideoCost | undefined {
  const pricing = model.pricing;
  const provider =
    usage.providerReportedCost?.currency === 'USD'
      ? usage.providerReportedCost.amount
      : undefined;
  if (!pricing && provider === undefined) return undefined;
  const multiplier = usage.serviceTier
    ? (pricing?.serviceTierMultipliers?.[usage.serviceTier] ?? 1)
    : 1;
  const requests =
    pricing?.perRequest === undefined ? undefined : pricing.perRequest;
  const outputSeconds =
    pricing?.perOutputSecond === undefined ||
    usage.generatedSeconds === undefined
      ? undefined
      : pricing.perOutputSecond * usage.generatedSeconds;
  const inputVideoSeconds =
    pricing?.perInputVideoSecond === undefined ||
    usage.inputVideoSeconds === undefined
      ? undefined
      : pricing.perInputVideoSecond * usage.inputVideoSeconds;
  const outputMegapixelSeconds =
    pricing?.perOutputMegapixelSecond === undefined ||
    usage.outputMegapixelSeconds === undefined
      ? undefined
      : pricing.perOutputMegapixelSecond * usage.outputMegapixelSeconds;
  const parts = [
    requests,
    outputSeconds,
    inputVideoSeconds,
    outputMegapixelSeconds,
  ].filter((value): value is number => value !== undefined);
  const computed = parts.length
    ? parts.reduce((sum, value) => sum + value, 0) * multiplier
    : undefined;
  return Object.freeze({
    currency: 'USD',
    ...(requests === undefined ? {} : { requests: requests * multiplier }),
    ...(outputSeconds === undefined
      ? {}
      : { outputSeconds: outputSeconds * multiplier }),
    ...(inputVideoSeconds === undefined
      ? {}
      : { inputVideoSeconds: inputVideoSeconds * multiplier }),
    ...(outputMegapixelSeconds === undefined
      ? {}
      : { outputMegapixelSeconds: outputMegapixelSeconds * multiplier }),
    ...((provider ?? computed) === undefined
      ? {}
      : { total: provider ?? computed }),
    source:
      provider === undefined
        ? 'computed'
        : computed === undefined
          ? 'provider'
          : 'mixed',
  });
}
