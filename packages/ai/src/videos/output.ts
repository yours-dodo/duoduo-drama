import type { AiDiagnostic } from '../core/events.js';
import type { AiError } from '../core/errors.js';
import type { JsonValue } from '../core/content.js';
import type { GenerationArtifact } from '../generation/index.js';
import type { VideoModelDefinition } from './models.js';
import type { VideoCost, VideoUsage } from './cost.js';
import type { VideoOperationRef } from './operation-claims.js';

export interface GeneratedVideo {
  readonly artifact: GenerationArtifact;
  readonly durationSeconds?: number;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly hasAudio?: boolean;
  readonly poster?: Readonly<{
    mediaType: string;
    source:
      | Readonly<{ type: 'url'; url: string; expiresAt?: number }>
      | Readonly<{ type: 'base64'; data: string }>;
  }>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export type VideoGenerationOutput = Readonly<{
  type: 'video';
  video: GeneratedVideo;
}>;

interface VideoGenerationResultBase {
  readonly requestId: string;
  readonly model: Readonly<VideoModelDefinition>;
  readonly outputs: readonly VideoGenerationOutput[];
  readonly operation?: VideoOperationRef;
  readonly responseId?: string;
  readonly usage?: VideoUsage;
  readonly cost?: VideoCost;
  readonly diagnostics?: readonly AiDiagnostic[];
  readonly startedAt: number;
  readonly completedAt: number;
}

export type VideoGenerationResult =
  | (VideoGenerationResultBase & {
      readonly status: 'completed';
      readonly partial: false;
      readonly error?: never;
    })
  | (VideoGenerationResultBase & {
      readonly status: 'failed';
      readonly partial: boolean;
      readonly error: AiError;
    })
  | (VideoGenerationResultBase & {
      readonly status: 'cancelled';
      readonly partial: boolean;
      readonly error: AiError & { readonly category: 'cancelled' };
    })
  | (VideoGenerationResultBase & {
      readonly status: 'detached';
      readonly partial: boolean;
      readonly operation: VideoOperationRef;
      readonly error?: never;
    });
