export type StoryTextProviderKind =
  | 'deepseek'
  | 'openai'
  | 'openai-compatible'
  | 'mock';

export const STORY_SCRIPT_CONFIG = Symbol('STORY_SCRIPT_CONFIG');

export interface StoryScriptConfig {
  provider: StoryTextProviderKind;
  baseUrl?: string;
  apiKey?: string;
  model: string;
}

const DEFAULT_MODELS: Record<Exclude<StoryTextProviderKind, 'mock'>, string> = {
  deepseek: 'deepseek-chat',
  openai: 'gpt-4.1-mini',
  'openai-compatible': 'gpt-4.1-mini',
};

export function parseStoryScriptConfig(
  environment: NodeJS.ProcessEnv,
): StoryScriptConfig {
  const provider = parseProvider(environment.STORY_TEXT_PROVIDER);
  if (provider === 'mock') {
    return { provider, model: 'mock' };
  }
  const model =
    environment.STORY_TEXT_MODEL?.trim() || DEFAULT_MODELS[provider];
  return {
    provider,
    model,
    baseUrl: environment.STORY_TEXT_BASE_URL?.trim() || undefined,
    apiKey: environment.STORY_TEXT_API_KEY?.trim() || undefined,
  };
}

function parseProvider(value: string | undefined): StoryTextProviderKind {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === 'deepseek' ||
    normalized === 'openai' ||
    normalized === 'openai-compatible'
  ) {
    return normalized;
  }
  return 'mock';
}

export function isStoryScriptConfigured(
  config: StoryScriptConfig,
): boolean {
  return config.provider !== 'mock';
}
