import type { ProviderContractManifest } from '../../runtime/registry.js';

export const klingContractManifest: ProviderContractManifest = Object.freeze({
  schemaVersion: 1,
  providerKind: 'kling',
  bindings: Object.freeze([
    Object.freeze({
      capability: 'videos' as const,
      protocol: 'kling-video-tasks',
      profileIds: Object.freeze(['kling-video-3-0-omni-v2']),
      authSchemes: Object.freeze(['api_key']),
      endpointBranchIds: Object.freeze([
        'omni-video-create',
        'tasks-query',
        'singapore',
        'explicit-base-url',
      ]),
      requestFixtureIds: Object.freeze([
        'kling_video_3_0_omni_create',
        'kling_video_3_0_omni_query',
      ]),
      streamFixtureIds: Object.freeze([
        'kling_video_submitted',
        'kling_video_processing',
        'kling_video_succeeded',
      ]),
      errorFixtureIds: Object.freeze([
        'kling_video_failed',
        'kling_video_expired',
      ]),
      sources: Object.freeze([
        Object.freeze({
          kind: 'official' as const,
          locator:
            'https://kling.ai/document-api/api/get-started/authentication',
        }),
        Object.freeze({
          kind: 'official' as const,
          locator:
            'https://kling.ai/document-api/api/video/3-0-omni/video-omni',
        }),
        Object.freeze({
          kind: 'fixture' as const,
          locator: 'test/fixtures/kling/videos',
        }),
      ]),
    }),
  ]),
});
