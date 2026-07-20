import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type {
  DirectImageProtocolAdapter,
  ImageProtocolContract,
  ImageProtocolEventSink,
  ImageProtocolRequest,
  ImageProtocolTerminal,
} from '../../images/contracts.js';

export interface XAiImagesCompatibility {
  readonly wireVersion: 1;
  readonly routes: readonly ['images/generations', 'images/edits'];
}
export type XAiImagesOptions = Readonly<Record<string, never>>;

declare module '../../images/contracts.js' {
  interface ImageProtocolOptionsMap {
    'xai-images': XAiImagesOptions;
  }
  interface ImageProtocolCompatibilityMap {
    'xai-images': XAiImagesCompatibility;
  }
}

export const xAiImagesContract: ImageProtocolContract<'xai-images'> =
  Object.freeze({
    parseOptions(input: unknown): XAiImagesOptions {
      if (!isRecord(input) || Object.keys(input).length !== 0)
        throw new AiRuntimeError(
          'XAI_IMAGES_OPTIONS_INVALID',
          'invalid_request',
          'xAI Images does not accept protocol extension fields',
        );
      return Object.freeze({});
    },
    mergeOptions(layers: readonly (XAiImagesOptions | undefined)[]) {
      for (const layer of layers) this.parseOptions(layer ?? {});
      return Object.freeze({});
    },
    parseCompatibility(input: unknown): XAiImagesCompatibility {
      if (
        !isRecord(input) ||
        input.wireVersion !== 1 ||
        !Array.isArray(input.routes) ||
        input.routes.length !== 2 ||
        input.routes[0] !== 'images/generations' ||
        input.routes[1] !== 'images/edits' ||
        Object.keys(input).length !== 2
      )
        throw new AiRuntimeError(
          'XAI_IMAGES_COMPATIBILITY_INVALID',
          'invalid_request',
          'invalid xAI Images compatibility profile',
        );
      return Object.freeze({
        wireVersion: 1,
        routes: Object.freeze(['images/generations', 'images/edits'] as const),
      });
    },
  });

export function createXAiImagesAdapter(): DirectImageProtocolAdapter<'xai-images'> {
  return Object.freeze({
    id: 'xai-images',
    operationMode: 'direct',
    contract: xAiImagesContract,
    async run(
      request: ImageProtocolRequest<'xai-images'>,
      sink: ImageProtocolEventSink,
    ): Promise<ImageProtocolTerminal> {
      try {
        const prompt = request.input.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n');
        const images = request.input.content
          .filter((part) => part.type === 'image')
          .map((part) =>
            part.image.source.type === 'url'
              ? part.image.source.url
              : `data:${part.image.mediaType};base64,${part.image.source.data}`,
          );
        const response = await request.transport.send({
          method: 'POST',
          headers: Object.freeze({}),
          body: JSON.stringify({
            model: request.model.upstreamModelId,
            prompt,
            ...(images.length === 0
              ? {}
              : { image: images.length === 1 ? images[0] : images }),
            n: request.input.count,
            response_format: request.options.responseFormat,
            ...(request.input.size === 'auto'
              ? {}
              : { aspect_ratio: wireAspectRatio(request.input.size) }),
          }),
          responseMode: 'bytes',
          signal: request.signal,
        });
        const value = await jsonBody(response.body);
        if (response.status < 200 || response.status >= 300)
          return {
            status: 'failed',
            error: providerError(response.status, value),
          };
        const envelope = requireRecord(value, 'xAI Images response');
        const data = Array.isArray(envelope.data) ? envelope.data : [];
        let index = 0;
        for (const item of data) {
          if (!isRecord(item)) continue;
          const source =
            typeof item.url === 'string'
              ? ({ type: 'url' as const, url: item.url } as const)
              : typeof item.b64_json === 'string'
                ? ({ type: 'base64' as const, data: item.b64_json } as const)
                : undefined;
          if (!source) continue;
          await sink.publish({
            type: 'generation_output',
            outputIndex: index++,
            output: {
              type: 'image',
              image: {
                mediaType:
                  source.type === 'url' ? mediaType(source.url) : 'image/png',
                source,
              },
            },
          });
        }
        if (index === 0) throw invalidResponse('xAI Images returned no images');
        return {
          status: 'completed',
          ...(typeof envelope.id === 'string'
            ? { responseId: envelope.id }
            : {}),
          usage: { generatedImages: index },
        };
      } catch (error) {
        if (request.signal.aborted)
          return {
            status: 'cancelled',
            error: new AiRuntimeError(
              'IMAGE_CANCELLED',
              'cancelled',
              'image generation was cancelled',
            ) as AiError & { readonly category: 'cancelled' },
          };
        return {
          status: 'failed',
          error:
            error instanceof AiRuntimeError
              ? error
              : new AiRuntimeError(
                  'XAI_IMAGES_FAILED',
                  'protocol',
                  error instanceof Error ? error.message : 'xAI Images failed',
                ),
        };
      }
    },
  });
}

function wireAspectRatio(
  size: string | { readonly width: number; readonly height: number },
): string {
  if (typeof size === 'string') {
    const match = /^(\d+)x(\d+)$/u.exec(size);
    if (!match) return size;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const divisor = greatestCommonDivisor(width, height);
    return `${width / divisor}:${height / divisor}`;
  }
  const divisor = greatestCommonDivisor(size.width, size.height);
  return `${size.width / divisor}:${size.height / divisor}`;
}
function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}
async function jsonBody(body: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw invalidResponse('xAI Images response is not valid JSON');
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResponse(`${name} is invalid`);
  return value;
}
function providerError(status: number, value: unknown): AiError {
  const record = isRecord(value) ? value : {};
  const nested = isRecord(record.error) ? record.error : record;
  return new AiRuntimeError(
    typeof nested.code === 'string' ? nested.code : 'XAI_IMAGES_ERROR',
    status === 429
      ? 'rate_limit'
      : status >= 500
        ? 'provider'
        : 'invalid_request',
    typeof nested.message === 'string'
      ? nested.message
      : `xAI Images request failed with HTTP ${status}`,
    status === 429 || status >= 500,
  );
}
function invalidResponse(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'XAI_IMAGES_RESPONSE_INVALID',
    'invalid_response',
    message,
  );
}
function mediaType(url: string): string {
  try {
    return new URL(url).pathname.endsWith('.webp')
      ? 'image/webp'
      : new URL(url).pathname.endsWith('.jpg') ||
          new URL(url).pathname.endsWith('.jpeg')
        ? 'image/jpeg'
        : 'image/png';
  } catch {
    return 'image/png';
  }
}
