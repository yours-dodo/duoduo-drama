import {
  TransportDriverFailure,
  type TransportFailurePhase,
} from '../dispatcher.js';
import type {
  MaterializedTransportRequest,
  TransportDriver,
  TransportResponse,
} from '../types.js';

export interface ProxyFetchInit extends RequestInit {
  readonly dispatcher?: unknown;
}

export type ProxyAwareFetch = (
  input: string | URL,
  init: ProxyFetchInit,
) => Promise<Response>;

export function createProxyFetchTransportDriver(options: {
  readonly fetch: ProxyAwareFetch;
  readonly proxyUrl?: string | URL;
  readonly createProxyDispatcher?: (proxyUrl: URL) => unknown;
  readonly classifyFailure?: (
    error: unknown,
    request: MaterializedTransportRequest,
  ) => TransportFailurePhase;
}): TransportDriver {
  const proxyUrl = normalizeProxyUrl(options.proxyUrl);
  const dispatcher = proxyUrl
    ? options.createProxyDispatcher?.(proxyUrl)
    : undefined;
  if (proxyUrl && dispatcher === undefined)
    throw new TypeError(
      'createProxyDispatcher is required when proxyUrl is configured',
    );
  return Object.freeze({
    send: async (
      request: MaterializedTransportRequest,
    ): Promise<TransportResponse> => {
      try {
        const response = await options.fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: bodyForFetch(request.body),
          redirect: 'manual',
          signal: request.signal,
          ...(dispatcher !== undefined ? { dispatcher } : {}),
        });
        return Object.freeze({
          status: response.status,
          headers: normalizeHeaders(response.headers),
          body: responseBody(response),
        });
      } catch (error) {
        if (error instanceof TransportDriverFailure) throw error;
        throw new TransportDriverFailure({
          phase:
            options.classifyFailure?.(error, request) ?? 'dispatch_unknown',
          kind:
            request.signal.aborted &&
            request.signal.reason instanceof DOMException &&
            request.signal.reason.name === 'TimeoutError'
              ? 'timeout'
              : 'network',
          cause: error,
        });
      }
    },
  });
}

function normalizeProxyUrl(value: string | URL | undefined): URL | undefined {
  if (value === undefined) return undefined;
  const url = value instanceof URL ? new URL(value) : new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.hash)
    throw new TypeError('proxyUrl must be an HTTP(S) URL without a fragment');
  return url;
}

function bodyForFetch(
  body: MaterializedTransportRequest['body'],
): BodyInit | undefined {
  if (body === undefined || typeof body === 'string') return body;
  if (body instanceof Uint8Array)
    return body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as ArrayBuffer;
  return body;
}

function normalizeHeaders(headers: Headers): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(headers.entries()));
}

function responseBody(response: Response): AsyncIterable<Uint8Array> {
  const body = response.body;
  if (!body) return Object.freeze({ async *[Symbol.asyncIterator]() {} });
  return {
    async *[Symbol.asyncIterator]() {
      const reader = body.getReader();
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) return;
          yield result.value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
