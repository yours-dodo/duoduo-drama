import type { VideoProtocolProfile } from '../../videos/contracts.js';

export const klingVideoProfiles = Object.freeze({
  'kling-video-3-0-omni-v2': Object.freeze({
    id: 'kling-video-3-0-omni-v2',
    compatibility: Object.freeze({
      wireVersion: 2 as const,
      taskApi: 'kling-api-v2' as const,
      modelFamily: 'kling-video-3.0-omni' as const,
    }),
  }) satisfies VideoProtocolProfile<'kling-video-tasks'>,
});
