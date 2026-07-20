import type { ProviderContractManifest } from '../../runtime/registry.js';
import { doubaoProtocolProfiles } from './profiles.js';

export const doubaoContractManifest: ProviderContractManifest = Object.freeze({
  schemaVersion: 1,
  providerKind: 'doubao',
  bindings: Object.freeze([
    ...doubaoProtocolProfiles.map((profile) =>
      Object.freeze({
        capability: 'chat' as const,
        protocol: profile.protocol,
        profileIds: Object.freeze([profile.id]),
        authSchemes: Object.freeze(['api_key']),
        endpointBranchIds: Object.freeze([
          'cn-beijing-ark-v3',
          'explicit-base-url',
        ]),
        requestFixtureIds: Object.freeze([
          `doubao_${profile.protocol}_model_request`,
          `doubao_${profile.protocol}_endpoint_request`,
        ]),
        streamFixtureIds: Object.freeze([
          profile.protocol === 'ark-responses'
            ? 'doubao_ark_thinking_tool_stream'
            : `doubao_${profile.protocol}_stream`,
        ]),
        errorFixtureIds: Object.freeze(['doubao_invalid_request']),
        sources: Object.freeze([
          Object.freeze({
            kind: 'official' as const,
            locator: 'https://www.volcengine.com/docs/82379/1795150',
          }),
          Object.freeze({
            kind: 'fixture' as const,
            locator: 'test/fixtures/doubao/text',
          }),
        ]),
      }),
    ),
    Object.freeze({
      capability: 'images' as const,
      protocol: 'ark-images',
      profileIds: Object.freeze(['doubao-ark-images-v1']),
      authSchemes: Object.freeze(['api_key']),
      endpointBranchIds: Object.freeze([
        'cn-beijing-ark-v3',
        'explicit-base-url',
      ]),
      requestFixtureIds: Object.freeze([
        'doubao_seedream_model_request',
        'doubao_seedream_endpoint_request',
      ]),
      streamFixtureIds: Object.freeze([
        'doubao_seedream_model_result',
        'doubao_seedream_endpoint_result',
      ]),
      errorFixtureIds: Object.freeze(['doubao_seedream_invalid_request']),
      sources: Object.freeze([
        Object.freeze({
          kind: 'official' as const,
          locator:
            'https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01',
        }),
        Object.freeze({
          kind: 'fixture' as const,
          locator: 'test/fixtures/doubao/images',
        }),
      ]),
    }),
    Object.freeze({
      capability: 'videos' as const,
      protocol: 'ark-video-tasks',
      profileIds: Object.freeze(['doubao-seedance-2-v1']),
      authSchemes: Object.freeze(['api_key']),
      endpointBranchIds: Object.freeze([
        'create',
        'poll',
        'cn-beijing-ark-v3',
        'explicit-base-url',
      ]),
      requestFixtureIds: Object.freeze([
        'doubao_seedance_2_create',
        'doubao_seedance_2_poll',
      ]),
      streamFixtureIds: Object.freeze([
        'doubao_seedance_2_queued',
        'doubao_seedance_2_running',
        'doubao_seedance_2_succeeded',
      ]),
      errorFixtureIds: Object.freeze([
        'doubao_seedance_2_failed',
        'doubao_seedance_2_expired',
      ]),
      sources: Object.freeze([
        Object.freeze({
          kind: 'official' as const,
          locator:
            'https://api.volcengine.com/api-docs/view?action=CreateContentsGenerationsTasks&serviceCode=ark&version=2024-01-01',
        }),
        Object.freeze({
          kind: 'official' as const,
          locator:
            'https://api.volcengine.com/api-docs/view?action=GetContentsGenerationsTask&serviceCode=ark&version=2024-01-01',
        }),
        Object.freeze({
          kind: 'fixture' as const,
          locator: 'test/fixtures/doubao/seedance-2',
        }),
      ]),
    }),
  ]),
});
