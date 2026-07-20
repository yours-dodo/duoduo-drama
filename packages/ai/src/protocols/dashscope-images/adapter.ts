import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type {
  DirectImageProtocolAdapter,
  ImageProtocolContract,
  ImageProtocolEventSink,
  ImageProtocolRequest,
  ImageProtocolTerminal,
} from '../../images/contracts.js';

export interface DashScopeImagesCompatibility {
  readonly wireVersion: 1;
  readonly route: 'multimodal-generation';
}
export type DashScopeImagesOptions = Readonly<Record<string, never>>;

declare module '../../images/contracts.js' {
  interface ImageProtocolOptionsMap {
    'dashscope-images': DashScopeImagesOptions;
  }
  interface ImageProtocolCompatibilityMap {
    'dashscope-images': DashScopeImagesCompatibility;
  }
}

export const dashScopeImagesContract: ImageProtocolContract<'dashscope-images'> =
  Object.freeze({
    parseOptions(input: unknown): DashScopeImagesOptions {
      if (!isRecord(input) || Object.keys(input).length !== 0)
        throw new AiRuntimeError(
          'DASHSCOPE_IMAGES_OPTIONS_INVALID',
          'invalid_request',
          'DashScope Images does not accept protocol extension fields',
        );
      return Object.freeze({});
    },
    mergeOptions(layers: readonly (DashScopeImagesOptions | undefined)[]) {
      for (const layer of layers) this.parseOptions(layer ?? {});
      return Object.freeze({});
    },
    parseCompatibility(input: unknown): DashScopeImagesCompatibility {
      if (
        !isRecord(input) ||
        input.wireVersion !== 1 ||
        input.route !== 'multimodal-generation' ||
        Object.keys(input).length !== 2
      )
        throw new AiRuntimeError(
          'DASHSCOPE_IMAGES_COMPATIBILITY_INVALID',
          'invalid_request',
          'invalid DashScope Images compatibility profile',
        );
      return Object.freeze({ wireVersion: 1, route: 'multimodal-generation' });
    },
  });

export function createDashScopeImagesAdapter(): DirectImageProtocolAdapter<'dashscope-images'> {
  return Object.freeze({
    id: 'dashscope-images',
    operationMode: 'direct',
    contract: dashScopeImagesContract,
    async run(
      request: ImageProtocolRequest<'dashscope-images'>,
      sink: ImageProtocolEventSink,
    ): Promise<ImageProtocolTerminal> {
      try {
        const response = await request.transport.send({
          method: 'POST',
          headers: Object.freeze({}),
          body: JSON.stringify({
            model: request.model.upstreamModelId,
            input: {
              messages: [
                {
                  role: 'user',
                  content: request.input.content.map((part) =>
                    part.type === 'text'
                      ? { text: part.text }
                      : {
                          image:
                            part.image.source.type === 'url'
                              ? part.image.source.url
                              : `data:${part.image.mediaType};base64,${part.image.source.data}`,
                        },
                  ),
                },
              ],
            },
            parameters: {
              n: request.input.count,
              size: wireSize(request.input.size),
              ...(request.input.seed === undefined
                ? {}
                : { seed: request.input.seed }),
            },
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
        const envelope = requireRecord(value, 'DashScope Images response');
        const output = requireRecord(
          envelope.output,
          'DashScope Images output',
        );
        const choices = Array.isArray(output.choices) ? output.choices : [];
        let outputIndex = 0;
        for (const choice of choices) {
          if (!isRecord(choice) || !isRecord(choice.message)) continue;
          const content = Array.isArray(choice.message.content)
            ? choice.message.content
            : [];
          for (const part of content) {
            if (!isRecord(part)) continue;
            if (typeof part.image === 'string') {
              await sink.publish({
                type: 'generation_output',
                outputIndex: outputIndex++,
                output: {
                  type: 'image',
                  image: imageFromValue(part.image),
                },
              });
            } else if (typeof part.text === 'string') {
              await sink.publish({
                type: 'generation_output',
                outputIndex: outputIndex++,
                output: { type: 'text', text: part.text },
              });
            }
          }
        }
        if (outputIndex === 0)
          throw invalidResponse('DashScope Images returned no outputs');
        const usage = isRecord(envelope.usage) ? envelope.usage : undefined;
        return {
          status: 'completed',
          ...(typeof envelope.request_id === 'string'
            ? { responseId: envelope.request_id }
            : {}),
          ...(usage && Number.isInteger(usage.image_count)
            ? { usage: { generatedImages: usage.image_count as number } }
            : {}),
        };
      } catch (error) {
        if (request.signal.aborted)
          return { status: 'cancelled', error: cancelledError() };
        return { status: 'failed', error: normalizeError(error) };
      }
    },
  });
}

function wireSize(
  size: string | { readonly width: number; readonly height: number },
): string {
  if (typeof size === 'string') return size.replace('x', '*');
  return `${size.width}*${size.height}`;
}

function imageFromValue(value: string) {
  const data = /^data:([^;,]+);base64,(.+)$/u.exec(value);
  return Object.freeze(
    data
      ? {
          mediaType: data[1]!,
          source: Object.freeze({ type: 'base64' as const, data: data[2]! }),
        }
      : {
          mediaType: inferMediaType(value),
          source: Object.freeze({ type: 'url' as const, url: value }),
        },
  );
}

function inferMediaType(url: string): string {
  return url.toLowerCase().includes('.webp')
    ? 'image/webp'
    : url.toLowerCase().includes('.jpg') || url.toLowerCase().includes('.jpeg')
      ? 'image/jpeg'
      : 'image/png';
}

async function jsonBody(body: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw invalidResponse('DashScope Images response is not valid JSON');
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
  return new AiRuntimeError(
    typeof record.code === 'string' ? record.code : 'DASHSCOPE_IMAGES_ERROR',
    status === 429
      ? 'rate_limit'
      : status >= 500
        ? 'provider'
        : 'invalid_request',
    typeof record.message === 'string'
      ? record.message
      : `DashScope Images request failed with HTTP ${status}`,
    status === 429 || status >= 500,
  );
}
function invalidResponse(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'DASHSCOPE_IMAGES_RESPONSE_INVALID',
    'invalid_response',
    message,
  );
}
function normalizeError(error: unknown): AiError {
  return error instanceof AiRuntimeError
    ? error
    : new AiRuntimeError(
        'DASHSCOPE_IMAGES_FAILED',
        'protocol',
        error instanceof Error ? error.message : 'DashScope Images failed',
      );
}
function cancelledError(): AiError & { readonly category: 'cancelled' } {
  return new AiRuntimeError(
    'IMAGE_CANCELLED',
    'cancelled',
    'image generation was cancelled',
  ) as AiError & { readonly category: 'cancelled' };
}
