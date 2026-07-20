import { describe, expect, it } from 'vitest';

import {
  qwenProvider,
  qwenModelRef,
  type QwenProtocolPreference,
  type QwenRegion,
} from './index.js';
import { resolveQwenEndpoints } from './endpoints.js';

const regions: readonly QwenRegion[] = [
  'cn-beijing',
  'ap-southeast-1',
  'us-east-1',
  'cn-hongkong',
  'ap-northeast-1',
  'eu-central-1',
];

const preferences: readonly QwenProtocolPreference[] = [
  'openai-chat-completions',
  'openai-responses',
  'anthropic-messages',
  'dashscope',
];

describe('Qwen provider', () => {
  it('freezes all six region shared/workspace endpoint branches', () => {
    expect(regions.map((region) => [region, safeShared(region)])).toEqual([
      ['cn-beijing', 'https://dashscope.aliyuncs.com'],
      ['ap-southeast-1', 'https://dashscope-intl.aliyuncs.com'],
      ['us-east-1', 'https://dashscope-us.aliyuncs.com'],
      ['cn-hongkong', 'https://cn-hongkong.dashscope.aliyuncs.com'],
      ['ap-northeast-1', 'unsupported'],
      ['eu-central-1', 'unsupported'],
    ]);
    expect(regions.map((region) => [region, safeWorkspace(region)])).toEqual([
      ['cn-beijing', 'https://workspace-1.cn-beijing.maas.aliyuncs.com'],
      [
        'ap-southeast-1',
        'https://workspace-1.ap-southeast-1.maas.aliyuncs.com',
      ],
      ['us-east-1', 'unsupported'],
      ['cn-hongkong', 'https://workspace-1.cn-hongkong.maas.aliyuncs.com'],
      [
        'ap-northeast-1',
        'https://workspace-1.ap-northeast-1.maas.aliyuncs.com',
      ],
      ['eu-central-1', 'https://workspace-1.eu-central-1.maas.aliyuncs.com'],
    ]);
  });

  it('rejects unavailable modes and invalid workspace boundaries', () => {
    expect(() =>
      resolveQwenEndpoints({
        region: 'cn-beijing',
        workspaceId: 'workspace-1',
      }),
    ).toThrowError(/shared mode forbids workspaceId/);
    expect(() =>
      resolveQwenEndpoints({
        region: 'cn-beijing',
        endpointMode: 'workspace',
      }),
    ).toThrowError(/workspaceId is required/);
    expect(() =>
      resolveQwenEndpoints({
        region: 'us-east-1',
        endpointMode: 'workspace',
        workspaceId: 'workspace-1',
      }),
    ).toThrowError(/workspace.*not supported/);
    expect(() =>
      resolveQwenEndpoints({
        region: 'ap-northeast-1',
        endpointMode: 'workspace',
        workspaceId: 'evil.example/path',
      }),
    ).toThrowError(/workspaceId is invalid/);
  });

  it('selects one deterministic binding for each protocol preference', () => {
    expect(
      preferences.map((protocolPreference) => {
        const provider = qwenProvider({
          id: `qwen-${protocolPreference}`,
          region: 'cn-beijing',
          protocolPreference,
        });
        const compatible = provider.chat?.models.find(
          ({ id }) => id === 'qwen-plus',
        );
        const native = provider.chat?.models.find(
          ({ id }) => id === 'qwen-vl-max',
        );
        return [
          protocolPreference,
          compatible?.protocol,
          native?.protocol,
          provider.chat?.transport?.endpointForModel?.(compatible!),
          provider.chat?.transport?.endpointForModel?.(native!),
        ];
      }),
    ).toEqual([
      [
        'openai-chat-completions',
        'openai-chat-completions',
        'dashscope',
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      ],
      [
        'openai-responses',
        'openai-responses',
        'dashscope',
        'https://dashscope.aliyuncs.com/compatible-mode/v1/responses',
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      ],
      [
        'anthropic-messages',
        'anthropic-messages',
        'dashscope',
        'https://dashscope.aliyuncs.com/apps/anthropic/v1/messages',
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      ],
      [
        'dashscope',
        'dashscope',
        'dashscope',
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      ],
    ]);
  });

  it('only accepts curated native route ids and never caller paths', () => {
    const provider = qwenProvider({
      region: 'cn-beijing',
      protocolPreference: 'dashscope',
      additionalModels: [
        {
          id: 'custom-vl',
          upstreamModelId: 'custom-vl-upstream',
          name: 'Custom VL',
          protocol: 'dashscope',
          protocolProfileId: 'qwen-dashscope-multimodal',
          nativeRouteId: 'multimodal-generation',
        },
      ],
    });
    const custom = provider.chat?.models.find(({ id }) => id === 'custom-vl');
    expect(provider.chat?.transport?.endpointForModel?.(custom!)).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect(() =>
      qwenProvider({
        region: 'cn-beijing',
        additionalModels: [
          {
            id: 'injected',
            protocol: 'dashscope',
            protocolProfileId: 'qwen-dashscope-text',
            nativeRouteId: '/services/aigc/evil?token=1',
          } as never,
        ],
      }),
    ).toThrowError(/nativeRouteId/);
    expect(qwenModelRef('qwen-plus', 'openai-responses', 'qwen-cn')).toEqual({
      providerInstanceId: 'qwen-cn',
      modelId: 'qwen-plus',
      protocol: 'openai-responses',
    });
  });
});

function safeShared(region: QwenRegion): string {
  try {
    return resolveQwenEndpoints({ region }).origin;
  } catch {
    return 'unsupported';
  }
}

function safeWorkspace(region: QwenRegion): string {
  try {
    return resolveQwenEndpoints({
      region,
      endpointMode: 'workspace',
      workspaceId: 'workspace-1',
    }).origin;
  } catch {
    return 'unsupported';
  }
}
