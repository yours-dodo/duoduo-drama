import type { AiContext } from './messages.js';
import type { ModelDefinition } from './models.js';

export interface Usage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
  readonly serviceTier?: string;
}

export interface Cost {
  readonly currency: 'USD';
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
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
  if (input === undefined && output === undefined && reasoning === undefined)
    return undefined;
  return {
    currency: 'USD',
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    total: (input ?? 0) + (output ?? 0) + (reasoning ?? 0),
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
