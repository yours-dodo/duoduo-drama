import type { JsonValue } from '../core/content.js';

export type GenerationArtifactSource =
  | Readonly<{ type: 'url'; url: string; expiresAt?: number }>
  | Readonly<{ type: 'base64'; data: string }>;

export interface GenerationArtifact {
  readonly mediaType: string;
  readonly source: GenerationArtifactSource;
  readonly sizeBytes?: number;
  readonly sha256?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface GenerationComputeUsage {
  readonly acceleratorType?: string;
  readonly acceleratorCount?: number;
  readonly activeMilliseconds?: number;
  readonly billedMilliseconds?: number;
  readonly queueMilliseconds?: number;
  readonly modelLoadMilliseconds?: number;
}
