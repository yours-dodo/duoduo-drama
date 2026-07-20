import type { ImageContent } from '../core/content.js';
import { AiRuntimeError } from '../core/errors.js';
import type { NetworkPolicy, TransportDriver } from '../transport/types.js';
import type {
  VideoModelDefinition,
  VideoOperationKind,
  VideoResolution,
} from './models.js';

export interface VideoResourceInput {
  readonly mediaType: string;
  readonly source:
    | Readonly<{ type: 'url'; url: string }>
    | Readonly<{ type: 'base64'; data: string }>;
  readonly durationSeconds?: number;
}

export type VideoPromptPart =
  | Readonly<{ type: 'text'; text: string }>
  | Readonly<{
      type: 'image';
      role: 'reference' | 'first_frame' | 'last_frame';
      image: ImageContent;
    }>
  | Readonly<{
      type: 'video';
      role: 'source' | 'reference';
      video: VideoResourceInput;
    }>
  | Readonly<{
      type: 'audio';
      role: 'source' | 'reference';
      audio: VideoResourceInput;
    }>;

export interface VideoGenerationInput {
  readonly operation: VideoOperationKind;
  readonly content: readonly VideoPromptPart[];
  readonly durationSeconds?: number;
  readonly resolution?: VideoResolution;
  readonly aspectRatio?: string;
  readonly fps?: number;
  readonly seed?: number;
  readonly generateAudio?: boolean;
  readonly count?: number;
}

export interface ResolvedVideoGenerationInput {
  readonly operation: VideoOperationKind;
  readonly content: readonly VideoPromptPart[];
  readonly durationSeconds?: number;
  readonly resolution?: VideoResolution;
  readonly aspectRatio?: string;
  readonly fps?: number;
  readonly seed?: number;
  readonly generateAudio: boolean;
  readonly count: number;
}

export function videoPrompt(prompt: string): readonly VideoPromptPart[] {
  return Object.freeze([
    Object.freeze({ type: 'text' as const, text: prompt }),
  ]);
}

