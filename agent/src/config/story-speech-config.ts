export type StorySpeechProviderKind = 'indextts' | 'openai-compatible' | 'mock';

export const STORY_SPEECH_CONFIG = Symbol('STORY_SPEECH_CONFIG');

export interface StorySpeechConfig {
  provider: StorySpeechProviderKind;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  voice: string;
  responseFormat: 'mp3' | 'wav';
  referenceAudio: string;
  /** Comma-separated built-in voice catalog offered to the story writer. */
  voiceCatalog: string;
  lang: string;
  durationFactor: number;
  emotionAlpha: number;
}

const DEFAULT_MODEL = 'tts-1';
const DEFAULT_VOICE = 'alloy';
const DEFAULT_VOICE_CATALOG = [
  'voice_01.wav',
  'voice_02.wav',
  'voice_03.wav',
  'voice_04.wav',
  'voice_05.wav',
  'voice_06.wav',
  'voice_07.wav',
  'voice_08.wav',
  'voice_09.wav',
  'voice_11.wav',
  'voice_12.wav',
  'emo_hate.wav',
  'emo_sad.wav',
].join(',');

export function parseStorySpeechConfig(
  environment: NodeJS.ProcessEnv,
): StorySpeechConfig {
  const provider = parseProvider(environment.STORY_SPEECH_PROVIDER);
  if (provider === 'mock') {
    return {
      provider,
      model: 'mock',
      voice: 'mock',
      responseFormat: 'mp3',
      referenceAudio: 'voice_01.wav',
      voiceCatalog: DEFAULT_VOICE_CATALOG,
      lang: 'ZH',
      durationFactor: 1,
      emotionAlpha: 1,
    };
  }
  return {
    provider,
    model: environment.STORY_SPEECH_MODEL?.trim() || DEFAULT_MODEL,
    voice: environment.STORY_SPEECH_VOICE?.trim() || DEFAULT_VOICE,
    baseUrl: environment.STORY_SPEECH_BASE_URL?.trim() || undefined,
    apiKey: environment.STORY_SPEECH_API_KEY?.trim() || undefined,
    responseFormat:
      environment.STORY_SPEECH_RESPONSE_FORMAT?.trim() === 'wav'
        ? 'wav'
        : 'mp3',
    referenceAudio:
      environment.STORY_SPEECH_REFERENCE_AUDIO?.trim() || 'voice_01.wav',
    voiceCatalog:
      environment.STORY_SPEECH_VOICE_CATALOG?.trim() || DEFAULT_VOICE_CATALOG,
    lang: environment.STORY_SPEECH_LANG?.trim() || 'ZH',
    durationFactor: parsePositiveNumber(
      environment.STORY_SPEECH_DURATION_FACTOR,
      1,
    ),
    emotionAlpha: parsePositiveNumber(environment.STORY_SPEECH_EMOTION_ALPHA, 1),
  };
}

function parseProvider(value: string | undefined): StorySpeechProviderKind {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'indextts' || normalized === 'openai-compatible') {
    return normalized;
  }
  return 'mock';
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
