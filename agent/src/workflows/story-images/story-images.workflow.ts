import type { LinearScript } from '../../contracts/story-script.js';
import type { StoryImageGenerator } from '../../ai/story-image-generator.js';

export type StoryImageFailureCode = 'agent_unavailable' | 'protocol_error';

export class StoryImageWorkflowError extends Error {
  constructor(
    readonly failureCode: StoryImageFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'StoryImageWorkflowError';
  }
}

export interface StorySceneImage {
  sceneId: string;
  sceneKey?: string;
  prompt: string;
  imageUrl: string;
}

export class StoryImagesWorkflow {
  constructor(private readonly generator: StoryImageGenerator) {}

  async generate(input: {
    script: LinearScript;
    /** sceneKey → previous scene image URL (cross-scene visual continuity). */
    previousImages?: Readonly<Record<string, string>>;
  }): Promise<StorySceneImage[]> {
    const previousImages = input.previousImages ?? {};
    const images: StorySceneImage[] = [];

    for (const episode of input.script.episodes) {
      for (const scene of episode.scenes) {
        const prompt = buildSceneImagePrompt(input.script, scene);
        const references = scene.sceneKey
          ? previousImages[scene.sceneKey]
            ? [previousImages[scene.sceneKey]!]
            : []
          : [];
        let result;
        try {
          result = await this.generator.generate({
            prompt,
            references,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new StoryImageWorkflowError(
            'agent_unavailable',
            `scene ${scene.id} image generation failed: ${message}`,
          );
        }
        images.push({
          sceneId: scene.id,
          sceneKey: scene.sceneKey,
          prompt,
          imageUrl: result.imageUrl,
        });
      }
    }

    return images;
  }
}

export function buildSceneImagePrompt(
  script: LinearScript,
  scene: LinearScript['episodes'][number]['scenes'][number],
): string {
  const parts: string[] = [];
  if (script.styleGuide?.trim()) {
    parts.push(`画风：${script.styleGuide.trim()}`);
  }
  parts.push(`场景：${scene.title}（${scene.location}，${scene.timeOfDay}，${scene.mood}）`);
  const speakers = new Set(
    scene.shots
      .map((shot) => shot.speaker)
      .filter((name): name is string => Boolean(name)),
  );
  const onStage = script.characters.filter((character) =>
    speakers.has(character.name),
  );
  if (onStage.length > 0) {
    parts.push(
      `在场人物：${onStage
        .map(
          (character) =>
            `${character.name}（${character.visualDescription ?? character.personality}）`,
        )
        .join('；')}`,
    );
  }
  parts.push(
    `镜头：${scene.shots.map((shot) => shot.visualPrompt).join('；')}`,
  );
  parts.push('构图：竖屏 9:16 短视频单帧，电影感，主体清晰，无文字水印。');
  return parts.join('\n');
}

