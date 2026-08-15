import { describe, expect, it, vi } from 'vitest';

import type { StoryImageGenerator } from '../../ai/story-image-generator.js';
import type { LinearScript } from '../../contracts/story-script.js';
import {
  buildSceneImagePrompt,
  StoryImagesWorkflow,
} from './story-images.workflow.js';

const SCRIPT: LinearScript = {
  title: '潮声之后',
  logline: '一句话故事',
  genre: '都市悬疑',
  synopsis: '梗概',
  styleGuide: '冷色系电影感插画',
  characters: [
    {
      name: '林晚',
      role: '主角',
      personality: '冷静执着',
      goal: '查明真相',
      visualDescription: '黑色长发，米色风衣',
    },
  ],
  episodes: [
    {
      id: 'episode-1',
      order: 1,
      title: '潮水来之前',
      summary: '摘要',
      scenes: [
        {
          id: 'episode-1-scene-1',
          order: 1,
          title: '海边公路',
          location: '海边公路',
          timeOfDay: '黄昏',
          mood: '压抑',
          sceneKey: 'seaside-road-day',
          shots: [
            {
              id: 'shot-1',
              order: 1,
              type: 'dialogue',
              speaker: '林晚',
              line: '你说过，潮水退了以后，所有东西都会回来。',
              visualPrompt: '特写，女主角侧脸，逆光，海面反光',
              durationSeconds: 5,
            },
          ],
        },
        {
          id: 'episode-1-scene-2',
          order: 2,
          title: '海边公路',
          location: '海边公路',
          timeOfDay: '夜',
          mood: '紧张',
          sceneKey: 'harbor-night',
          shots: [
            {
              id: 'shot-2',
              order: 1,
              type: 'narration',
              narration: '夜色降临，海浪声渐强。',
              visualPrompt: '中景，女主角站在护栏边，身后车灯亮起',
              durationSeconds: 4,
            },
          ],
        },
      ],
    },
  ],
};

describe('StoryImagesWorkflow', () => {
  it('generates one image per scene and passes sceneKey continuity references', async () => {
    const generate = vi.fn(async (request: { prompt: string; references: readonly string[] }) => ({
      imageUrl: `data:image/svg+xml,${encodeURIComponent(request.prompt.slice(0, 8))}`,
    }));
    const workflow = new StoryImagesWorkflow({
      generate,
    } as unknown as StoryImageGenerator);

    const images = await workflow.generate({
      script: SCRIPT,
      previousImages: {
        'harbor-night': 'data:image/svg+xml,prior',
      },
    });

    expect(images).toHaveLength(2);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]![0]).toMatchObject({ references: [] });
    expect(generate.mock.calls[1]![0]).toMatchObject({
      references: ['data:image/svg+xml,prior'],
    });
    expect(images[0]!.sceneKey).toBe('seaside-road-day');
    expect(images[0]!.prompt).toContain('冷色系电影感插画');
    expect(images[0]!.prompt).toContain('林晚');
  });

  it('maps generator failures to agent_unavailable', async () => {
    const workflow = new StoryImagesWorkflow({
      generate: async () => {
        throw new Error('provider down');
      },
    } as unknown as StoryImageGenerator);

    await expect(workflow.generate({ script: SCRIPT })).rejects.toMatchObject({
      failureCode: 'agent_unavailable',
    });
  });
});

describe('buildSceneImagePrompt', () => {
  it('includes style, scene, on-stage characters and shot visuals', () => {
    const prompt = buildSceneImagePrompt(
      SCRIPT,
      SCRIPT.episodes[0]!.scenes[0]!,
    );
    expect(prompt).toContain('画风：冷色系电影感插画');
    expect(prompt).toContain('海边公路，黄昏');
    expect(prompt).toContain('林晚（黑色长发，米色风衣）');
    expect(prompt).toContain('9:16');
  });
});
