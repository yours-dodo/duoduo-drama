import { AiRuntimeError } from '../core/errors.js';
import type { NetworkPolicy, TransportDriver } from './types.js';

export interface LoadedTransportResource {
  readonly url: URL;
  readonly status: number;
  readonly contentType?: string;
  readonly body: Uint8Array;
}

export async function loadTransportResource(input: {
  readonly url: URL;
  readonly driver: TransportDriver;
  readonly networkPolicy: NetworkPolicy;
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  readonly timeoutMs?: number;
  readonly allowedContentTypes?: readonly string[];
  readonly maxRedirects?: number;
}): Promise<LoadedTransportResource> {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1)
    throw new TypeError('resource maxBytes must be a positive integer');
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(input.signal.reason);
  if (input.signal.aborted) forwardAbort();
  else input.signal.addEventListener('abort', forwardAbort, { once: true });
  const timer =
    input.timeoutMs === undefined
      ? undefined
      : setTimeout(
          () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
          input.timeoutMs,
        );
  try {
    let url = new URL(input.url);
    let redirectFrom: URL | undefined;
    const maxRedirects = input.maxRedirects ?? 4;
    for (let redirects = 0; ; redirects += 1) {
      await input.networkPolicy.authorize(
        {
          url: new URL(url),
          purpose: 'media',
          ...(redirectFrom ? { redirectFrom: new URL(redirectFrom) } : {}),
        },
        controller.signal,
      );
      const response = await input.driver.send({
        url: new URL(url),
        method: 'GET',
        headers: Object.freeze({}),
        responseMode: 'bytes',
        redirect: 'manual',
        limits: Object.freeze({
          maxRequestBytes: 0,
          maxResponseBytes: input.maxBytes,
          maxErrorBytes: Math.min(input.maxBytes, 64 * 1024),
          maxFrameBytes: input.maxBytes,
        }),
        signal: controller.signal,
      });
      const location = redirectLocation(response.status, response.headers);
      if (location) {
        await discardBody(response.body);
        if (redirects >= maxRedirects)
          throw resourceError(
            'RESOURCE_REDIRECT_NOT_ALLOWED',
            'resource redirect limit exceeded',
          );
        const next = new URL(location, url);
        if (next.origin !== input.url.origin)
          throw resourceError(
            'RESOURCE_REDIRECT_NOT_ALLOWED',
            'cross-origin resource redirect is not allowed',
          );
        redirectFrom = url;
        url = next;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        await discardBody(response.body);
        throw resourceError('RESOURCE_HTTP_ERROR', 'resource request failed');
      }
      const contentType = normalizeContentType(
        response.headers['content-type'],
      );
      if (
        input.allowedContentTypes?.length &&
        (!contentType || !input.allowedContentTypes.includes(contentType))
      ) {
        await discardBody(response.body);
        throw resourceError(
          'RESOURCE_CONTENT_TYPE_NOT_ALLOWED',
          'resource content type is not allowed',
        );
      }
      return Object.freeze({
        url: new URL(url),
        status: response.status,
        ...(contentType ? { contentType } : {}),
        body: await readLimited(response.body, input.maxBytes),
      });
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    input.signal.removeEventListener('abort', forwardAbort);
  }
}

async function discardBody(body: AsyncIterable<Uint8Array>): Promise<void> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    await iterator.return?.();
  } catch {
    // Cleanup failure must not mask the resource policy decision.
  }
}

async function readLimited(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const part of body) {
    total += part.byteLength;
    if (total > maxBytes)
      throw resourceError('RESOURCE_TOO_LARGE', 'resource exceeds byte limit');
    parts.push(part);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function redirectLocation(
  status: number,
  headers: Readonly<Record<string, string>>,
): string | undefined {
  return status >= 300 && status <= 399 ? headers.location : undefined;
}

function normalizeContentType(value: string | undefined): string | undefined {
  return value?.split(';', 1)[0]?.trim().toLowerCase() || undefined;
}

function resourceError(code: string, message: string): AiRuntimeError {
  return new AiRuntimeError(code, 'invalid_response', message);
}
