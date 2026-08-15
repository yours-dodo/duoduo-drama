import type {
  MaterializedTransportRequest,
  TransportDriver,
} from '@duoduo/ai/transport';

/**
 * Node fetch transport for `@duoduo/ai`. The runtime has no built-in driver;
 * hosts (CLI/agent) supply one at the composition boundary. The response body
 * is streamed through in chunks (never buffered as one blob) so the SSE
 * parser sees provider frames at their natural size.
 */
export function createFetchTransportDriver(): TransportDriver {
  return {
    async send(request: MaterializedTransportRequest) {
      const response = await fetch(request.url.href, {
        method: request.method,
        headers: request.headers as Record<string, string>,
        body: normalizeBody(request.body),
        signal: request.signal,
        redirect: request.redirect,
      });
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: streamResponseBody(response.body),
      };
    },
    async dispose() {
      // fetch needs no cleanup.
    },
  };
}

async function* streamResponseBody(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<Uint8Array> {
  if (!body) return;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value && value.byteLength > 0) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function normalizeBody(
  body: string | Uint8Array | ReadableStream<Uint8Array> | undefined,
): string | Uint8Array | ReadableStream<Uint8Array> | undefined {
  if (body === undefined) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return body;
  return body;
}

