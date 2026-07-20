import type {
  CommonStreamRequestDefaults,
  ModelCapabilities,
  ModelDefinition,
  ModelLimits,
  ModelPricing,
} from '../../core/models.js';
import {
  compatibilityProfile,
  requireDoubaoProfile,
  type DoubaoTextProtocol,
} from './profiles.js';

export type DoubaoUpstream =
  | Readonly<{ type: 'model'; modelId: string }>
  | Readonly<{ type: 'endpoint'; endpointId: string }>;

export interface DoubaoExplicitModelInput {
  readonly id: string;
  readonly name?: string;
  readonly publisher?: string;
  readonly family?: string;
  readonly upstream: DoubaoUpstream;
  readonly protocol: DoubaoTextProtocol;
  readonly protocolProfileId: string;
  readonly capabilities?: Partial<ModelCapabilities>;
  readonly limits?: Partial<ModelLimits>;
  readonly requestDefaults?: CommonStreamRequestDefaults;
  readonly pricing?: ModelPricing;
}

export interface BuildDoubaoCatalogOptions {
  readonly providerInstanceId: string;
  readonly compatibilityMode: 'responses' | 'chat-completions';
  readonly additionalModels?: readonly DoubaoExplicitModelInput[];
}

export function buildDoubaoCatalog(
  options: BuildDoubaoCatalogOptions,
): readonly ModelDefinition<DoubaoTextProtocol>[] {
  const profile = compatibilityProfile(options.compatibilityMode);
  const models: ModelDefinition<DoubaoTextProtocol>[] = [
    makeModel(options.providerInstanceId, {
      id: 'doubao-seed-1-6',
      name: 'Doubao Seed 1.6',
      upstream: { type: 'model', modelId: 'doubao-seed-1-6' },
      protocol: profile.protocol,
      protocolProfileId: profile.id,
    }),
  ];
  const ids = new Set(models.map(({ id }) => id));
  for (const input of options.additionalModels ?? []) {
    assertExplicitInput(input);
    if (ids.has(input.id))
      throw new Error(`duplicate Doubao model id: ${input.id}`);
    const selected = requireDoubaoProfile(input.protocolProfileId);
    if (selected.protocol !== input.protocol)
      throw new Error(
        `Doubao profile ${input.protocolProfileId} does not match protocol ${input.protocol}`,
      );
    models.push(makeModel(options.providerInstanceId, input));
    ids.add(input.id);
  }
  return Object.freeze(models);
}

function makeModel(
  providerInstanceId: string,
  input: DoubaoExplicitModelInput,
): ModelDefinition<DoubaoTextProtocol> {
  const capabilities = input.capabilities ?? {};
  const limits = input.limits ?? {};
  const upstreamModelId =
    input.upstream.type === 'model'
      ? input.upstream.modelId
      : input.upstream.endpointId;
  if (!upstreamModelId.trim())
    throw new Error('Doubao upstream ID is required');
  return Object.freeze({
    id: input.id,
    upstreamModelId,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: input.publisher ?? 'Volcengine',
    family: input.family ?? 'Doubao',
    protocol: input.protocol,
    protocolProfileId: input.protocolProfileId,
    capabilities: Object.freeze({
      input: capabilities.input ?? (['text', 'image'] as const),
      streaming: capabilities.streaming ?? true,
      reasoning: capabilities.reasoning ?? true,
      toolCalling: capabilities.toolCalling ?? true,
      parallelToolCalls: capabilities.parallelToolCalls ?? true,
      deferredTools: capabilities.deferredTools ?? false,
      thinkingLevels:
        capabilities.thinkingLevels ??
        (['none', 'low', 'medium', 'high'] as const),
    }),
    limits: Object.freeze({
      contextTokens: limits.contextTokens ?? 256_000,
      maxOutputTokens: limits.maxOutputTokens ?? 32_768,
      ...(limits.maxInputImages === undefined
        ? {}
        : { maxInputImages: limits.maxInputImages }),
      ...(limits.maxInputImageBytes === undefined
        ? {}
        : { maxInputImageBytes: limits.maxInputImageBytes }),
    }),
    ...(input.requestDefaults
      ? { requestDefaults: Object.freeze(input.requestDefaults) }
      : {}),
    ...(input.pricing ? { pricing: Object.freeze(input.pricing) } : {}),
  });
}

function assertExplicitInput(input: DoubaoExplicitModelInput): void {
  const record = input as unknown as Record<string, unknown>;
  for (const name of [
    'path',
    'route',
    'url',
    'endpoint',
    'headers',
    'builtinTools',
    'builtin_tools',
    'passthrough',
  ]) {
    if (record[name] !== undefined)
      throw new Error(`Doubao additional model cannot provide ${name}`);
  }
  if (
    !input.upstream ||
    (input.upstream.type !== 'model' && input.upstream.type !== 'endpoint')
  )
    throw new Error('Doubao upstream must be a model or endpoint ID');
}
