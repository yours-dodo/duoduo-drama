import { AiRuntimeError } from '../core/errors.js';
import type { ImageContent } from '../core/content.js';
import type { NetworkPolicy, TransportDriver } from '../transport/types.js';
import { loadTransportResource } from '../transport/resource-loader.js';
import type { ImageModelDefinition, ImageSize } from './models.js';

export interface ImagePromptTextPart {
  readonly type: 'text';
  readonly text: string;
}

export interface ImagePromptImagePart {
  readonly type: 'image';
  readonly image: ImageContent;
}

export type ImagePromptPart = ImagePromptTextPart | ImagePromptImagePart;

export interface ImageGenerationInput {
  readonly content: readonly ImagePromptPart[];
  readonly count?: number;
  readonly size?: ImageSize;
  readonly seed?: number;
}

export interface ResolvedImageGenerationInput {
  readonly content: readonly ImagePromptPart[];
  readonly count: number;
  readonly size: ImageSize;
  readonly seed?: number;
}

export function imagePrompt(
  prompt: string,
  references: readonly ImageContent[] = [],
): readonly ImagePromptPart[] {
  return Object.freeze([
    Object.freeze({ type: 'text' as const, text: prompt }),
    ...references.map((image) =>
      Object.freeze({ type: 'image' as const, image }),
    ),
  ]);
}

export async function resolveImageGenerationInput(input: {
  readonly model: Readonly<ImageModelDefinition>;
  readonly value: Readonly<ImageGenerationInput>;
  readonly driver?: TransportDriver;
  readonly networkPolicy?: NetworkPolicy;
  readonly signal: AbortSignal;
}): Promise<Readonly<ResolvedImageGenerationInput>> {
  const { model, value } = input;
  if (!Array.isArray(value.content) || value.content.length === 0)
    throw invalid('IMAGE_INPUT_EMPTY', 'image content must not be empty');
  const content: ImagePromptPart[] = [];
  let promptCharacters = 0;
  let references = 0;
  for (const part of value.content) {
    if (part.type === 'text') {
      if (part.text.trim().length === 0)
        throw invalid(
          'IMAGE_TEXT_EMPTY',
          'image prompt text must not be empty',
        );
      promptCharacters += part.text.length;
      content.push(Object.freeze({ type: 'text', text: part.text }));
      continue;
    }
    if (part.type !== 'image')
      throw invalid('IMAGE_CONTENT_INVALID', 'invalid image content part');
    references += 1;
    if (model.capabilities.referenceImages === 'none')
      throw invalid(
        'IMAGE_REFERENCE_UNSUPPORTED',
        'reference images are not supported',
      );
    if (model.capabilities.referenceImages === 'single' && references > 1)
      throw invalid(
        'IMAGE_REFERENCE_LIMIT',
        'only one reference image is supported',
      );
    if (references > model.limits.maxReferenceImages)
      throw invalid('IMAGE_REFERENCE_LIMIT', 'too many reference images');
    content.push(
      Object.freeze({
        type: 'image',
        image: await materializeImage(part.image, {
          maxBytes: model.limits.maxReferenceImageBytes,
          driver: input.driver,
          networkPolicy: input.networkPolicy,
          signal: input.signal,
        }),
      }),
    );
  }
  if (promptCharacters > model.limits.maxPromptCharacters)
    throw invalid(
      'IMAGE_PROMPT_TOO_LARGE',
      'image prompt exceeds character limit',
    );
  if (!model.capabilities.textToImage && references === 0)
    throw invalid(
      'IMAGE_TEXT_TO_IMAGE_UNSUPPORTED',
      'text-to-image is not supported',
    );
  const count = value.count ?? model.inputDefaults.count;
  if (!Number.isInteger(count) || count < 1 || count > model.limits.maxOutputs)
    throw invalid(
      'IMAGE_OUTPUT_COUNT_INVALID',
      'image output count is not supported',
    );
  const size = value.size ?? model.inputDefaults.size;
  if (!model.capabilities.sizes.some((candidate) => sameSize(candidate, size)))
    throw invalid('IMAGE_SIZE_UNSUPPORTED', 'image size is not supported');
  if (value.seed !== undefined && !model.capabilities.seed)
    throw invalid('IMAGE_SEED_UNSUPPORTED', 'image seed is not supported');
  return Object.freeze({
    content: Object.freeze(content),
    count,
    size,
    ...(value.seed === undefined ? {} : { seed: value.seed }),
  });
}

async function materializeImage(
  image: ImageContent,
  input: {
    readonly maxBytes: number;
    readonly driver?: TransportDriver;
    readonly networkPolicy?: NetworkPolicy;
    readonly signal: AbortSignal;
  },
): Promise<ImageContent> {
  if (!image.mediaType.startsWith('image/'))
    throw invalid(
      'IMAGE_MEDIA_TYPE_INVALID',
      'reference media type must be an image',
    );
  if (image.source.type === 'base64') {
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        image.source.data,
      )
    )
      throw invalid(
        'IMAGE_BASE64_INVALID',
        'reference image base64 is invalid',
      );
    const bytes = Buffer.from(image.source.data, 'base64');
    if (bytes.byteLength > input.maxBytes)
      throw invalid(
        'IMAGE_REFERENCE_TOO_LARGE',
        'reference image exceeds byte limit',
      );
    return Object.freeze({
      type: 'image',
      mediaType: image.mediaType,
      source: Object.freeze({ type: 'base64', data: image.source.data }),
    });
  }
  if (!input.driver || !input.networkPolicy)
    throw new AiRuntimeError(
      'RESOURCE_TRANSPORT_REQUIRED',
      'invalid_request',
      'transport and network policy are required for URL image references',
    );
  const loaded = await loadTransportResource({
    url: new URL(image.source.url),
    driver: input.driver,
    networkPolicy: input.networkPolicy,
    signal: input.signal,
    maxBytes: input.maxBytes,
    allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  });
  return Object.freeze({
    type: 'image',
    mediaType: loaded.contentType ?? image.mediaType,
    source: Object.freeze({
      type: 'base64',
      data: Buffer.from(loaded.body).toString('base64'),
    }),
  });
}

function sameSize(left: ImageSize, right: ImageSize): boolean {
  return typeof left === 'string' && typeof right === 'string'
    ? left === right
    : typeof left === 'object' && typeof right === 'object'
      ? left.width === right.width && left.height === right.height
      : false;
}

function invalid(code: string, message: string): AiRuntimeError {
  return new AiRuntimeError(code, 'invalid_request', message);
}
