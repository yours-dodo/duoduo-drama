import type { AiContext } from './messages.js';
import type { ModelDefinition } from './models.js';

export interface Usage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cacheWriteTokensByRetention?: Readonly<
    Partial<Record<'standard' | 'one_hour', number>>
  >;
  readonly totalTokens?: number;
  readonly serviceTier?: string;
}

export interface Cost {
  readonly currency: 'USD';
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly cacheWriteByRetention?: Readonly<
    Partial<Record<'standard' | 'one_hour', number>>
  >;
  readonly total?: number;
  readonly source: 'computed' | 'provider' | 'mixed';
}

export function calculateCost(
  model: Readonly<ModelDefinition>,
  usage: Readonly<Usage>,
): Cost | undefined {
  const rates = model.pricing?.rates;
  if (!rates) return undefined;
  const input = tokenCost(usage.inputTokens, rates.input);
  const output = tokenCost(usage.outputTokens, rates.output);
  const reasoning = tokenCost(usage.reasoningTokens, rates.reasoning);
  const cacheRead = tokenCost(usage.cacheReadTokens, rates.cacheRead);
  const aggregateCacheWrite = tokenCost(
    usage.cacheWriteTokens,
    rates.cacheWrite,
  );
  const cacheWriteByRetention = mapRetentionCost(
    usage.cacheWriteTokensByRetention,
    rates.cacheWriteByRetention,
  );
  const cacheWrite =
    cacheWriteByRetention === undefined ? aggregateCacheWrite : undefined;
  if (
    input === undefined &&
    output === undefined &&
    reasoning === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined &&
    cacheWriteByRetention === undefined
  )
    return undefined;
  return {
    currency: 'USD',
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(cacheWriteByRetention === undefined ? {} : { cacheWriteByRetention }),
    total:
      (input ?? 0) +
      (output ?? 0) +
      (reasoning ?? 0) +
      (cacheRead ?? 0) +
      (cacheWrite ?? 0) +
      (cacheWriteByRetention?.standard ?? 0) +
      (cacheWriteByRetention?.one_hour ?? 0),
    source: 'computed',
  };
}

function tokenCost(
  tokens: number | undefined,
  rate: number | undefined,
): number | undefined {
  return tokens === undefined || rate === undefined
    ? undefined
    : (tokens / 1_000_000) * rate;
}

export function estimateContextTokens(context: Readonly<AiContext>): number {
  let characters = context.systemPrompt?.length ?? 0;
  for (const message of context.messages) {
    characters += JSON.stringify(message).length;
  }
  for (const tool of context.tools ?? [])
    characters += JSON.stringify(tool).length;
  return Math.ceil(characters / 4);
}

function mapRetentionCost(
  tokens:
    Readonly<Partial<Record<'standard' | 'one_hour', number>>> | undefined,
  rates: Readonly<Partial<Record<'standard' | 'one_hour', number>>> | undefined,
): Readonly<Partial<Record<'standard' | 'one_hour', number>>> | undefined {
  if (!tokens || !rates) return undefined;
  const standard = tokenCost(tokens.standard, rates.standard);
  const oneHour = tokenCost(tokens.one_hour, rates.one_hour);
  return standard === undefined && oneHour === undefined
    ? undefined
    : {
        ...(standard === undefined ? {} : { standard }),
        ...(oneHour === undefined ? {} : { one_hour: oneHour }),
      };
}
