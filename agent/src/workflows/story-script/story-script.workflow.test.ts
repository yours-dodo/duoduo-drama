import { describe, expect, it } from 'vitest';

import {
  StoryScriptWorkflow,
  StoryScriptWorkflowError,
  type StoryTextGenerator,
} from './story-script.workflow.js';

const VALID_SCRIPT = {
  title: '潮声之后',
  logline: '她必须在潮水淹没证据前，证明那个最爱她的人正在杀死她。',
  genre: '都市悬疑',
  synopsis: '林晚回到海边小镇，发现未婚夫周叙与三年前的失踪案有关。',
  characters: [
    {
      name: '林晚',
      role: '主角',
      personality: '冷静、执着',
      goal: '查明失踪案真相',
      visualDescription: '黑色长发，常穿风衣',
      voiceDescription: '清冷女声',
    },
  ],
  episodes: [
    {
      id: 'episode-1',
      order: 1,
      title: '潮水来之前',
      summary: '林晚回到小镇，收到一封被海水打湿的信。',
      scenes: [
        {
          id: 'episode-1-scene-1',
          order: 1,
          title: '海边公路',
          location: '海边公路',
          timeOfDay: '黄昏',
          mood: '压抑',
          shots: [
            {
              id: 'episode-1-scene-1-shot-1',
              order: 1,
              type: 'narration',
              narration: '林晚站在护栏外，手里攥着一封被海水打湿的信。',
              visualPrompt: '黄昏的海边公路，远景，女主角背影，风衣被吹起',
              durationSeconds: 4,
            },
            {
              id: 'episode-1-scene-1-shot-2',
              order: 2,
              type: 'dialogue',
              speaker: '林晚',
              line: '你说过，潮水退了以后，所有东西都会回来。',
              lineDelivery: '平静中带着压抑',
              visualPrompt: '特写，女主角望着海面，逆光',
              durationSeconds: 5,
            },
          ],
        },
      ],
    },
  ],
};

function stubGenerator(respondWith: string | Error): StoryTextGenerator {
  return {
    async generateText() {
      if (respondWith instanceof Error) throw respondWith;
      return respondWith;
    },
  };
}

describe('StoryScriptWorkflow', () => {
  it('generates and validates a linear script', async () => {
    const workflow = new StoryScriptWorkflow(
      stubGenerator(JSON.stringify(VALID_SCRIPT)),
    );

    const result = await workflow.generate({
      userPrompt: '写一个海边悬疑故事',
    });

    expect(result.script.title).toBe('潮声之后');
    expect(result.script.episodes).toHaveLength(1);
    expect(result.script.episodes[0]!.scenes[0]!.shots).toHaveLength(2);
    expect(result.markdown).toContain('# 潮声之后');
    expect(result.summary).toContain('1 集，共 2 个镜头');
  });

  it('accepts markdown-fenced JSON responses', async () => {
    const workflow = new StoryScriptWorkflow(
      stubGenerator(`\`\`\`json\n${JSON.stringify(VALID_SCRIPT)}\n\`\`\``),
    );

    const result = await workflow.generate({ userPrompt: '写一个故事' });

    expect(result.script.title).toBe('潮声之后');
  });

  it('rejects invalid JSON with protocol_error', async () => {
    const workflow = new StoryScriptWorkflow(stubGenerator('not json at all'));

    await expect(
      workflow.generate({ userPrompt: '写一个故事' }),
    ).rejects.toMatchObject({ failureCode: 'protocol_error' });
  });

  it('rejects structurally invalid scripts with protocol_error', async () => {
    const workflow = new StoryScriptWorkflow(
      stubGenerator(JSON.stringify({ title: '只有标题' })),
    );

    await expect(
      workflow.generate({ userPrompt: '写一个故事' }),
    ).rejects.toMatchObject({ failureCode: 'protocol_error' });
  });

  it('maps generator failures to agent_unavailable', async () => {
    const workflow = new StoryScriptWorkflow(
      stubGenerator(new Error('upstream down')),
    );

    await expect(
      workflow.generate({ userPrompt: '写一个故事' }),
    ).rejects.toMatchObject({ failureCode: 'agent_unavailable' });
  });

  it('rejects an empty user prompt', async () => {
    const workflow = new StoryScriptWorkflow(stubGenerator('{}'));

    await expect(
      workflow.generate({ userPrompt: '   ' }),
    ).rejects.toBeInstanceOf(StoryScriptWorkflowError);
  });
});

