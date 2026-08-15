import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoryImageConfig } from '../config/story-image-config.js';
import { createAiStoryImageGenerator } from './story-image-generator.js';

describe('openai-compatible image generator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const config: StoryImageConfig = {
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9999/v1',
    apiKey: 'secret',
    model: 'flux',
    responseFormat: 'url',
    size: '1024x1792',
    promptExtend: true,
    watermark: false,
  };

  it('maps a base64 image response to a data URI', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: 'QUJD' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { generator } = createAiStoryImageGenerator(config);
    const result = await generator.generate({ prompt: '海边黄昏' });

    expect(result.imageUrl).toBe('data:image/png;base64,QUJD');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:9999/v1/images/generations');
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret' });
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'flux',
      prompt: '海边黄昏',
      size: '1024x1792',
    });
  });

  it('maps a URL image response directly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ url: 'https://cdn.example/x.png' }] }),
      })),
    );

    const { generator } = createAiStoryImageGenerator(config);
    const result = await generator.generate({ prompt: '夜景' });
    expect(result.imageUrl).toBe('https://cdn.example/x.png');
  });

  it('throws when the endpoint returns no image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      })),
    );

    const { generator } = createAiStoryImageGenerator(config);
    await expect(generator.generate({ prompt: 'x' })).rejects.toThrow(
      'returned no image',
    );
  });

  it('still serves the mock generator when configured', async () => {
    const { generator } = createAiStoryImageGenerator({
      provider: 'mock',
      model: 'mock',
      responseFormat: 'url',
      size: '1024x1792',
      promptExtend: true,
      watermark: false,
    });
    const result = await generator.generate({ prompt: '测试' });
    expect(result.imageUrl.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('maps the self-hosted /api/generate response to an absolute URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          images: [{ url: '/generated/2026-08-15T04-50-19-165Z-1.png' }],
        }),
      })),
    );

    const { generator } = createAiStoryImageGenerator({
      provider: 'self-hosted',
      baseUrl: 'http://localhost:3100',
      model: 'flux',
      responseFormat: 'url',
      size: '1536*2048',
      negativePrompt: '模糊',
      promptExtend: true,
      watermark: false,
    });
    const result = await generator.generate({ prompt: '海边黄昏' });

    expect(result.imageUrl).toBe(
      'http://localhost:3100/generated/2026-08-15T04-50-19-165Z-1.png',
    );
  });
});
