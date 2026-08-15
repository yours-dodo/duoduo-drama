export const STORY_VIDEO_CONFIG = Symbol('STORY_VIDEO_CONFIG');

export interface StoryVideoConfig {
  ffmpegPath: string;
  ffprobePath: string;
  outputDir: string;
  width: number;
  height: number;
  fps: number;
}

export function parseStoryVideoConfig(
  environment: NodeJS.ProcessEnv,
): StoryVideoConfig {
  return {
    ffmpegPath: environment.STORY_FFMPEG_PATH?.trim() || 'ffmpeg',
    ffprobePath: environment.STORY_FFPROBE_PATH?.trim() || 'ffprobe',
    outputDir: environment.STORY_VIDEO_OUTPUT_DIR?.trim() || '/tmp/duoduo-videos',
    width: parsePositiveInt(environment.STORY_VIDEO_WIDTH, 1080),
    height: parsePositiveInt(environment.STORY_VIDEO_HEIGHT, 1920),
    fps: parsePositiveInt(environment.STORY_VIDEO_FPS, 30),
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

