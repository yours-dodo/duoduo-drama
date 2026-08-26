import { createAi, type AiRuntime } from '@duoduo/ai';
import { createAllowlistNetworkPolicy } from '@duoduo/ai/transport';
import { deepseekProvider } from '@duoduo/ai/providers/deepseek';

import type { StoryScriptConfig } from '../config/story-script-config.js';
import {
  type StoryTextGenerator,
  type StoryTextMessage,
} from '../workflows/story-script/story-script.workflow.js';
import { createFetchTransportDriver } from './transport.js';

export interface StoryTextGeneratorHandle {
  readonly generator: StoryTextGenerator;
  readonly dispose: () => Promise<void>;
}

/**
 * Provider-neutral adapter that composes `@duoduo/ai`. The workflow depends on
 * the StoryTextGenerator port; this adapter owns the runtime, provider
 * registration and model resolution at the application boundary.
 */
export function createAiStoryTextGenerator(
  config: StoryScriptConfig,
): StoryTextGeneratorHandle {
  if (config.provider === 'mock') {
    return {
      generator: createMockStoryTextGenerator(),
      dispose: async () => undefined,
    };
  }

  const ai = createAi({
    transport: createFetchTransportDriver(),
    networkPolicy: createAllowlistNetworkPolicy({
      origins: [providerEndpointOrigin(config)],
    }),
    ambientAuthPolicy: { allow: () => true },
  });
  const provider = buildProvider(config);
  ai.providers.register(provider);

  const generator: StoryTextGenerator = {
    async generateText(messages, options) {
      const model = await ai.models.require(modelRefFor(config), {});
      const response = await ai.complete(model, toAiContext(messages), {
        temperature: options?.temperature,
        timeoutMs: options?.timeoutMs,
        signal: options?.signal,
      });
      if (response.status === 'failed') {
        throw new Error(
          `story text model failed: ${response.error.message ?? response.error.code}`,
        );
      }
      if (response.status === 'cancelled') {
        throw new Error('story text generation was cancelled');
      }
      return response.content
        .filter((part) => part.type === 'text')
        .map((part) => (part as { text: string }).text)
        .join('\n');
    },
  };

  return { generator, dispose: () => ai.dispose() };
}

function buildProvider(config: StoryScriptConfig) {
  const defaultBaseUrl = resolveDefaultBaseUrl(config);
  const provider = deepseekProvider({
    baseUrl: config.baseUrl ?? defaultBaseUrl,
    models: [{ id: config.model }],
  });
  if (!config.apiKey) return provider;
  // `@duoduo/ai` protects the authorization header at the factory, so the
  // credential is injected through the ambient-auth authorizer at the
  // composition boundary (Agent-owned credentials, provider-owned protocol).
  return {
    ...provider,
    auth: {
      ambient: {
        resolve: async () => ({
          credentialInstanceId: 'story-text-env',
          credentialIdentityLifetime: 'process-local' as const,
          authorize: async () => ({
            authorization: `Bearer ${config.apiKey}`,
          }),
        }),
      },
    },
  };
}

function resolveDefaultBaseUrl(config: StoryScriptConfig): string | undefined {
  if (config.provider === 'openai') return 'https://api.openai.com/v1';
  if (config.provider === 'deepseek') return 'https://api.deepseek.com';
  return undefined;
}

function providerEndpointOrigin(config: StoryScriptConfig): string {
  const baseUrl = config.baseUrl ?? resolveDefaultBaseUrl(config);
  return new URL(baseUrl ?? 'https://api.deepseek.com').origin;
}

function modelRefFor(config: StoryScriptConfig) {
  return {
    providerInstanceId: 'deepseek',
    modelId: config.model,
    protocol: 'openai-chat-completions',
  } as const;
}

function toAiContext(messages: StoryTextMessage[]) {
  const systemPrompt = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  return {
    systemPrompt: systemPrompt || undefined,
    messages: messages
      .filter((message) => message.role === 'user')
      .map((message) => ({
        role: 'user' as const,
        content: [{ type: 'text' as const, text: message.content }],
      })),
  };
}

/** Deterministic local-development fallback used when no provider is configured. */
export function createMockStoryTextGenerator(): StoryTextGenerator {
  return {
    async generateText(messages) {
      if (
        messages.some((message) => message.content.includes('STORY_TAGS_JSON'))
      ) {
        return JSON.stringify({ era: '现代', tags: ['悬疑', '情感'] });
      }
      return JSON.stringify({
        title: '潮声之后',
        logline: '她必须在潮水淹没证据前，证明那个最爱她的人正在杀死她。',
        genre: '都市悬疑 / 情感',
        synopsis:
          '林晚回到订婚前夜的海边小镇，发现未婚夫周叙与三年前的失踪案有关。她一边收集证据一边确认爱人的真面目，最终在潮水淹没证据前揭开真相。',
        styleGuide: '冷色系电影感插画，海风与雾的质感，黄昏与夜景为主',
        characters: [
          {
            name: '林晚',
            role: '主角',
            personality: '冷静、执着、外柔内刚',
            goal: '查明三年前失踪案的真相',
            secret: '她曾是失踪案的第一目击者',
            voiceId: 'voice_03.wav',
            visualDescription: '黑色长发，米色风衣，眼神坚定',
            voiceDescription: '清冷女声，语速偏慢',
          },
          {
            name: '周叙',
            role: '男主 / 嫌疑人',
            personality: '温柔体贴，表面完美',
            goal: '掩盖与失踪案的联系',
            secret: '他才是失踪案的幕后推手',
            voiceId: 'voice_07.wav',
            visualDescription: '深灰西装，气质儒雅',
            voiceDescription: '低沉男声，温柔中带压迫感',
          },
        ],
        episodes: [
          {
            id: 'episode-1',
            order: 1,
            title: '潮水来之前',
            summary:
              '林晚回到小镇准备婚礼，收到一封被海水打湿的信，信中暗示周叙与三年前的失踪案有关。',
            scenes: [
              {
                id: 'episode-1-scene-1',
                order: 1,
                title: '海边公路',
                location: '海边公路',
                timeOfDay: '黄昏',
                mood: '压抑、不安',
                sceneKey: 'seaside-road-dusk',
                shots: [
                  {
                    id: 'episode-1-scene-1-shot-1',
                    order: 1,
                    type: 'narration',
                    narration:
                      '林晚站在护栏外，手里攥着一封被海水打湿的信。远处，周叙的车灯亮起。',
                    visualPrompt:
                      '黄昏的海边公路，远景，女主角背影，风衣被海风吹起，远处车灯',
                    durationSeconds: 5,
                  },
                  {
                    id: 'episode-1-scene-1-shot-2',
                    order: 2,
                    type: 'dialogue',
                    speaker: '林晚',
                    line: '你说过，潮水退了以后，所有东西都会回来。',
                    lineDelivery: '平静中带着压抑',
                    visualPrompt: '特写，女主角侧脸，逆光，海面反光',
                    durationSeconds: 5,
                  },
                  {
                    id: 'episode-1-scene-1-shot-3',
                    order: 3,
                    type: 'dialogue',
                    speaker: '周叙',
                    line: '但有些人，不该回来。',
                    lineDelivery: '低沉，意味深长',
                    visualPrompt: '中景，男主角下车，背光，表情看不清',
                    durationSeconds: 4,
                  },
                ],
              },
            ],
          },
        ],
      });
    },
  };
}

export type { AiRuntime };
