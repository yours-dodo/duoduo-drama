import type {
  ModelCapabilities,
  ModelDefinition,
  ModelLimits,
  ModelPricing,
} from '../../core/models.js';
import {
  nativeProfileId,
  preferenceProfileId,
  requireQwenProfile,
  type QwenNativeRouteId,
  type QwenProtocolPreference,
} from './profiles.js';

export interface QwenAdditionalModelInput {
  readonly id: string;
  readonly upstreamModelId?: string;
  readonly name?: string;
  readonly publisher?: string;
  readonly family?: string;
  readonly protocol: QwenProtocolPreference;
  readonly protocolProfileId: string;
  readonly nativeRouteId?: QwenNativeRouteId;
  readonly capabilities?: Partial<ModelCapabilities>;
  readonly limits?: Partial<ModelLimits>;
  readonly pricing?: ModelPricing;
}

export interface BuildQwenCatalogOptions {
  readonly providerInstanceId: string;
  readonly protocolPreference: QwenProtocolPreference;
  readonly additionalModels?: readonly QwenAdditionalModelInput[];
}

export function buildQwenCatalog(
  options: BuildQwenCatalogOptions,
): readonly ModelDefinition<QwenProtocolPreference>[] {
  const models: ModelDefinition<QwenProtocolPreference>[] = [
    makeModel(options.providerInstanceId, {
      id: 'qwen-plus',
      name: 'Qwen Plus',
      protocol: options.protocolPreference,
      protocolProfileId: preferenceProfileId(options.protocolPreference),
      capabilities: { input: ['text'] },
    }),
    makeModel(options.providerInstanceId, {
      id: 'qwen-vl-max',
      name: 'Qwen VL Max',
      protocol: 'dashscope',
      protocolProfileId: nativeProfileId('multimodal-generation'),
      nativeRouteId: 'multimodal-generation',
      capabilities: { input: ['text', 'image'] },
    }),
  ];
  const ids = new Set(models.map(({ id }) => id));
  for (const input of options.additionalModels ?? []) {
    assertNoRouteInjection(input);
    if (ids.has(input.id))
      throw new Error(`duplicate Qwen model id: ${input.id}`);
    const profile = requireQwenProfile(input.protocolProfileId);
    if (profile.protocol !== input.protocol)
      throw new Error(
        `Qwen profile ${input.protocolProfileId} does not match protocol ${input.protocol}`,
      );
    if (input.protocol === 'dashscope') {
      if (!input.nativeRouteId)
        throw new Error('Qwen nativeRouteId is required for DashScope models');
      if (profile.route !== input.nativeRouteId)
        throw new Error(
          `Qwen nativeRouteId does not match profile ${input.protocolProfileId}`,
        );
    } else if (input.nativeRouteId !== undefined) {
      throw new Error('Qwen nativeRouteId is only valid for DashScope models');
    }
    models.push(makeModel(options.providerInstanceId, input));
    ids.add(input.id);
  }
  return Object.freeze(models);
}

function makeModel(
  providerInstanceId: string,
  input: QwenAdditionalModelInput,
): ModelDefinition<QwenProtocolPreference> {
  const capabilities = input.capabilities ?? {};
  const limits = input.limits ?? {};
  return Object.freeze({
    id: input.id,
    upstreamModelId: input.upstreamModelId ?? input.id,
    name: input.name ?? input.id,
    providerInstanceId,
    publisher: input.publisher ?? 'Alibaba Cloud',
    family: input.family ?? 'Qwen',
    protocol: input.protocol,
    protocolProfileId: input.protocolProfileId,
    capabilities: Object.freeze({
      input: capabilities.input ?? (['text'] as const),
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
      contextTokens: limits.contextTokens ?? 131_072,
      maxOutputTokens: limits.maxOutputTokens ?? 16_384,
      ...(limits.maxInputImages === undefined
        ? {}
        : { maxInputImages: limits.maxInputImages }),
      ...(limits.maxInputImageBytes === undefined
        ? {}
        : { maxInputImageBytes: limits.maxInputImageBytes }),
    }),
    ...(input.pricing ? { pricing: Object.freeze(input.pricing) } : {}),
  });
}

function assertNoRouteInjection(input: QwenAdditionalModelInput): void {
  const record = input as unknown as Record<string, unknown>;
  for (const name of ['path', 'route', 'url', 'endpoint']) {
    if (record[name] !== undefined)
      throw new Error(`Qwen additional model cannot provide ${name}`);
  }
  if (
    input.nativeRouteId !== undefined &&
    input.nativeRouteId !== 'text-generation' &&
    input.nativeRouteId !== 'multimodal-generation'
  )
    throw new Error(
      `invalid Qwen nativeRouteId: ${String(input.nativeRouteId)}`,
    );
}
