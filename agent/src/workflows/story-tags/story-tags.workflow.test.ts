import { describe, expect, it } from 'vitest';

import type { StoryTextGenerator } from '../story-script/story-script.workflow.js';
import {
  StoryTagsWorkflow,
  StoryTagsWorkflowError,
} from './story-tags.workflow.js';

describe('StoryTagsWorkflow', () => {
  it('parses the constrained era and content tags response', async () => {
    const workflow = new StoryTagsWorkflow(generatorWith(JSON.stringify({
      era: '古代',
      tags: ['宫廷', '权谋', '宫廷'],
    })));

    await expect(
      workflow.summarize({ title: '长安夜雨', description: '一场宫廷权力斗争。' }),
    ).resolves.toEqual({ era: '古代', tags: ['宫廷', '权谋'] });
  });

  it('rejects an era that cannot be represented by the product', async () => {
    const workflow = new StoryTagsWorkflow(
      generatorWith(JSON.stringify({ era: '未来', tags: ['科幻'] })),
    );

    await expect(
      workflow.summarize({ title: '时间裂缝', description: '城市被未知能量改变。' }),
    ).rejects.toMatchObject<StoryTagsWorkflowError>({
      failureCode: 'protocol_error',
    });
  });
});

function generatorWith(response: string): StoryTextGenerator {
  return {
    async generateText() {
      return response;
    },
  };
}
