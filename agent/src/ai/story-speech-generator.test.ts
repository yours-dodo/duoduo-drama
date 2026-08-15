import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StorySpeechConfig } from '../config/story-speech-config.js';
import {
  createStorySpeechGenerator,
  silenceWavBase64,
} from './story-speech-generator.js';

describe('silenceWavBase64', () => {
  it('produces a 16-bit WAV whose data is true digital silence', () => {
    const bytes = Buffer.from(silenceWavBase64(1), 'base64');
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.readUInt16LE(22)).toBe(1); // mono
    expect(bytes.readUInt16LE(34)).toBe(16); // 16-bit PCM
    const data = bytes.subarray(44);
    expect(data.length).toBe(22050 * 2);
    expect(data.every((byte) => byte === 0)).toBe(true);
  });
});

describe('openai-compatible speech generator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const config: StorySpeechConfig = {
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9999/v1',
    apiKey: 'secret',
    model: 'cosyvoice',
    voice: 'female',
    responseFormat: 'mp3',
    referenceAudio: 'voice_01.wav',
    voiceCatalog: 'voice_01.wav,voice_07.wav',
    lang: 'ZH',
    durationFactor: 1,
    emotionAlpha: 1,
  };

  it('sends an OpenAI-compatible /audio/speech request and maps audio bytes', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('AUDIO').buffer,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { generator } = createStorySpeechGenerator(config);
    const result = await generator.synthesize({
      text: '你好',
      lineDelivery: '平静',
    });

    expect(result.mimeType).toBe('audio/mpeg');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:9999/v1/audio/speech');
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'cosyvoice',
      voice: 'female',
      input: '你好',
      response_format: 'mp3',
    });
  });

  it('honors wav response format', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );

    const { generator } = createStorySpeechGenerator({
      ...config,
      responseFormat: 'wav',
    });
    const result = await generator.synthesize({ text: 'hi' });
    expect(result.mimeType).toBe('audio/wav');
  });

  it('maps lineDelivery to emotion_text for IndexTTS', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('WAV').buffer,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { generator } = createStorySpeechGenerator({
      provider: 'indextts',
      baseUrl: 'http://127.0.0.1:3200',
      model: 'indextts',
      voice: 'voice_01.wav',
      responseFormat: 'mp3',
      referenceAudio: 'voice_07.wav',
      voiceCatalog: 'voice_01.wav,voice_07.wav',
      lang: 'ZH',
      durationFactor: 1.2,
      emotionAlpha: 0.6,
    });
    const result = await generator.synthesize({
      text: '你好',
      lineDelivery: '低沉，意味深长',
    });

    expect(result.mimeType).toBe('audio/wav');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:3200/api/tts');
    expect(JSON.parse(init.body)).toMatchObject({
      text: '你好',
      lang: 'ZH',
      reference_audio: 'voice_07.wav',
      duration_factor: 1.2,
      emotion_text: '低沉，意味深长',
      emotion_alpha: 0.6,
    });
  });

  it('uses the per-character voiceId for IndexTTS reference audio', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { generator } = createStorySpeechGenerator({
      provider: 'indextts',
      baseUrl: 'http://127.0.0.1:3200',
      model: 'indextts',
      voice: 'voice_01.wav',
      responseFormat: 'mp3',
      referenceAudio: 'voice_01.wav',
      voiceCatalog: 'voice_01.wav,voice_07.wav',
      lang: 'ZH',
      durationFactor: 1,
      emotionAlpha: 1,
    });
    await generator.synthesize({ text: '你好', voiceId: 'voice_07.wav' });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body).reference_audio).toBe('voice_07.wav');
  });
});
