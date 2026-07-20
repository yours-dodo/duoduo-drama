import { AiRuntimeError, type AiError } from '../../core/errors.js';
import type {
  DirectImageProtocolAdapter,
  ImageProtocolContract,
  ImageProtocolEventSink,
  ImageProtocolRequest,
  ImageProtocolTerminal,
} from '../../images/contracts.js';

export interface OpenRouterImagesCompatibility {
  readonly wireVersion: 1;
  readonly requestOperation: 'chat-completions';
  readonly outputEncoding: 'data-url';
}

export type NoImageProtocolFields = Readonly<Record<string, never>>;

declare module '../../images/contracts.js' {
  interface ImageProtocolOptionsMap {
    'openrouter-images': NoImageProtocolFields;
  }
  interface ImageProtocolCompatibilityMap {
    'openrouter-images': OpenRouterImagesCompatibility;
  }
}

export const openRouterImagesContract: ImageProtocolContract<'openrouter-images'> =
  Object.freeze({
    parseOptions(input: unknown): NoImageProtocolFields {
      if (!isEmptyObject(input))
        throw new AiRuntimeError(
          'OPENROUTER_IMAGES_OPTIONS_INVALID',
          'invalid_request',
          'OpenRouter Images does not accept protocol extension fields',
        );
      return Object.freeze({});
    },
    mergeOptions(
      layers: readonly (NoImageProtocolFields | undefined)[],
    ): NoImageProtocolFields {
      for (const layer of layers) this.parseOptions(layer ?? {});
      return Object.freeze({});
    },
    parseCompatibility(input: unknown): OpenRouterImagesCompatibility {
      if (
        !isRecord(input) ||
        input.wireVersion !== 1 ||
        input.requestOperation !== 'chat-completions' ||
        input.outputEncoding !== 'data-url' ||
        Object.keys(input).length !== 3
      )
        throw new AiRuntimeError(
          'OPENROUTER_IMAGES_COMPATIBILITY_INVALID',
          'invalid_request',
          'invalid OpenRouter Images compatibility profile',
        );
      return Object.freeze({
        wireVersion: 1,
        requestOperation: 'chat-completions',
        outputEncoding: 'data-url',
      });
    },
  });

export function createOpenRouterImagesAdapter(): DirectImageProtocolAdapter<'openrouter-images'> {
  return Object.freeze({
    id: 'openrouter-images',
    operationMode: 'direct',
    contract: openRouterImagesContract,
    run: async (
      request: ImageProtocolRequest<'openrouter-images'>,
      sink: ImageProtocolEventSink,
    ): Promise<ImageProtocolTerminal> => {
      try {
        const response = await request.transport.send({
          method: 'POST',
          headers: Object.freeze({}),
          body: JSON.stringify({
            model: request.model.upstreamModelId,
            messages: [
              {
                role: 'user',
                content: request.input.content.map((part) =>
                  part.type === 'text'
                    ? { type: 'text', text: part.text }
                    : {
                        type: 'image_url',
                        image_url: {
                          url: `data:${part.image.mediaType};base64,${part.image.source.type === 'base64' ? part.image.source.data : ''}`,
                        },
                      },
                ),
              },
            ],
            modalities: request.model.capabilities.output.includes('text')
              ? ['image', 'text']
              : ['image'],
            stream: false,
          }),
          responseMode: 'bytes',
          signal: request.signal,
        });
        const raw = await readBody(response.body);
        if (response.status < 200 || response.status >= 300)
          return {
            status: 'failed',
            error: providerError(response.status, raw),
          };
        const parsed = parseResponseEnvelope(raw);
        await publishOutputs(
          parsed.message,
          request.model.capabilities.output,
          sink,
        );
        return {
          status: 'completed',
          ...(parsed.responseId ? { responseId: parsed.responseId } : {}),
          ...(parsed.usage ? { usage: parsed.usage } : {}),
        };
      } catch (error) {
        if (request.signal.aborted)
          return {
            status: 'cancelled',
            error: cancelledError(),
          };
        return {
          status: 'failed',
          error: normalizeError(error),
        };
      }
    },
  });
}

function parseResponseEnvelope(raw: string): {
  responseId?: string;
  message: Readonly<Record<string, unknown>>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
} {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AiRuntimeError(
      'OPENROUTER_IMAGES_RESPONSE_INVALID',
      'invalid_response',
      'OpenRouter Images response is not valid JSON',
    );
  }
  if (!isRecord(value) || !Array.isArray(value.choices))
    throw invalidResponse();
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) throw invalidResponse();
  const usage = parseUsage(value.usage);
  return {
    ...(typeof value.id === 'string' ? { responseId: value.id } : {}),
    message: first.message,
    ...(usage ? { usage } : {}),
  };
}

