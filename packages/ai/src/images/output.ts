import type { AiDiagnostic } from '../core/events.js';
import type { AiError } from '../core/errors.js';
import type { JsonValue } from '../core/content.js';
import type { ImageModelDefinition } from './models.js';
import type { ImageCost, ImageUsage } from './cost.js';
import type { ImageOperationRef } from './operation-claims.js';

export interface GeneratedImage {
  readonly mediaType: string;
  readonly source:
    | Readonly<{ type: 'url'; url: string; expiresAt?: number }>
    | Readonly<{ type: 'base64'; data: string }>;
  readonly revisedPrompt?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export type ImageGenerationOutput =
  | Readonly<{ type: 'text'; text: string }>
  | Readonly<{ type: 'image'; image: GeneratedImage }>;

interface ImageGenerationResultBase {
  readonly requestId: string;
  readonly model: Readonly<ImageModelDefinition>;
  readonly outputs: readonly ImageGenerationOutput[];
  readonly operation?: ImageOperationRef;
  readonly responseId?: string;
  readonly usage?: ImageUsage;
  readonly cost?: ImageCost;
  readonly diagnostics?: readonly AiDiagnostic[];
  readonly startedAt: number;
  readonly completedAt: number;
}

export type ImageGenerationResult =
  | (ImageGenerationResultBase & {
      readonly status: 'completed';
      readonly partial: false;
      readonly error?: never;
    })
  | (ImageGenerationResultBase & {
      readonly status: 'failed';
      readonly partial: boolean;
      readonly error: AiError;
    })
  | (ImageGenerationResultBase & {
      readonly status: 'cancelled';
      readonly partial: boolean;
      readonly error: AiError & { readonly category: 'cancelled' };
    })
  | (ImageGenerationResultBase & {
      readonly status: 'detached';
      readonly partial: boolean;
      readonly operation: ImageOperationRef;
      readonly error?: never;
    });
