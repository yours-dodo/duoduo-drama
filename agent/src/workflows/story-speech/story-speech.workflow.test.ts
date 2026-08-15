import { describe, expect, it, vi } from 'vitest';

import type { StorySpeechGenerator } from '../../ai/story-speech-generator.js';
import type { LinearScript } from '../../contracts/story-script.js';
import { StorySpeechWorkflow } from './story-speech.workflow.js';

const SCRIPT: LinearScript = {
  title: '潮声之后',
  logline: '一句话',
  genre: '都市悬疑',
  synopsis: '梗概',
  characters: [
    {
      name: '林晚',
      role: '主角',
      personality: '冷静',
      goal: '查明真相',
      voiceId: 'voice_03.wav',
      voiceDescription: '清冷女声',
    },
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
              id: 'shot-narration',
              order: 1,
              type: 'narration',
              narration: '海风渐起。',
              visualPrompt: '远景',
              durationSeconds: 3,
            },
            {
              id: 'shot-dialogue',
              order: 2,
              type: 'dialogue',
              speaker: '林晚',
              line: '你说过，潮水退了以后，所有东西都会回来。',
              lineDelivery: '平静中带着压抑',
              visualPrompt: '特写',
              durationSeconds: 5,
            },
          ],
        },
      ],
    },
  ],
};

describe('StorySpeechWorkflow', () => {
  it('synthesizes dialogue shots only and passes the voice card', async () => {
    const synthesize = vi.fn(async () => ({
      audioBase64: 'AAAA',
      mimeType: 'audio/wav',
    }));
    const workflow = new StorySpeechWorkflow({
      synthesize,
    } as unknown as StorySpeechGenerator);

    const audio = await workflow.generate({ script: SCRIPT });

    expect(audio).toHaveLength(1);
    expect(audio[0]!.shotId).toBe('shot-dialogue');
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize.mock.calls[0]![0]).toEqual({
      text: '你说过，潮水退了以后，所有东西都会回来。',
      voiceId: 'voice_03.wav',
      voiceDescription: '清冷女声',
      lineDelivery: '平静中带着压抑',
    });
  });

  it('maps synthesis failures to agent_unavailable', async () => {
    const workflow = new StorySpeechWorkflow({
      synthesize: async () => {
        throw new Error('tts down');
      },
    } as unknown as StorySpeechGenerator);

    await expect(workflow.generate({ script: SCRIPT })).rejects.toMatchObject({
      failureCode: 'agent_unavailable',
    });
  });
});
