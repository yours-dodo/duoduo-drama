import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type {
  DirectImageProtocolAdapter,
  ImageProtocolContract,
  ImageProtocolEventSink,
  ImageProtocolRequest,
  ImageProtocolTerminal,
} from '../../images/contracts.js';

export interface ArkImagesCompatibility {
  readonly wireVersion: 1;
  readonly route: 'images/generations';
}
export type ArkImagesOptions = Readonly<Record<string, never>>;

declare module '../../images/contracts.js' {
  interface ImageProtocolOptionsMap {
    'ark-images': ArkImagesOptions;
  }
  interface ImageProtocolCompatibilityMap {
    'ark-images': ArkImagesCompatibility;
  }
}

export const arkImagesContract: ImageProtocolContract<'ark-images'> =
  Object.freeze({
    parseOptions(input: unknown): ArkImagesOptions {
      if (!isRecord(input) || Object.keys(input).length !== 0)
        throw new AiRuntimeError(
          'ARK_IMAGES_OPTIONS_INVALID',
          'invalid_request',
          'Ark Images does not accept protocol extension fields',
        );
      return Object.freeze({});
    },
    mergeOptions(layers: readonly (ArkImagesOptions | undefined)[]) {
      for (const layer of layers) this.parseOptions(layer ?? {});
      return Object.freeze({});
    },
    parseCompatibility(input: unknown): ArkImagesCompatibility {
      if (
        !isRecord(input) ||
        input.wireVersion !== 1 ||
        input.route !== 'images/generations' ||
        Object.keys(input).length !== 2
      )
        throw new AiRuntimeError(
          'ARK_IMAGES_COMPATIBILITY_INVALID',
          'invalid_request',
          'invalid Ark Images compatibility profile',
        );
      return Object.freeze({
        wireVersion: 1,
        route: 'images/generations',
      });
    },
  });

export function createArkImagesAdapter(): DirectImageProtocolAdapter<'ark-images'> {
  return Object.freeze({
    id: 'ark-images',
    operationMode: 'direct',
    contract: arkImagesContract,
    async run(
      request: ImageProtocolRequest<'ark-images'>,
      sink: ImageProtocolEventSink,
    ): Promise<ImageProtocolTerminal> {
      try {
        const text = request.input.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n');
        const references = request.input.content
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
            prompt: text,
            ...(references.length === 0
              ? {}
              : {
                  image: references.length === 1 ? references[0] : references,
                }),
            n: request.input.count,
            size: wireSize(request.input.size),
            response_format:
              request.options.responseFormat === 'base64' ? 'b64_json' : 'url',
            ...(request.input.seed === undefined
              ? {}
              : { seed: request.input.seed }),
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
        const envelope = requireRecord(value, 'Ark Images response');
        const data = Array.isArray(envelope.data) ? envelope.data : [];
        let outputIndex = 0;
        for (const item of data) {
          if (!isRecord(item)) continue;
          if (typeof item.url === 'string') {
            await sink.publish({
              type: 'generation_output',
              outputIndex: outputIndex++,
              output: {
                type: 'image',
                image: {
                  mediaType: mediaType(item.url),
                  source: { type: 'url', url: item.url },
                },
              },
            });
          } else if (typeof item.b64_json === 'string') {
            await sink.publish({
              type: 'generation_output',
              outputIndex: outputIndex++,
              output: {
                type: 'image',
                image: {
                  mediaType:
                    typeof item.media_type === 'string'
                      ? item.media_type
                      : 'image/png',
                  source: { type: 'base64', data: item.b64_json },
                },
              },
            });
          }
        }
        if (outputIndex === 0)
          throw invalidResponse('Ark Images returned no image outputs');
        const usage = isRecord(envelope.usage) ? envelope.usage : undefined;
        return {
          status: 'completed',
          ...(typeof envelope.id === 'string'
            ? { responseId: envelope.id }
            : {}),
          usage: {
            generatedImages: integer(
              usage?.generated_images ?? usage?.image_count,
              outputIndex,
            ),
          },
        };
      } catch (error) {
        if (request.signal.aborted)
          return { status: 'cancelled', error: cancelledError() };
        return { status: 'failed', error: normalizeError(error) };
      }
    },
  });
}

function wireSize(size: string | { width: number; height: number }): string {
  return typeof size === 'string' ? size : `${size.width}x${size.height}`;
}
function integer(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 0
    ? Number(value)
    : fallback;
}
function mediaType(url: string): string {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/png';
}
async function jsonBody(body: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw invalidResponse('Ark Images returned invalid JSON');
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResponse(`${name} must be an object`);
  return value;
}
function providerError(status: number, body: unknown): AiRuntimeError {
  const record = isRecord(body) ? body : {};
  const nested = isRecord(record.error) ? record.error : record;
  return new AiRuntimeError(
    typeof nested.code === 'string' ? nested.code : `ARK_IMAGES_HTTP_${status}`,
    status === 401 || status === 403
      ? 'auth'
      : status === 429
        ? 'rate_limit'
        : status >= 500
          ? 'provider'
          : 'invalid_request',
    typeof nested.message === 'string'
      ? nested.message
      : `Ark Images request failed with HTTP ${status}`,
    status === 429 || status >= 500,
  );
}
function invalidResponse(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'ARK_IMAGES_RESPONSE_INVALID',
    'invalid_response',
    message,
  );
}
function normalizeError(error: unknown): AiError {
  return error instanceof AiRuntimeError
    ? error
    : new AiRuntimeError(
        'ARK_IMAGES_FAILED',
        'protocol',
        error instanceof Error ? error.message : 'Ark Images failed',
      );
}
function cancelledError(): AiError & { readonly category: 'cancelled' } {
  return new AiRuntimeError(
    'IMAGE_CANCELLED',
    'cancelled',
    'image generation was cancelled',
  ) as AiError & { readonly category: 'cancelled' };
}
