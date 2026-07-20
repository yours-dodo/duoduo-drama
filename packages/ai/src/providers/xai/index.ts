import { createHash } from 'node:crypto';

import type {
  Provider,
  ProviderProtocolManifest,
} from '../../runtime/registry.js';
import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';
import {
  createXAiImagesBinding as buildXAiImagesBinding,
  type XAiImageModelInput,
} from './images.js';
import {
  createXAiVideosBinding as buildXAiVideosBinding,
  type XAiVideoModelInput,
} from './videos.js';

const descriptor = requireCompatibleDescriptor('xai');

export interface XAiProviderOptions extends CompatibleProviderOptions {
  readonly imageModels?: readonly XAiImageModelInput[] | false;
  readonly videoModels?: readonly XAiVideoModelInput[] | false;
}

export function xAiProvider(options: XAiProviderOptions = {}): Provider {
  const base = createCompatibleProvider(descriptor, options);
  const mediaBaseUrl = normalizeMediaBase(
    options.baseUrl ?? 'https://api.x.ai/v1',
  );
  const images =
    options.imageModels === false
      ? undefined
      : buildXAiImagesBinding({
          providerInstanceId: base.id,
          baseUrl: mediaBaseUrl,
          ...(options.imageModels ? { models: options.imageModels } : {}),
        });
  const videos =
    options.videoModels === false
      ? undefined
      : buildXAiVideosBinding({
          providerInstanceId: base.id,
          baseUrl: mediaBaseUrl,
          ...(options.videoModels ? { models: options.videoModels } : {}),
        });
  const mediaBindings: ProviderProtocolManifest[] = [
    ...(images
      ? [
          {
            capability: 'images' as const,
            protocol: 'xai-images',
            profileIds: ['xai-images-v1'],
            authSchemes: ['api-key', 'oauth'],
            endpointBranchIds: ['generate', 'edit'],
            requestFixtureIds: ['generate', 'edit'],
            streamFixtureIds: ['generate-success', 'edit-base64'],
            errorFixtureIds: ['provider-error'],
            sources: [
              {
                kind: 'official' as const,
                locator:
                  'https://docs.x.ai/developers/model-capabilities/image/generation',
              },
            ],
          },
        ]
      : []),
    ...(videos
      ? [
          {
            capability: 'videos' as const,
            protocol: 'xai-videos',
            profileIds: ['xai-videos-v1'],
            authSchemes: ['api-key', 'oauth'],
            endpointBranchIds: ['generate', 'edit', 'extend', 'poll'],
            requestFixtureIds: ['generate', 'edit', 'extend'],
            streamFixtureIds: ['pending', 'completed'],
            errorFixtureIds: ['failed', 'expired'],
            sources: [
              {
                kind: 'official' as const,
                locator:
                  'https://docs.x.ai/developers/model-capabilities/video/generation',
              },
              {
                kind: 'official' as const,
                locator:
                  'https://docs.x.ai/developers/model-capabilities/video/edit',
              },
              {
                kind: 'official' as const,
                locator:
                  'https://docs.x.ai/developers/model-capabilities/video/extend',
              },
            ],
          },
        ]
      : []),
  ];
  return Object.freeze({
    ...base,
    identity: Object.freeze({
      ...base.identity,
      mediaBaseUrl,
      imageModels: JSON.stringify(options.imageModels ?? 'default'),
      videoModels: JSON.stringify(options.videoModels ?? 'default'),
    }),
    auth: Object.freeze({
      ...base.auth,
      policyFingerprint: `${base.auth?.policyFingerprint ?? 'xai'}:${createHash(
        'sha256',
      )
        .update(
          JSON.stringify([
            mediaBaseUrl,
            options.imageModels ?? 'default',
            options.videoModels ?? 'default',
          ]),
        )
        .digest('base64url')}`,
    }),
    contractManifest: Object.freeze({
      schemaVersion: 1 as const,
      providerKind: 'xai',
      bindings: Object.freeze([
        ...(base.contractManifest?.bindings ?? []),
        ...mediaBindings,
      ]),
    }),
    ...(images ? { images } : {}),
    ...(videos ? { videos } : {}),
  });
}

export const createXAiProvider = xAiProvider;

export function xAiModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as xAiProviderDescriptor };
export type { CompatibleModelInput as XAiModelInput } from '../_shared/openai-compatible.js';
export {
  createXAiImagesBinding,
  xAiImageModelRef,
  type XAiImageModelInput,
} from './images.js';
export {
  createXAiVideosBinding,
  xAiVideoModelRef,
  type XAiVideoModelInput,
} from './videos.js';

function normalizeMediaBase(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('xAI baseUrl must use https');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}
