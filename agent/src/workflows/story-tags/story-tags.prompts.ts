import type { StoryTextMessage } from '../story-script/story-script.workflow.js';

export function buildStoryTagMessages(input: {
  title: string;
  description: string;
}): StoryTextMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是故事策划编辑。请根据故事标题和描述总结用于项目筛选的标签。',
        '必须只输出一个 JSON 对象，不要 Markdown、解释或额外文字。',
        'JSON 格式必须是：{"era":"现代"或"古代","tags":["标签1","标签2"]}。',
        'era 只能是现代或古代；tags 只放除时代之外的内容标签，最多 16 个，每个标签不超过 50 个字符。',
        '请保留最有辨识度的题材、情绪、冲突、场景或受众标签，避免重复和空标签。',
        '输出协议标识：STORY_TAGS_JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `故事标题：${input.title}\n故事描述：${input.description}`,
    },
  ];
}
