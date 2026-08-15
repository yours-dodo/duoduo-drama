import type { LinearScript } from '../../contracts/story-script.js';

export interface SceneImage {
  sceneId: string;
  imageUrl: string;
}

export interface ShotAudio {
  shotId: string;
  audioBase64: string;
  mimeType: string;
}

export interface RenderSegment {
  index: number;
  shotId: string;
  sceneId: string;
  episodeOrder: number;
  sceneOrder: number;
  shotOrder: number;
  imageUrl: string;
  audioBase64?: string;
  audioMimeType?: string;
  subtitle?: string;
  durationSeconds: number;
}

export function buildRenderList(input: {
  script: LinearScript;
  images: readonly SceneImage[];
  audio: readonly ShotAudio[];
}): RenderSegment[] {
  const imageByScene = new Map(
    input.images.map((image) => [image.sceneId, image.imageUrl]),
  );
  const audioByShot = new Map(
    input.audio.map((audio) => [audio.shotId, audio]),
  );
  const segments: RenderSegment[] = [];
  let index = 0;

  for (const episode of input.script.episodes) {
    for (const scene of episode.scenes) {
      const imageUrl = imageByScene.get(scene.id);
      if (!imageUrl) {
        throw new Error(`scene ${scene.id} has no generated image`);
      }
      for (const shot of scene.shots) {
        const audio = audioByShot.get(shot.id);
        const subtitle =
          shot.type === 'dialogue'
            ? `${shot.speaker}：${shot.line}`
            : shot.narration;
        segments.push({
          index,
          shotId: shot.id,
          sceneId: scene.id,
          episodeOrder: episode.order,
          sceneOrder: scene.order,
          shotOrder: shot.order,
          imageUrl,
          audioBase64: audio?.audioBase64,
          audioMimeType: audio?.mimeType,
          subtitle,
          durationSeconds: resolveShotDurationSeconds(shot, audio),
        });
        index += 1;
      }
    }
  }
  return segments;
}

export function resolveShotDurationSeconds(
  shot: LinearScript['episodes'][number]['scenes'][number]['shots'][number],
  audio?: ShotAudio,
): number {
  if (audio && audio.mimeType === 'audio/wav') {
    const wavDuration = parseWavDurationSeconds(audio.audioBase64);
    if (wavDuration !== undefined) return wavDuration;
  }
  const text =
    shot.type === 'dialogue' ? (shot.line ?? '') : (shot.narration ?? '');
  const estimate = Math.ceil(text.length / 4);
  return Math.max(shot.durationSeconds, estimate);
}

/** Parse the duration of a base64 WAV without touching the filesystem. */
export function parseWavDurationSeconds(base64Audio: string): number | undefined {
  try {
    const bytes = Buffer.from(base64Audio, 'base64');
    if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF') {
      return undefined;
    }
    const byteRate = bytes.readUInt32LE(28);
    const dataSize = bytes.readUInt32LE(40);
    if (byteRate <= 0) return undefined;
    return Math.round((dataSize / byteRate) * 100) / 100;
  } catch {
    return undefined;
  }
}

export function buildSrt(segments: readonly RenderSegment[]): string {
  const lines: string[] = [];
  let cursor = 0;
  segments.forEach((segment, index) => {
    if (!segment.subtitle) return;
    const start = cursor;
    const end = start + segment.durationSeconds;
    lines.push(String(index + 1));
    lines.push(`${formatSrtTime(start)} --> ${formatSrtTime(end)}`);
    lines.push(segment.subtitle);
    lines.push('');
    cursor = end;
  });
  return lines.join('\n');
}

function formatSrtTime(seconds: number): string {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const millis = Math.round((seconds - whole) * 1000);
  return [hours, minutes, secs]
    .map((value) => String(value).padStart(2, '0'))
    .join(':') + `,${String(millis).padStart(3, '0')}`;
}
