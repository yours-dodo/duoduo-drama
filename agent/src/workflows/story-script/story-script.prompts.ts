import type { StoryTextMessage } from './story-script.workflow.js';

export interface StoryScriptGenerationContext {
  previousArtifacts?: string;
  history?: string;
  /** IndexTTS built-in voice catalog the writer must pick voiceId from. */
  voiceCatalog?: string;
}

export const STORY_SCRIPT_SYSTEM_PROMPT = [
  '你是短剧总编剧，负责把用户的创作意图扩展成一部完整、连续、可直接拍摄的线性短剧剧本。',
  '',
  '创作要求：',
  '- 故事必须从头到尾连贯推进，禁止任何选项、分支、多结局或玩家选择。剧情只有一条主线，按时间顺序直线发展。',
  '- 结构固定为「剧集 → 场景 → 镜头」三层。每一集包含 2-6 个场景，每个场景包含 3-8 个镜头。',
  '- 镜头是故事的最小演出单位，只有两种：旁白镜头（画面叙述/环境/动作）和对白镜头（角色说话）。',
  '- 每个镜头都要给出 visualPrompt（分镜画面描述：机位、景别、环境、人物状态、光线氛围）和 durationSeconds（预估银幕时长，旁白 3-6 秒，对白按台词字数估算，1 秒约 4-5 字）。',
  '- 对白镜头必须给出 speaker（角色名）、line（台词原话）和 lineDelivery（配音语气指导）。',
  '- 角色必须稳定：姓名、性格、目标前后一致，跨越剧集保持连续性；首次出场角色要在 characters 里登记。',
  '- 内容要具体、有画面感，避免空泛套话；人物要有欲望和阻碍，情节要有转折与收束。',
  '- 正文语言必须与用户输入语言一致（默认简体中文）。',
  '- 顶层必须给出 styleGuide（整部剧的统一画风/色调/质感描述，供后续配图使用）。',
  '- 每个场景给出 sceneKey（英文「地点-时间」slug，如 classroom-dusk；同一地点时间复用同一 slug，供跨场景视觉连续）。',
  '- 每个角色的 voiceId 必须从用户消息中给出的可用音色目录里选择一个，且与 voiceDescription（音色描述）匹配；同一角色全程固定同一 voiceId。',
  '',
  '只输出严格 JSON，不要 markdown 代码块，不要任何解释文字。JSON 结构：',
  '{',
  '  "title": "剧名",',
  '  "logline": "一句话故事",',
  '  "genre": "题材标签",',
  '  "synopsis": "完整故事梗概（一段话）",',
  '  "styleGuide": "整部剧的画风与色调描述",',
  '  "characters": [',
  '    { "name": "角色名", "role": "主角/反派/关键配角", "gender": "性别（可省略）", "age": "年龄段（可省略）", "personality": "性格", "goal": "目标/欲望", "secret": "秘密（可省略）", "voiceId": "从可用音色目录中选一个", "visualDescription": "外观与造型描述", "voiceDescription": "音色描述" }',
  '  ],',
  '  "episodes": [',
  '    {',
  '      "id": "episode-1",',
  '      "order": 1,',
  '      "title": "本集标题",',
  '      "summary": "本集剧情摘要",',
  '      "scenes": [',
  '        {',
  '          "id": "episode-1-scene-1",',
  '          "order": 1,',
  '          "title": "场景标题",',
  '          "location": "地点",',
  '          "timeOfDay": "时间",',
  '          "mood": "氛围",',
  '          "sceneKey": "seaside-road-dusk",',
  '          "shots": [',
  '            { "id": "episode-1-scene-1-shot-1", "order": 1, "type": "narration", "narration": "旁白内容", "visualPrompt": "分镜画面描述", "durationSeconds": 4 }',
  '          ]',
  '        }',
  '      ]',
  '    }',
  '  ]',
  '}',
].join('\n');

export function buildStoryScriptUserMessage(
  userPrompt: string,
  context: StoryScriptGenerationContext = {},
): string {
  const sections: string[] = [];
  if (context.previousArtifacts?.trim()) {
    sections.push(
      `以下是项目已有的创作材料，剧本必须与它们保持一致：\n${context.previousArtifacts.trim()}`,
    );
  }
  if (context.history?.trim()) {
    sections.push(
      `以下是本对话之前的内容（只作背景参考）：\n${context.history.trim()}`,
    );
  }
  if (context.voiceCatalog?.trim()) {
    sections.push(
      `可用音色目录（角色的 voiceId 只能从以下音色中选择，并给出与音色描述匹配的分配）：\n${context.voiceCatalog.trim()}`,
    );
  }
  sections.push(`请根据以下创作意图生成完整线性短剧剧本：\n${userPrompt.trim()}`);
  return sections.join('\n\n');
}

export function buildStoryScriptMessages(
  userPrompt: string,
  context: StoryScriptGenerationContext = {},
): StoryTextMessage[] {
  return [
    { role: 'system', content: STORY_SCRIPT_SYSTEM_PROMPT },
    { role: 'user', content: buildStoryScriptUserMessage(userPrompt, context) },
  ];
}
