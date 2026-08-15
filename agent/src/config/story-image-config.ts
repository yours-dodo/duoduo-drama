export type StoryImageProviderKind = 'self-hosted' | 'openrouter' | 'openai-compatible' | 'mock';

export const STORY_IMAGE_CONFIG = Symbol('STORY_IMAGE_CONFIG');

export interface StoryImageConfig {
  provider: StoryImageProviderKind;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  responseFormat: 'url' | 'b64_json';
  size: string;
  negativePrompt?: string;
  promptExtend: boolean;
  watermark: boolean;
}

const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';

export function parseStoryImageConfig(
  environment: NodeJS.ProcessEnv,
): StoryImageConfig {
  const provider = parseProvider(environment.STORY_IMAGE_PROVIDER);
  if (provider === 'mock') {
    return {
      provider,
      model: 'mock',
      responseFormat: 'url',
      size: '1024x1792',
      promptExtend: true,
      watermark: false,
    };
  }
  return {
    provider,
    model: environment.STORY_IMAGE_MODEL?.trim() || DEFAULT_MODEL,
    baseUrl: environment.STORY_IMAGE_BASE_URL?.trim() || undefined,
    apiKey: environment.STORY_IMAGE_API_KEY?.trim() || undefined,
    responseFormat:
      environment.STORY_IMAGE_RESPONSE_FORMAT?.trim() === 'b64_json'
        ? 'b64_json'
        : 'url',
    size:
      environment.STORY_IMAGE_SIZE?.trim() ||
      (provider === 'self-hosted' ? '1536*2048' : '1024x1792'),
    negativePrompt: environment.STORY_IMAGE_NEGATIVE_PROMPT?.trim() || undefined,
    promptExtend:
      environment.STORY_IMAGE_PROMPT_EXTEND?.trim().toLowerCase() !== 'false',
    watermark:
      environment.STORY_IMAGE_WATERMARK?.trim().toLowerCase() === 'true',
  };
}

function parseProvider(value: string | undefined): StoryImageProviderKind {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === 'self-hosted' ||
    normalized === 'openrouter' ||
    normalized === 'openai-compatible'
  ) {
    return normalized;
  }
  return 'mock';
}
