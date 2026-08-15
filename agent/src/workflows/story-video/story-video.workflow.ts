import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { silenceWavBase64 } from '../../ai/story-speech-generator.js';
import type { LinearScript } from '../../contracts/story-script.js';
import type { StoryVideoConfig } from '../../config/story-video-config.js';
import {
  concatSegments,
  materializeImageSource,
  materializeDataUri,
  probeDurationSeconds,
  renderSubtitleOverlay,
  renderSegment,
  type FfmpegRendererConfig,
} from './ffmpeg-renderer.js';
import {
  buildRenderList,
  buildSrt,
  type SceneImage,
  type ShotAudio,
} from './render-list.js';

export type StoryVideoFailureCode = 'agent_unavailable' | 'protocol_error';

export class StoryVideoWorkflowError extends Error {
  constructor(
    readonly failureCode: StoryVideoFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'StoryVideoWorkflowError';
  }
}

export interface StoryVideoResult {
  outputPath: string;
  subtitlePath: string;
  durationSeconds: number;
  sizeBytes: number;
  segmentCount: number;
}

export class StoryVideoWorkflow {
  private readonly renderer: FfmpegRendererConfig;

  constructor(private readonly config: StoryVideoConfig) {
    this.renderer = {
      ffmpegPath: config.ffmpegPath,
      ffprobePath: config.ffprobePath,
      width: config.width,
      height: config.height,
      fps: config.fps,
    };
  }

  async render(input: {
    script: LinearScript;
    images: readonly SceneImage[];
    audio: readonly ShotAudio[];
    outputDir?: string;
  }): Promise<StoryVideoResult> {
    const segments = buildRenderList({
      script: input.script,
      images: input.images,
      audio: input.audio,
    });
    if (segments.length === 0) {
      throw new StoryVideoWorkflowError(
        'protocol_error',
        'script has no renderable shots',
      );
    }

    const workDir = await mkdtemp(
      join(input.outputDir ?? this.config.outputDir, 'story-video-'),
    );
    try {
      const imageFiles = new Map<string, string>();
      for (const image of input.images) {
        if (imageFiles.has(image.sceneId)) continue;
        const materialized = await materializeImageSource(
          image.imageUrl,
          workDir,
          `image-${image.sceneId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        );
        imageFiles.set(image.sceneId, materialized.path);
      }

      const audioFiles = new Map<string, string>();
      for (const shot of input.audio) {
        if (audioFiles.has(shot.shotId)) continue;
        const materialized = await materializeDataUri(
          `data:${shot.mimeType};base64,${shot.audioBase64}`,
          workDir,
          `audio-${shot.shotId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        );
        audioFiles.set(shot.shotId, materialized.path);
        if (shot.mimeType !== 'audio/wav') {
          const duration = await probeDurationSeconds(
            this.renderer.ffprobePath,
            materialized.path,
          );
          if (duration !== undefined) {
            const segment = segments.find(
              (candidate) => candidate.shotId === shot.shotId,
            );
            if (segment) segment.durationSeconds = Math.round(duration * 100) / 100;
          }
        }
      }

      const segmentVideos: string[] = [];
      const segmentAudios: string[] = [];
      const subtitleOverlays = new Map<string, string>();
      const zoomStep = 0.0006;
      const zoomMax = 1.1;
      let currentSceneId: string | null = null;
      let sceneZoomStart = 1;
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]!;
        if (segment.sceneId !== currentSceneId) {
          currentSceneId = segment.sceneId;
          sceneZoomStart = 1;
        }
        const frames = Math.max(
          1,
          Math.round(segment.durationSeconds * this.config.fps),
        );
        const outputBase = join(workDir, `segment-${String(index).padStart(3, '0')}`);
        let subtitleOverlay: string | undefined;
        if (segment.subtitle) {
          subtitleOverlay = subtitleOverlays.get(segment.subtitle);
          if (!subtitleOverlay) {
            subtitleOverlay = await renderSubtitleOverlay(
              segment.subtitle,
              workDir,
              `subtitle-${String(index).padStart(3, '0')}`,
              { width: this.config.width, height: this.config.height },
            );
            subtitleOverlays.set(segment.subtitle, subtitleOverlay);
          }
        }
        // Every segment gets an audio source (real dialogue or same-length
        // silence), encoded later as lossless PCM so concat is pop-free.
        let audioFile: string | undefined;
        if (segment.audioBase64) {
          audioFile = audioFiles.get(segment.shotId);
          if (!audioFile) {
            const materialized = await materializeDataUri(
              `data:${segment.audioMimeType ?? 'audio/wav'};base64,${segment.audioBase64}`,
              workDir,
              `audio-${segment.shotId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
            );
            audioFiles.set(segment.shotId, materialized.path);
            audioFile = materialized.path;
          }
        } else {
          const silenceKey = `silence-${segment.shotId}`;
          audioFile = audioFiles.get(silenceKey);
          if (!audioFile) {
            const materialized = await materializeDataUri(
              `data:audio/wav;base64,${silenceWavBase64(segment.durationSeconds)}`,
              workDir,
              `audio-${segment.shotId.replace(/[^a-zA-Z0-9_-]/g, '-')}-silence`,
            );
            audioFiles.set(silenceKey, materialized.path);
            audioFile = materialized.path;
          }
        }
        try {
          const rendered = await renderSegment(this.renderer, {
            imageFile: imageFiles.get(segment.sceneId)!,
            audioFile,
            subtitleOverlay,
            durationSeconds: segment.durationSeconds,
            zoomStart: sceneZoomStart,
            zoomMax,
            outputBase,
          });
          segmentVideos.push(rendered.videoFile);
          segmentAudios.push(rendered.audioFile);
          sceneZoomStart = Math.min(sceneZoomStart + zoomStep * frames, zoomMax);
        } catch (error) {
          throw new StoryVideoWorkflowError(
            'agent_unavailable',
            `segment ${segment.shotId} render failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      const safeTitle = input.script.title.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40);
      const outputPath = join(
        input.outputDir ?? this.config.outputDir,
        `${safeTitle || 'story'}-${Date.now()}.mp4`,
      );
      const subtitlePath = outputPath.replace(/\.mp4$/, '.srt');
      try {
        await concatSegments(this.renderer, {
          videoFiles: segmentVideos,
          audioFiles: segmentAudios,
          outputFile: outputPath,
        });
      } catch (error) {
        throw new StoryVideoWorkflowError(
          'agent_unavailable',
          `concat failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await writeFile(subtitlePath, buildSrt(segments), 'utf8');

      const sizeBytes = (await stat(outputPath)).size;
      const durationSeconds =
        Math.round(
          segments.reduce((total, segment) => total + segment.durationSeconds, 0) * 100,
        ) / 100;
      return {
        outputPath,
        subtitlePath,
        durationSeconds,
        sizeBytes,
        segmentCount: segments.length,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
