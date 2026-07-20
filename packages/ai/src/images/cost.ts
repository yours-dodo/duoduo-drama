import type { ImageModelDefinition } from './models.js';

export interface ImageUsage {
  readonly generatedImages?: number;
  readonly outputMegapixels?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly serviceTier?: string;
  readonly providerReportedCost?: Readonly<{
    currency: string;
    amount: number;
  }>;
}

export interface ImageCost {
  readonly currency: 'USD';
  readonly images?: number;
  readonly megapixels?: number;
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly total?: number;
  readonly source: 'computed' | 'provider' | 'mixed';
}

export function calculateImageCost(
  model: Readonly<ImageModelDefinition>,
  usage: Readonly<ImageUsage>,
): ImageCost | undefined {
  const pricing = model.pricing;
  const providerAmount =
    usage.providerReportedCost?.currency === 'USD'
      ? usage.providerReportedCost.amount
      : undefined;
  if (!pricing && providerAmount === undefined) return undefined;
  const images =
    pricing?.perImage !== undefined && usage.generatedImages !== undefined
      ? pricing.perImage * usage.generatedImages
      : undefined;
  const megapixels =
    pricing?.perMegapixel !== undefined && usage.outputMegapixels !== undefined
      ? pricing.perMegapixel * usage.outputMegapixels
      : undefined;
  const rates = pricing?.tokenRates;
  const input = tokenCost(rates?.inputPerMillion, usage.inputTokens);
  const output = tokenCost(rates?.outputPerMillion, usage.outputTokens);
  const cacheRead = tokenCost(
    rates?.cacheReadPerMillion,
    usage.cacheReadTokens,
  );
  const cacheWrite = tokenCost(
    rates?.cacheWritePerMillion,
    usage.cacheWriteTokens,
  );
  const computed = [images, megapixels, input, output, cacheRead, cacheWrite]
    .filter((value): value is number => value !== undefined)
    .reduce((sum, value) => sum + value, 0);
  const hasComputed = [
    images,
    megapixels,
    input,
    output,
    cacheRead,
    cacheWrite,
  ].some((value) => value !== undefined);
  const total = providerAmount ?? (hasComputed ? computed : undefined);
  return Object.freeze({
    currency: 'USD',
    ...(images === undefined ? {} : { images }),
    ...(megapixels === undefined ? {} : { megapixels }),
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(total === undefined ? {} : { total }),
    source:
      providerAmount === undefined
        ? 'computed'
        : hasComputed
          ? 'mixed'
          : 'provider',
  });
}

function tokenCost(
  rate: number | undefined,
  tokens: number | undefined,
): number | undefined {
  return rate === undefined || tokens === undefined
    ? undefined
    : (rate / 1_000_000) * tokens;
}