async function publishOutputs(
  message: Readonly<Record<string, unknown>>,
  allowedOutputs: readonly ('text' | 'image')[],
  sink: ImageProtocolEventSink,
): Promise<void> {
  let outputIndex = 0;
  if (typeof message.content === 'string' && message.content.length > 0) {
    if (!allowedOutputs.includes('text')) throw modalityError('text');
    await sink.publish({
      type: 'generation_output',
      outputIndex: outputIndex++,
      output: Object.freeze({ type: 'text', text: message.content }),
    });
  } else if (message.content !== undefined && message.content !== null) {
    throw invalidResponse();
  }
  if (message.images !== undefined && !Array.isArray(message.images))
    throw invalidResponse();
  for (const item of message.images ?? []) {
    if (!allowedOutputs.includes('image')) throw modalityError('image');
    if (!isRecord(item)) throw invalidResponse();
    const imageUrl =
      typeof item.image_url === 'string'
        ? item.image_url
        : isRecord(item.image_url) && typeof item.image_url.url === 'string'
          ? item.image_url.url
          : undefined;
    if (!imageUrl) throw invalidResponse();
    await sink.publish({
      type: 'generation_output',
      outputIndex: outputIndex++,
      output: Object.freeze({ type: 'image', image: parseDataUrl(imageUrl) }),
    });
  }
  if (outputIndex === 0)
    throw new AiRuntimeError(
      'OPENROUTER_IMAGES_OUTPUT_EMPTY',
      'invalid_response',
      'OpenRouter Images response did not contain an output',
    );
}

function parseUsage(value: unknown) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw invalidResponse();
  const prompt = nonNegativeNumber(value.prompt_tokens);
  const output = nonNegativeNumber(value.completion_tokens);
  const details = value.prompt_tokens_details;
  if (details !== undefined && !isRecord(details)) throw invalidResponse();
  const reportedCached = nonNegativeNumber(details?.cached_tokens);
  const cacheWrite = nonNegativeNumber(details?.cache_write_tokens);
  const cacheRead =
    cacheWrite > 0 ? Math.max(0, reportedCached - cacheWrite) : reportedCached;
  return Object.freeze({
    inputTokens: Math.max(0, prompt - cacheRead - cacheWrite),
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  });
}

function parseDataUrl(value: string) {
  const match =
    /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match)
    throw new AiRuntimeError(
      'OPENROUTER_IMAGES_DATA_URL_INVALID',
      'invalid_response',
      'OpenRouter Images returned an invalid image data URL',
    );
  return Object.freeze({
    mediaType: match[1]!.toLowerCase(),
    source: Object.freeze({ type: 'base64' as const, data: match[2]! }),
  });
}

async function readBody(body: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function cancelledError(): AiError & { readonly category: 'cancelled' } {
  return new AiRuntimeError(
    'IMAGE_GENERATION_CANCELLED',
    'cancelled',
    'image generation was cancelled',
  ) as AiError & { readonly category: 'cancelled' };
}

function providerError(status: number, body: string): AiError {
  return new AiRuntimeError(
    `OPENROUTER_IMAGES_HTTP_${status}`,
    status === 401 || status === 403
      ? 'auth'
      : status === 429
        ? 'rate_limit'
        : 'provider',
    body
      ? `OpenRouter Images request failed (${status}): ${body}`
      : `OpenRouter Images request failed (${status})`,
    status === 429 || status >= 500,
  );
}

function normalizeError(error: unknown): AiError {
  return error instanceof AiRuntimeError
    ? error
    : new AiRuntimeError(
        'OPENROUTER_IMAGES_FAILED',
        'protocol',
        error instanceof Error
          ? error.message
          : 'OpenRouter Images request failed',
      );
}

function invalidResponse(): AiRuntimeError {
  return new AiRuntimeError(
    'OPENROUTER_IMAGES_RESPONSE_INVALID',
    'invalid_response',
    'OpenRouter Images response has an invalid shape',
  );
}

function modalityError(output: string): AiRuntimeError {
  return new AiRuntimeError(
    'OPENROUTER_IMAGES_OUTPUT_MODALITY_MISMATCH',
    'invalid_response',
    `OpenRouter Images returned unsupported ${output} output`,
  );
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  return isRecord(value) && Object.keys(value).length === 0;
}