export async function resolveVideoGenerationInput(input: {
  readonly model: Readonly<VideoModelDefinition>;
  readonly value: Readonly<VideoGenerationInput>;
  readonly signal: AbortSignal;
  readonly driver?: TransportDriver;
  readonly networkPolicy?: NetworkPolicy;
}): Promise<Readonly<ResolvedVideoGenerationInput>> {
  const { model, value } = input;
  if (!model.capabilities.operations.includes(value.operation))
    throw invalid(
      'VIDEO_OPERATION_UNSUPPORTED',
      'video operation is not supported',
    );
  if (!Array.isArray(value.content) || value.content.length === 0)
    throw invalid('VIDEO_INPUT_EMPTY', 'video content must not be empty');
  let promptCharacters = 0;
  let images = 0;
  let videos = 0;
  let audios = 0;
  const content: VideoPromptPart[] = [];
  for (const part of value.content) {
    if (part.type === 'text') {
      if (!model.capabilities.inputModalities.includes('text'))
        throw invalid('VIDEO_TEXT_UNSUPPORTED', 'text input is not supported');
      if (!part.text.trim())
        throw invalid('VIDEO_TEXT_EMPTY', 'video prompt must not be empty');
      promptCharacters += part.text.length;
      content.push(Object.freeze({ ...part }));
      continue;
    }
    if (part.type === 'image') {
      if (
        !model.capabilities.inputModalities.includes('image') ||
        !model.capabilities.imageRoles.includes(part.role)
      )
        throw invalid(
          'VIDEO_IMAGE_ROLE_UNSUPPORTED',
          'image input role is not supported',
        );
      validateResource(
        part.image,
        model.limits.maxReferenceImageBytes,
        'image',
      );
      images += 1;
      if (images > model.limits.maxReferenceImages)
        throw invalid('VIDEO_IMAGE_LIMIT', 'too many reference images');
      content.push(
        Object.freeze({ ...part, image: freezeResource(part.image) }),
      );
      continue;
    }
    if (part.type === 'video') {
      if (
        !model.capabilities.inputModalities.includes('video') ||
        !model.capabilities.videoRoles.includes(part.role)
      )
        throw invalid(
          'VIDEO_SOURCE_ROLE_UNSUPPORTED',
          'video input role is not supported',
        );
      validateResource(part.video, model.limits.maxInputVideoBytes, 'video');
      if (
        part.video.durationSeconds !== undefined &&
        part.video.durationSeconds > model.limits.maxInputVideoSeconds
      )
        throw invalid(
          'VIDEO_SOURCE_DURATION_LIMIT',
          'input video duration exceeds model limit',
        );
      videos += 1;
      if (videos > model.limits.maxInputVideos)
        throw invalid('VIDEO_SOURCE_LIMIT', 'too many input videos');
      content.push(
        Object.freeze({ ...part, video: freezeResource(part.video) }),
      );
      continue;
    }
    if (part.type === 'audio') {
      if (
        !model.capabilities.inputModalities.includes('audio') ||
        !model.capabilities.audioInput
      )
        throw invalid(
          'VIDEO_AUDIO_UNSUPPORTED',
          'audio input is not supported',
        );
      validateResource(part.audio, model.limits.maxInputAudioBytes, 'audio');
      audios += 1;
      if (audios > 1)
        throw invalid('VIDEO_AUDIO_LIMIT', 'too many audio inputs');
      content.push(
        Object.freeze({ ...part, audio: freezeResource(part.audio) }),
      );
      continue;
    }
    throw invalid('VIDEO_CONTENT_INVALID', 'invalid video content part');
  }
  if (promptCharacters > model.limits.maxPromptCharacters)
    throw invalid(
      'VIDEO_PROMPT_TOO_LARGE',
      'video prompt exceeds character limit',
    );
  const sourceVideos = content.filter(
    (part) => part.type === 'video' && part.role === 'source',
  ).length;
  if (value.operation === 'generate' && sourceVideos > 0)
    throw invalid(
      'VIDEO_SOURCE_UNEXPECTED',
      'generate does not accept a source video',
    );
  if (
    (value.operation === 'edit' || value.operation === 'extend') &&
    sourceVideos !== 1
  )
    throw invalid(
      'VIDEO_SOURCE_REQUIRED',
      `${value.operation} requires exactly one source video`,
    );
  const count = value.count ?? model.inputDefaults.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > model.limits.maxOutputs)
    throw invalid(
      'VIDEO_OUTPUT_COUNT_INVALID',
      'video output count is not supported',
    );
  const durationSeconds =
    value.durationSeconds ?? model.inputDefaults.durationSeconds;
  if (
    durationSeconds !== undefined &&
    !supportsDuration(model, durationSeconds)
  )
    throw invalid(
      'VIDEO_DURATION_UNSUPPORTED',
      'video duration is not supported',
    );
  const resolution = value.resolution ?? model.inputDefaults.resolution;
  if (
    resolution !== undefined &&
    !model.capabilities.resolutions.some((candidate) =>
      sameResolution(candidate, resolution),
    )
  )
    throw invalid(
      'VIDEO_RESOLUTION_UNSUPPORTED',
      'video resolution is not supported',
    );
  const aspectRatio = value.aspectRatio ?? model.inputDefaults.aspectRatio;
  if (
    aspectRatio !== undefined &&
    !model.capabilities.aspectRatios.includes(aspectRatio)
  )
    throw invalid(
      'VIDEO_ASPECT_RATIO_UNSUPPORTED',
      'video aspect ratio is not supported',
    );
  const fps = value.fps ?? model.inputDefaults.fps;
  if (fps !== undefined && !model.capabilities.frameRates.includes(fps))
    throw invalid('VIDEO_FPS_UNSUPPORTED', 'video frame rate is not supported');
  if (value.seed !== undefined && !model.capabilities.seed)
    throw invalid('VIDEO_SEED_UNSUPPORTED', 'video seed is not supported');
  const generateAudio =
    value.generateAudio ?? model.inputDefaults.generateAudio ?? false;
  if (generateAudio && !model.capabilities.audioOutput)
    throw invalid(
      'VIDEO_AUDIO_OUTPUT_UNSUPPORTED',
      'audio output is not supported',
    );
  return Object.freeze({
    operation: value.operation,
    content: Object.freeze(content),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(aspectRatio === undefined ? {} : { aspectRatio }),
    ...(fps === undefined ? {} : { fps }),
    ...(value.seed === undefined ? {} : { seed: value.seed }),
    generateAudio,
    count,
  });
}

function supportsDuration(
  model: Readonly<VideoModelDefinition>,
  value: number,
): boolean {
  const allowed = model.capabilities.durationsSeconds;
  if (Array.isArray(allowed)) return allowed.includes(value);
  const range = allowed as { min: number; max: number; step?: number };
  return (
    value >= range.min &&
    value <= range.max &&
    (range.step === undefined || (value - range.min) % range.step === 0)
  );
}
function sameResolution(
  left: VideoResolution,
  right: VideoResolution,
): boolean {
  return typeof left === 'string' && typeof right === 'string'
    ? left === right
    : typeof left === 'object' &&
        typeof right === 'object' &&
        left.width === right.width &&
        left.height === right.height;
}
function validateResource(
  resource: VideoResourceInput | ImageContent,
  maxBytes: number,
  kind: string,
): void {
  if (!resource.mediaType.startsWith(`${kind}/`))
    throw invalid(
      'VIDEO_MEDIA_TYPE_INVALID',
      `${kind} input has an invalid media type`,
    );
  if (resource.source.type === 'url') {
    const url = new URL(resource.source.url);
    if (url.protocol !== 'https:')
      throw invalid(
        'VIDEO_RESOURCE_URL_INVALID',
        'resource URL must use https',
      );
    return;
  }
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      resource.source.data,
    )
  )
    throw invalid('VIDEO_BASE64_INVALID', 'resource base64 is invalid');
  if (Buffer.from(resource.source.data, 'base64').byteLength > maxBytes)
    throw invalid('VIDEO_RESOURCE_TOO_LARGE', 'resource exceeds byte limit');
}
function freezeResource<T extends VideoResourceInput | ImageContent>(
  resource: T,
): T {
  return Object.freeze({
    ...resource,
    source: Object.freeze({ ...resource.source }),
  }) as unknown as T;
}
function invalid(code: string, message: string): AiRuntimeError {
  return new AiRuntimeError(code, 'invalid_request', message);
}
