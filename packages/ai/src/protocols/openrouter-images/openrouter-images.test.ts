import { describe, expect, it } from 'vitest';

import {
  openRouterImagesContract,
  type OpenRouterImagesCompatibility,
} from './index.js';

describe('openrouter-images protocol contract', () => {
  it('accepts only the pinned compatibility tuple', () => {
    const compatibility: OpenRouterImagesCompatibility = {
      wireVersion: 1,
      requestOperation: 'chat-completions',
      outputEncoding: 'data-url',
    };
    expect(openRouterImagesContract.parseCompatibility(compatibility)).toEqual(
      compatibility,
    );
    expect(() =>
      openRouterImagesContract.parseCompatibility({
        ...compatibility,
        wireVersion: 2,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'OPENROUTER_IMAGES_COMPATIBILITY_INVALID',
      }),
    );
  });

  it('rejects every arbitrary protocol option', () => {
    expect(openRouterImagesContract.parseOptions({})).toEqual({});
    expect(() =>
      openRouterImagesContract.parseOptions({ extra: true }),
    ).toThrowError(
      expect.objectContaining({ code: 'OPENROUTER_IMAGES_OPTIONS_INVALID' }),
    );
  });
});
