import type { StorySpeechConfig } from '../config/story-speech-config.js';

export interface StorySpeechRequest {
  text: string;
  /** IndexTTS built-in voice (e.g. voice_03.wav) chosen per character. */
  voiceId?: string;
  /** Per-character voice card; concrete adapters may map it to a voice id. */
  voiceDescription?: string;
  /** Voice-acting direction for the line. */
  lineDelivery?: string;
}

export interface StorySpeechResult {
  audioBase64: string;
  mimeType: string;
}

export interface StorySpeechGenerator {
  synthesize(request: StorySpeechRequest): Promise<StorySpeechResult>;
}

export interface StorySpeechGeneratorHandle {
  readonly generator: StorySpeechGenerator;
  readonly dispose: () => Promise<void>;
}

/**
 * TTS adapter at the application boundary. `@duoduo/ai` has no speech
 * capability yet, so this adapter speaks the OpenAI-compatible
 * `/v1/audio/speech` protocol directly; a future `@duoduo/ai/speech` module
 * should own the wire protocol and this class should shrink to composition.
 */
export function createStorySpeechGenerator(
  config: StorySpeechConfig,
): StorySpeechGeneratorHandle {
  if (config.provider === 'mock') {
    return {
      generator: createMockStorySpeechGenerator(),
      dispose: async () => undefined,
    };
  }
  if (config.provider === 'indextts') {
    return {
      generator: createIndexTtsGenerator(config),
      dispose: async () => undefined,
    };
  }

  const endpoint = buildSpeechEndpoint(config.baseUrl);
  const generator: StorySpeechGenerator = {
    async synthesize(request) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey
            ? { authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: config.model,
          voice: config.voice,
          input: request.text,
          response_format: config.responseFormat,
          speed: 1,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`speech synthesis failed with HTTP ${response.status}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return {
        audioBase64: Buffer.from(bytes).toString('base64'),
        mimeType:
          config.responseFormat === 'wav' ? 'audio/wav' : 'audio/mpeg',
      };
    },
  };

  return { generator, dispose: async () => undefined };
}

/**
 * Adapter for the project's self-hosted IndexTTS service
 * (`POST {baseUrl}/api/tts`, returns `audio/wav` bytes). `lineDelivery` maps
 * to `emotion_text` so voice-acting direction reaches the emotion model.
 */
function createIndexTtsGenerator(config: StorySpeechConfig): StorySpeechGenerator {
  return {
    async synthesize(request) {
      const baseUrl = (config.baseUrl?.trim() || 'http://127.0.0.1:3200').replace(
        /\/$/,
        '',
      );
      const response = await fetch(`${baseUrl}/api/tts`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey
            ? { authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          text: request.text,
          lang: config.lang,
          reference_audio: request.voiceId ?? config.referenceAudio,
          duration_factor: config.durationFactor,
          emotion_text: request.lineDelivery,
          emotion_alpha: config.emotionAlpha,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) {
        const detail = await readTtsErrorDetail(response);
        throw new Error(
          `speech synthesis failed with HTTP ${response.status}${
            detail ? `: ${detail}` : ''
          }`,
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        audioBase64: Buffer.from(bytes).toString('base64'),
        mimeType: 'audio/wav',
      };
    },
  };
}

async function readTtsErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as { detail?: string; message?: string };
    return payload.detail ?? payload.message;
  } catch {
    return undefined;
  }
}

function buildSpeechEndpoint(baseUrl: string | undefined): string {
  const normalized = (baseUrl?.trim() || 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  );
  return normalized.endsWith('/v1')
    ? `${normalized}/audio/speech`
    : `${normalized}/v1/audio/speech`;
}

/** Deterministic local-development fallback: a valid short silence WAV. */
export function createMockStorySpeechGenerator(): StorySpeechGenerator {
  return {
    async synthesize() {
      return { audioBase64: silenceWavBase64(1), mimeType: 'audio/wav' };
    },
  };
}

/**
 * 16-bit 22050 Hz mono WAV silence. 8-bit PCM is unsigned, so zero data
 * bytes decode to full-scale negative DC instead of silence — this caused
 * loud buzzing/popping in narration segments.
 */
export function silenceWavBase64(seconds: number): string {
  const sampleRate = 22050;
  const bitsPerSample = 16;
  const channels = 1;
  const blockAlign = (bitsPerSample / 8) * channels;
  const byteRate = sampleRate * blockAlign;
  const dataLength = sampleRate * seconds * blockAlign;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer.toString('base64');
}
