import type { ChatProvider, Provider } from '../../runtime/registry.js';
import { ProviderRegistry } from '../../runtime/registry.js';
import type { ImageProviderBinding } from '../../images/contracts.js';
import type { VideoProviderBinding } from '../../videos/contracts.js';

export interface AggregatorCapabilityMap {
  readonly chat?: ChatProvider;
  readonly images?: ImageProviderBinding;
  readonly videos?: VideoProviderBinding;
}

export function validateAggregatorCapabilityMap(
  providerInstanceId: string,
  capabilities: Readonly<AggregatorCapabilityMap>,
): Readonly<AggregatorCapabilityMap> {
  if (providerInstanceId.trim() === '')
    throw new TypeError('aggregator provider id must not be empty');
  if (!capabilities.chat && !capabilities.images && !capabilities.videos)
    throw new TypeError('aggregator must expose at least one capability');

  const chatIds = new Set<string>();
  for (const model of capabilities.chat?.models ?? []) {
    if (model.providerInstanceId !== providerInstanceId)
      throw new Error('chat model providerInstanceId must match provider id');
    const key = `${model.providerInstanceId}\0${model.id}`;
    if (chatIds.has(key))
      throw new Error('chat model references must be unique');
    chatIds.add(key);
  }

  // Reuse the production registry's image/video protocol, profile, operation,
  // and model validation without changing the caller-owned bindings.
  const validationProvider: Provider = {
    id: providerInstanceId,
    kind: 'aggregator-contract-validation',
    name: 'Aggregator contract validation',
    ...(capabilities.images ? { images: capabilities.images } : {}),
    ...(capabilities.videos ? { videos: capabilities.videos } : {}),
  };
  new ProviderRegistry().register(validationProvider);

  return Object.freeze({
    ...(capabilities.chat ? { chat: capabilities.chat } : {}),
    ...(capabilities.images ? { images: capabilities.images } : {}),
    ...(capabilities.videos ? { videos: capabilities.videos } : {}),
  });
}

export function capabilityModelIds(
  capabilities: Readonly<AggregatorCapabilityMap>,
  capability: 'chat' | 'images' | 'videos',
): ReadonlySet<string> {
  const models =
    capability === 'chat'
      ? capabilities.chat?.models
      : capability === 'images'
        ? capabilities.images?.models
        : capabilities.videos?.models;
  return new Set((models ?? []).map((model) => model.id));
}
