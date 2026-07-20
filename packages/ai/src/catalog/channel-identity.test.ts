import { describe, expect, it } from 'vitest';

import { klingProvider } from '../providers/kling/index.js';
import {
  channelCatalogIdentity,
  channelModelIdentity,
  channelOperationIdentity,
} from '../testing/contracts/channel-isolation.js';

describe('channel identity', () => {
  it('keeps direct and aggregator models isolated even when publisher and family match', () => {
    const direct = klingProvider({
      id: 'kling-direct',
      videoModels: [
        {
          pricing: { currency: 'USD', perOutputSecond: 0.2 },
        },
      ],
    });
    const aggregator = klingProvider({
      id: 'aggregator-a',
      baseUrl: 'https://aggregator.example/kling',
      videoModels: [
        {
          pricing: { currency: 'USD', perOutputSecond: 0.35 },
        },
      ],
    });
    const directModel = direct.videos!.models[0]!;
    const aggregatorModel = aggregator.videos!.models[0]!;
    const directProtocol = direct.videos!.protocols[0]!;
    const aggregatorProtocol = aggregator.videos!.protocols[0]!;

    expect(directModel.publisher).toBe(aggregatorModel.publisher);
    expect(directModel.family).toBe(aggregatorModel.family);
    expect(directModel.pricing).not.toEqual(aggregatorModel.pricing);
    expect(channelModelIdentity('videos', directModel)).not.toBe(
      channelModelIdentity('videos', aggregatorModel),
    );
    expect(
      channelCatalogIdentity(
        'videos',
        direct.id,
        direct.videos!.catalogCompatibilityVersion,
      ),
    ).not.toBe(
      channelCatalogIdentity(
        'videos',
        aggregator.id,
        aggregator.videos!.catalogCompatibilityVersion,
      ),
    );
    expect(
      channelOperationIdentity(
        'videos',
        directModel,
        directProtocol.operationMode === 'resumable'
          ? directProtocol.operationCompatibilityVersion
          : 'direct',
      ),
    ).not.toBe(
      channelOperationIdentity(
        'videos',
        aggregatorModel,
        aggregatorProtocol.operationMode === 'resumable'
          ? aggregatorProtocol.operationCompatibilityVersion
          : 'direct',
      ),
    );
  });
});
