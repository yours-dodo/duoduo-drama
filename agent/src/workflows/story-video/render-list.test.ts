import { describe, expect, it } from 'vitest';

import type { LinearScript } from '../../contracts/story-script.js';
import {
  buildRenderList,
  buildSrt,
  parseWavDurationSeconds,
  resolveShotDurationSeconds,
} from './render-list.js';
import { silenceWavBase64 } from '../../ai/story-speech-generator.js';

const SCRIPT: LinearScript = {
  title: '潮声之后',
  logline: '一句话',
  genre: '都市悬疑',
  synopsis: '梗概',
  characters: [
    { name: '林晚', role: '主角', personality: '冷静', goal: '查明真相' },
  ],
  episodes: [
    {
      id: 'episode-1',
      order: 1,
      title: '第一集',
      summary: '摘要',
      scenes: [
        {
          id: 'scene-1',
          order: 1,
          title: '海边',
          location: '海边',
          timeOfDay: '黄昏',
          mood: '压抑',
          shots: [
            {
              id: 'shot-1',
              order: 1,
              type: 'narration',
              narration: '海风渐起，潮声由远及近。',
              visualPrompt: '远景',
              durationSeconds: 3,
            },
            {
              id: 'shot-2',
              order: 2,
              type: 'dialogue',
              speaker: '林晚',
              line: '你说过，潮水退了以后，所有东西都会回来。',
              visualPrompt: '特写',
              durationSeconds: 5,
            },
          ],
        },
      ],
    },
  ],
};

describe('buildRenderList', () => {
  it('maps scene images and shot audio into ordered segments', () => {
    const segments = buildRenderList({
      script: SCRIPT,
      images: [{ sceneId: 'scene-1', imageUrl: 'data:image/svg+xml,scene' }],
      audio: [
        { shotId: 'shot-2', audioBase64: silenceWavBase64(2), mimeType: 'audio/wav' },
      ],
    });

    expect(segments).toHaveLength(2);
    expect(segments[0]!.shotId).toBe('shot-1');
    expect(segments[0]!.audioBase64).toBeUndefined();
    expect(segments[1]!.shotId).toBe('shot-2');
    expect(segments[1]!.audioBase64).toBeDefined();
    expect(segments[1]!.subtitle).toBe('林晚：你说过，潮水退了以后，所有东西都会回来。');
    expect(segments[1]!.durationSeconds).toBe(2);
  });

  it('throws when a scene has no image', () => {
    expect(() =>
      buildRenderList({
        script: SCRIPT,
        images: [],
        audio: [],
      }),
    ).toThrow('has no generated image');
  });
});

describe('duration helpers', () => {
  it('parses WAV duration from its header', () => {
    expect(parseWavDurationSeconds(silenceWavBase64(1))).toBe(1);
    expect(parseWavDurationSeconds('not-wav')).toBeUndefined();
  });

  it('falls back to text-length estimation for narration', () => {
    const narration = SCRIPT.episodes[0]!.scenes[0]!.shots[0]!;
    expect(resolveShotDurationSeconds(narration)).toBeGreaterThanOrEqual(3);
  });
});

describe('buildSrt', () => {
  it('produces timed subtitle entries', () => {
    const segments = buildRenderList({
      script: SCRIPT,
      images: [{ sceneId: 'scene-1', imageUrl: 'data:image/svg+xml,scene' }],
      audio: [
        { shotId: 'shot-2', audioBase64: silenceWavBase64(2), mimeType: 'audio/wav' },
      ],
    });
    const srt = buildSrt(segments);
    expect(srt).toContain('00:00:00,000 --> 00:00:03,000');
    expect(srt).toContain('林晚：你说过');
  });
});

