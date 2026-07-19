import { createHash } from 'node:crypto';

import type {
  MaterializedTransportRequest,
  TransportBody,
  TransportDriver,
  TransportResponse,
} from './types.js';

export interface ExpectedFixtureRequest {
  readonly method?: MaterializedTransportRequest['method'];
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly jsonBody?: unknown;
}

export interface FixtureTransportResponse {
  readonly expectedRequest?: ExpectedFixtureRequest;
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly bodyChunks: readonly Uint8Array[];
  readonly chunkDelayMs?: number;
}

export interface RedactedFixtureRequest {
  readonly method: string;
  readonly origin: string;
  readonly pathname: string;
  readonly headerNames: readonly string[];
  readonly bodyDigest?: string;
}

export interface FixtureTransportDriver extends TransportDriver {
  enqueue(response: FixtureTransportResponse): void;
  requests(): readonly RedactedFixtureRequest[];
  pendingCount(): number;
}

export function createFixtureTransportDriver(): FixtureTransportDriver {
  const queue: FixtureTransportResponse[] = [];
  const records: RedactedFixtureRequest[] = [];
  return {
    enqueue: (response) => queue.push(response),
    pendingCount: () => queue.length,
    requests: () =>
      Object.freeze(records.map((record) => Object.freeze({ ...record }))),
    send: async (request): Promise<TransportResponse> => {
      const response = queue.shift();
      if (!response)
        throw new Error('fixture transport response queue is empty');
      const bodyBytes = await materializeBody(request.body);
      assertExpected(response.expectedRequest, request, bodyBytes);
      records.push(
        Object.freeze({
          method: request.method,
          origin: request.url.origin,
          pathname: request.url.pathname,
          headerNames: Object.freeze(Object.keys(request.headers).sort()),
          ...(bodyBytes
            ? {
                bodyDigest: createHash('sha256')
                  .update(bodyBytes)
                  .digest('hex'),
              }
            : {}),
        }),
      );
      return {
        status: response.status,
        headers: normalizeHeaders(response.headers ?? {}),
        body: chunks(
          response.bodyChunks,
          response.chunkDelayMs,
          request.signal,
        ),
      };
    },
  };
}

async function materializeBody(
  body: TransportBody | undefined,
): Promise<Uint8Array | undefined> {
  if (body === undefined) return undefined;
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    parts.push(result.value);
    length += result.value.byteLength;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function assertExpected(
  expected: ExpectedFixtureRequest | undefined,
  request: MaterializedTransportRequest,
  body: Uint8Array | undefined,
): void {
  if (!expected) return;
  if (expected.method && request.method !== expected.method)
    throw new Error(
      `fixture method mismatch: expected ${expected.method}, received ${request.method}`,
    );
  if (expected.url && request.url.href !== expected.url)
    throw new Error(
      `fixture URL mismatch: expected ${expected.url}, received ${request.url.href}`,
    );
  for (const [name, value] of Object.entries(expected.headers ?? {})) {
    if (request.headers[name.toLowerCase()] !== value)
      throw new Error(`fixture header mismatch: ${name.toLowerCase()}`);
  }
  if (expected.jsonBody !== undefined) {
    const actual = body
      ? JSON.parse(new TextDecoder().decode(body))
      : undefined;
    if (JSON.stringify(actual) !== JSON.stringify(expected.jsonBody))
      throw new Error(`fixture JSON body mismatch: ${JSON.stringify(actual)}`);
  }
  if (request.redirect !== 'manual')
    throw new Error('fixture request must disable redirects');
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    ),
  );
}

async function* chunks(
  values: readonly Uint8Array[],
  delayMs: number | undefined,
  signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  for (const value of values) {
    if (signal.aborted)
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (signal.aborted)
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    yield value;
  }
}
