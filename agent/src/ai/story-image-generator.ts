import { createAi, type AiRuntime } from '@duoduo/ai';
import { imagePrompt } from '@duoduo/ai/images';
import {
  openRouterImageModelRef,
  openRouterProvider,
} from '@duoduo/ai/providers/openrouter';
import { createAllowlistNetworkPolicy } from '@duoduo/ai/transport';

import type { StoryImageConfig } from '../config/story-image-config.js';
import { createFetchTransportDriver } from './transport.js';

export interface StoryImageRequest {
  prompt: string;
  /** Reference image URLs (prior scene / character portrait) for continuity. */
  references?: readonly string[];
}

export interface StoryImageResult {
  imageUrl: string;
  imageUuid?: string;
}

export interface StoryImageGenerator {
  generate(request: StoryImageRequest): Promise<StoryImageResult>;
}

export interface StoryImageGeneratorHandle {
  readonly generator: StoryImageGenerator;
  readonly dispose: () => Promise<void>;
}

/**
 * Provider-neutral adapter composing `@duoduo/ai/images`. The workflow depends
 * on the StoryImageGenerator port; this adapter owns the runtime, provider
 * registration and model resolution at the application boundary.
 */
export function createAiStoryImageGenerator(
  config: StoryImageConfig,
): StoryImageGeneratorHandle {
  if (config.provider === 'mock') {
    return {
      generator: createMockStoryImageGenerator(),
      dispose: async () => undefined,
    };
  }
  if (config.provider === 'self-hosted') {
    return {
      generator: createSelfHostedImageGenerator(config),
      dispose: async () => undefined,
    };
  }
  if (config.provider === 'openai-compatible') {
    return {
      generator: createOpenAiCompatibleImageGenerator(config),
      dispose: async () => undefined,
    };
  }

  const ai = createAi({
    transport: createFetchTransportDriver(),
    networkPolicy: createAllowlistNetworkPolicy({
      origins: [new URL(config.baseUrl ?? 'https://openrouter.ai/api/v1').origin],
    }),
    ambientAuthPolicy: { allow: () => true },
  });
  const provider = openRouterProvider({
    baseUrl: config.baseUrl,
    imageModels: [{ id: config.model }],
  });
  ai.providers.register(
    config.apiKey
      ? {
          ...provider,
          auth: {
            ambient: {
              resolve: async () => ({
                credentialInstanceId: 'story-image-env',
                credentialIdentityLifetime: 'process-local' as const,
                authorize: async () => ({
                  authorization: `Bearer ${config.apiKey}`,
                }),
              }),
            },
          },
        }
      : provider,
  );

  const generator: StoryImageGenerator = {
    async generate(request) {
      const model = await ai.images.models.require(
        openRouterImageModelRef(config.model),
        {},
      );
      const result = await ai.images.generate(
        model,
        {
          content: imagePrompt(
            request.prompt,
            (request.references ?? []).map((url) => ({
              type: 'image' as const,
              mediaType: 'image/*',
              source: { type: 'url' as const, url },
            })),
          ),
          count: 1,
          size: 'auto',
        },
        { responseFormat: 'base64', timeoutMs: 120_000 },
      );
      if (result.status !== 'completed') {
        throw new Error(
          result.status === 'failed'
            ? `story image generation failed: ${result.error.message ?? result.error.code}`
            : 'story image generation was cancelled',
        );
      }
      const output = result.outputs.find(
        (candidate): candidate is Extract<typeof candidate, { type: 'image' }> =>
          candidate.type === 'image',
      );
      if (!output || output.image.source.type !== 'base64') {
        throw new Error('story image generation returned no image');
      }
      return { imageUrl: output.image.source.data };
    },
  };

  return { generator, dispose: () => ai.dispose() };
}

/**
 * Adapter for the project's self-hosted image service
 * (`POST {baseUrl}/api/generate`, returns `{ images: [{ url }] }` where `url`
 * is a static path under the same origin).
 */
function createSelfHostedImageGenerator(
  config: StoryImageConfig,
): StoryImageGenerator {
  return {
    async generate(request) {
      const baseUrl = (config.baseUrl?.trim() || 'http://localhost:3100').replace(
        /\/$/,
        '',
      );
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey
            ? { authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          prompt: request.prompt,
          negativePrompt: config.negativePrompt,
          size: config.size,
          n: 1,
          promptExtend: config.promptExtend,
          watermark: config.watermark,
        }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok) {
        const detail = await readErrorDetail(response);
        throw new Error(
          `story image generation failed with HTTP ${response.status}${
            detail ? `: ${detail}` : ''
          }`,
        );
      }
      const payload = (await response.json()) as {
        images?: Array<{ url?: string }>;
      };
      const url = payload.images?.[0]?.url;
      if (!url) throw new Error('story image generation returned no image');
      return {
        imageUrl: /^https?:\/\//.test(url) ? url : `${baseUrl}${url}`,
      };
    },
  };
}

async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as {
      message?: string;
      detail?: string;
    };
    return payload.message ?? payload.detail;
  } catch {
    return undefined;
  }
}

/**
 * Generic OpenAI-compatible image endpoint (`POST {baseUrl}/images/generations`)
 * for self-hosted / gateway image services. Mirrors the speech adapter: the
 * wire protocol is a thin host-side adapter because `@duoduo/ai` has no
 * generic images/generations protocol.
 */
function createOpenAiCompatibleImageGenerator(
  config: StoryImageConfig,
): StoryImageGenerator {
  return {
    async generate(request) {
      const response = await fetch(buildImagesEndpoint(config.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey
            ? { authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: config.model,
          prompt: request.prompt,
          n: 1,
          size: config.size,
          response_format: config.responseFormat,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        throw new Error(
          `story image generation failed with HTTP ${response.status}`,
        );
      }
      const payload = (await response.json()) as {
        data?: Array<{ url?: string; b64_json?: string }>;
      };
      const image = payload.data?.[0];
      if (image?.b64_json) {
        return { imageUrl: `data:image/png;base64,${image.b64_json}` };
      }
      if (image?.url) {
        return { imageUrl: image.url };
      }
      throw new Error('story image generation returned no image');
    },
  };
}

function buildImagesEndpoint(baseUrl: string | undefined): string {
  const normalized = (baseUrl?.trim() || 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  );
  if (normalized.endsWith('/images/generations')) return normalized;
  return normalized.endsWith('/v1')
    ? `${normalized}/images/generations`
    : `${normalized}/v1/images/generations`;
}

/**
 * Deterministic local-development fallback: a labeled SVG data URI so the
 * whole pipeline (workflow → storage → render) runs without any provider key.
 */
export function createMockStoryImageGenerator(): StoryImageGenerator {
  return {
    async generate(request) {
      const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280">',
        '<rect width="100%" height="100%" fill="#0d1117"/>',
        '<rect width="100%" height="100%" fill="url(#g)"/>',
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">',
        '<stop offset="0" stop-color="#1f3a5f"/>',
        '<stop offset="1" stop-color="#0b1320"/>',
        '</linearGradient></defs>',
        '<text x="40" y="80" font-family="sans-serif" font-size="28" fill="#d7e3f4">DUODUO STORY IMAGE</text>',
        '<text x="40" y="640" font-family="sans-serif" font-size="22" fill="#9fb6d4">',
        escapeXml(request.prompt.slice(0, 120)),
        '</text>',
        '</svg>',
      ].join('');
      return { imageUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
    },
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type { AiRuntime };
