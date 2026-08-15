import { describe, expect, it } from 'vitest';

import { parseStoryImageConfig } from './story-image-config.js';
import { parseStorySpeechConfig } from './story-speech-config.js';

describe('parseStoryImageConfig', () => {
  it('defaults to mock with a portrait size', () => {
    expect(parseStoryImageConfig({})).toEqual({
      provider: 'mock',
      model: 'mock',
      responseFormat: 'url',
      size: '1024x1792',
      promptExtend: true,
      watermark: false,
    });
  });

  it('parses an openai-compatible provider', () => {
    expect(
      parseStoryImageConfig({
        STORY_IMAGE_PROVIDER: 'openai-compatible',
        STORY_IMAGE_BASE_URL: 'http://127.0.0.1:9999/v1',
        STORY_IMAGE_API_KEY: 'secret',
        STORY_IMAGE_MODEL: 'flux',
        STORY_IMAGE_SIZE: '768x1344',
        STORY_IMAGE_RESPONSE_FORMAT: 'b64_json',
      }),
    ).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9999/v1',
      apiKey: 'secret',
      model: 'flux',
      responseFormat: 'b64_json',
      size: '768x1344',
      negativePrompt: undefined,
      promptExtend: true,
      watermark: false,
    });
  });

  it('parses the self-hosted image service', () => {
    expect(
      parseStoryImageConfig({
        STORY_IMAGE_PROVIDER: 'self-hosted',
        STORY_IMAGE_BASE_URL: 'http://localhost:3100',
        STORY_IMAGE_SIZE: '1536*2048',
        STORY_IMAGE_PROMPT_EXTEND: 'false',
      }),
    ).toEqual({
      provider: 'self-hosted',
      baseUrl: 'http://localhost:3100',
      apiKey: undefined,
      model: 'google/gemini-2.5-flash-image',
      responseFormat: 'url',
      size: '1536*2048',
      negativePrompt: undefined,
      promptExtend: false,
      watermark: false,
    });
  });

  it('parses openrouter with defaults', () => {
    const config = parseStoryImageConfig({
      STORY_IMAGE_PROVIDER: 'openrouter',
      STORY_IMAGE_API_KEY: 'secret',
    });
    expect(config.provider).toBe('openrouter');
    expect(config.model).toBe('google/gemini-2.5-flash-image');
  });
});

describe('parseStorySpeechConfig', () => {
  it('defaults to mock', () => {
    expect(parseStorySpeechConfig({})).toEqual({
      provider: 'mock',
      model: 'mock',
      voice: 'mock',
      responseFormat: 'mp3',
      referenceAudio: 'voice_01.wav',
      voiceCatalog:
        'voice_01.wav,voice_02.wav,voice_03.wav,voice_04.wav,voice_05.wav,voice_06.wav,voice_07.wav,voice_08.wav,voice_09.wav,voice_11.wav,voice_12.wav,emo_hate.wav,emo_sad.wav',
      lang: 'ZH',
      durationFactor: 1,
      emotionAlpha: 1,
    });
  });

  it('parses an openai-compatible provider with wav output', () => {
    expect(
      parseStorySpeechConfig({
        STORY_SPEECH_PROVIDER: 'openai-compatible',
        STORY_SPEECH_BASE_URL: 'http://127.0.0.1:9999/v1',
        STORY_SPEECH_API_KEY: 'secret',
        STORY_SPEECH_MODEL: 'cosyvoice',
        STORY_SPEECH_VOICE: 'female',
        STORY_SPEECH_RESPONSE_FORMAT: 'wav',
      }),
    ).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9999/v1',
      apiKey: 'secret',
      model: 'cosyvoice',
      voice: 'female',
      responseFormat: 'wav',
      referenceAudio: 'voice_01.wav',
      voiceCatalog:
        'voice_01.wav,voice_02.wav,voice_03.wav,voice_04.wav,voice_05.wav,voice_06.wav,voice_07.wav,voice_08.wav,voice_09.wav,voice_11.wav,voice_12.wav,emo_hate.wav,emo_sad.wav',
      lang: 'ZH',
      durationFactor: 1,
      emotionAlpha: 1,
    });
  });

  it('parses the IndexTTS service', () => {
    expect(
      parseStorySpeechConfig({
        STORY_SPEECH_PROVIDER: 'indextts',
        STORY_SPEECH_BASE_URL: 'http://127.0.0.1:3200',
        STORY_SPEECH_REFERENCE_AUDIO: 'voice_07.wav',
        STORY_SPEECH_LANG: 'EN',
        STORY_SPEECH_DURATION_FACTOR: '1.2',
        STORY_SPEECH_EMOTION_ALPHA: '0.6',
      }),
    ).toMatchObject({
      provider: 'indextts',
      baseUrl: 'http://127.0.0.1:3200',
      referenceAudio: 'voice_07.wav',
      voiceCatalog:
        'voice_01.wav,voice_02.wav,voice_03.wav,voice_04.wav,voice_05.wav,voice_06.wav,voice_07.wav,voice_08.wav,voice_09.wav,voice_11.wav,voice_12.wav,emo_hate.wav,emo_sad.wav',
      lang: 'EN',
      durationFactor: 1.2,
      emotionAlpha: 0.6,
    });
  });
});
