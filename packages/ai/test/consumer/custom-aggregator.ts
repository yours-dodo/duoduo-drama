import type { Provider } from '@duoduo/ai';
import { klingProvider } from '@duoduo/ai/providers/kling';
import { openRouterProvider } from '@duoduo/ai/providers/openrouter';
import {
  channelModelIdentity,
  createAggregatorProvider,
  validateAggregatorCatalogFacts,
  type AggregatorFallbackProfile,
  type AggregatorProvider,
} from '@duoduo/ai/testing';

const id = 'consumer-aggregator';
const gateway = openRouterProvider({
  id,
  baseUrl: 'https://aggregator.example/v1',
});
const videoGateway = klingProvider({
  id,
  baseUrl: 'https://aggregator.example/kling',
});
const fallbackProfiles: readonly AggregatorFallbackProfile[] = [
  {
    id: 'chat-defaults',
    capability: 'chat',
    source: {
      providerInstanceId: id,
      modelId: gateway.chat!.models[0]!.id,
    },
    fallbacks: [],
  },
];

const aggregator: AggregatorProvider = createAggregatorProvider({
  id,
  kind: 'consumer-aggregator',
  name: 'Consumer Aggregator',
  capabilities: {
    chat: gateway.chat,
    images: gateway.images,
    videos: videoGateway.videos,
  },
  remoteCatalogFacts: validateAggregatorCatalogFacts([
    {
      capability: 'videos',
      id: 'kling-video-3-0-omni',
      upstreamModelId: 'kling-3.0-omni',
      name: 'Kling VIDEO 3.0 Omni',
      publisher: 'Kuaishou',
      family: 'Kling VIDEO',
      availability: 'available',
    },
  ]),
  fallbackProfiles,
});

const provider: Provider = aggregator;
const videoChannelIdentity = channelModelIdentity(
  'videos',
  aggregator.videos!.models[0]!,
);

void provider;
void videoChannelIdentity;
