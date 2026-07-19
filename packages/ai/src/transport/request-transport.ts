import { AiRuntimeError } from '../core/errors.js';
import type { SecretValue } from '../auth/secret-value.js';
import { revealSecret } from '../auth/secret-value.js';
import type {
  BoundTransportRequest,
  NetworkPolicy,
  RequestTransport,
  TransportDriver,
  TransportLimits,
  TransportResponse,
} from './types.js';
import {
  createIdempotencyHeaders,
  dispatchWithRetry,
  type RetrySafety,
} from './dispatcher.js';
import type { RetryPolicy } from './retry.js';

const protectedHeaderNames = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'cf-aig-authorization',
]);

declare const finalRequestTargetBrand: unique symbol;

export interface SecretHeaderValue {
  readonly secret: SecretValue;
  readonly prefix: string;
}

export interface RequestAuthorizationInput {
  readonly url: URL;
  readonly method: BoundTransportRequest['method'];
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: BoundTransportRequest['body'];
  readonly signal: AbortSignal;
}

export type RequestAuthorizationHeaders = Readonly<
  Record<string, string | SecretValue | SecretHeaderValue>
>;

export type RequestAuthorizer = (
  input: RequestAuthorizationInput,
) => Promise<RequestAuthorizationHeaders> | RequestAuthorizationHeaders;

export interface FinalRequestTarget {
  readonly [finalRequestTargetBrand]: true;
  readonly endpoint: URL;
  readonly headers: Readonly<
    Record<string, string | SecretValue | SecretHeaderValue>
  >;
  readonly limits: TransportLimits;
}

export function createFinalRequestTarget(input: {
  readonly endpoint: URL;
  readonly headers: Readonly<
    Record<string, string | SecretValue | SecretHeaderValue>
  >;
  readonly limits?: Partial<TransportLimits>;
}): FinalRequestTarget {
  const endpoint = new URL(input.endpoint);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  )
    throw new AiRuntimeError(
      'INVALID_REQUEST_TARGET',
      'invalid_request',
      'final request target must be an absolute HTTPS URL without userinfo or fragment',
    );
  const headers: Record<string, string | SecretValue | SecretHeaderValue> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    const normalized = normalizeHeaderName(name);
    if (normalized in headers)
      throw new AiRuntimeError(
        'DUPLICATE_HEADER',
        'invalid_request',
        'duplicate request header',
      );
    headers[normalized] = value;
  }
  return Object.freeze({
    endpoint,
    headers: Object.freeze(headers),
    limits: Object.freeze({
      maxRequestBytes: input.limits?.maxRequestBytes ?? 2 * 1024 * 1024,
      maxResponseBytes: input.limits?.maxResponseBytes ?? 16 * 1024 * 1024,
      maxErrorBytes: input.limits?.maxErrorBytes ?? 64 * 1024,
      maxFrameBytes: input.limits?.maxFrameBytes ?? 1024 * 1024,
    }),
  }) as FinalRequestTarget;
}

export function bindRequestTransport(input: {
  readonly target: FinalRequestTarget;
  readonly driver: TransportDriver;
  readonly networkPolicy: NetworkPolicy;
  readonly retry?: false | RetryPolicy;
  readonly retrySafety?: RetrySafety;
  readonly redirect?: 'error' | 'same-origin';
  readonly authorize?: RequestAuthorizer;
}): RequestTransport {
  return Object.freeze({
    send: async (request: BoundTransportRequest) => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(input.target.headers))
        headers[name] =
          typeof value === 'string'
            ? value
            : 'secret' in value
              ? `${value.prefix}${revealSecret(value.secret)}`
              : revealSecret(value);
      for (const [name, value] of Object.entries(request.headers ?? {})) {
        const normalized = normalizeHeaderName(name);
        if (isProtectedHeader(normalized))
          throw new AiRuntimeError(
            'PROTECTED_HEADER_CONFLICT',
            'invalid_request',
            'request cannot override a protected header',
          );
        if (normalized in headers)
          throw new AiRuntimeError(
            'DUPLICATE_HEADER',
            'invalid_request',
            'request header conflicts with the bound target',
          );
        headers[normalized] = value;
      }
      for (const [name, value] of Object.entries(
        createIdempotencyHeaders(input.retrySafety),
      )) {
        if (name in headers)
          throw new AiRuntimeError(
            'PROTECTED_HEADER_CONFLICT',
            'invalid_request',
            'idempotency header conflicts with a configured request header',
          );
        headers[name] = value;
      }
      const body = limitRequestBody(
        request.body,
        input.target.limits.maxRequestBytes,
      );
      let url = new URL(input.target.endpoint);
      let redirectFrom: URL | undefined;
      for (let redirects = 0; ; redirects += 1) {
        await input.networkPolicy.authorize(
          {
            url: new URL(url),
            purpose: 'model',
            ...(redirectFrom ? { redirectFrom: new URL(redirectFrom) } : {}),
          },
          request.signal,
        );
        const materializedRequest = {
          url: new URL(url),
          method: request.method,
          headers: Object.freeze({ ...headers }),
          body,
          responseMode: request.responseMode,
          redirect: 'manual' as const,
          limits: input.target.limits,
          signal: request.signal,
        };
        const response = await dispatchWithRetry({
          driver: input.driver,
          request: materializedRequest,
          ...(input.authorize
            ? {
                requestForAttempt: async () => ({
                  ...materializedRequest,
                  headers: await authorizeRequestHeaders(
                    input.authorize!,
                    materializedRequest,
                  ),
                }),
              }
            : {}),
          retry: input.retry,
          retrySafety: input.retrySafety,
        });
        const location = redirectLocation(response);
        if (!location)
          return limitResponseBody(
            response,
            response.status >= 200 && response.status < 300
              ? input.target.limits.maxResponseBytes
              : input.target.limits.maxErrorBytes,
          );
        await discardResponseBody(response.body);
        if (body instanceof ReadableStream)
          throw new AiRuntimeError(
            'REDIRECT_NOT_ALLOWED',
            'invalid_response',
            'streaming request bodies cannot be replayed across redirects',
          );
        if (input.redirect !== 'same-origin' || redirects >= 4)
          throw new AiRuntimeError(
            'REDIRECT_NOT_ALLOWED',
            'invalid_response',
            'transport redirect is not allowed',
          );
        const next = new URL(location, url);
        if (next.origin !== input.target.endpoint.origin)
          throw new AiRuntimeError(
            'REDIRECT_NOT_ALLOWED',
            'invalid_response',
            'cross-origin transport redirect is not allowed',
          );
        redirectFrom = url;
        url = next;
      }
    },
  });
}

async function authorizeRequestHeaders(
  authorize: RequestAuthorizer,
  request: import('./types.js').MaterializedTransportRequest,
): Promise<Readonly<Record<string, string>>> {
  const authorizedHeaders = { ...request.headers };
  const additions = await authorize({
    url: new URL(request.url),
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  });
  for (const [name, value] of Object.entries(additions)) {
    const normalized = normalizeHeaderName(name);
    if (normalized in authorizedHeaders)
      throw new AiRuntimeError(
        'PROTECTED_HEADER_CONFLICT',
        'invalid_request',
        'ambient authorization header conflicts with the request',
      );
    authorizedHeaders[normalized] = materializeHeaderValue(value);
  }
  return Object.freeze(authorizedHeaders);
}

function materializeHeaderValue(
  value: string | SecretValue | SecretHeaderValue,
): string {
  return typeof value === 'string'
    ? value
    : 'secret' in value
      ? `${value.prefix}${revealSecret(value.secret)}`
      : revealSecret(value);
}

function limitResponseBody(
  response: TransportResponse,
  maxBytes: number,
): TransportResponse {
  return Object.freeze({
    ...response,
    body: {
      async *[Symbol.asyncIterator]() {
        let total = 0;
        for await (const chunk of response.body) {
          total += chunk.byteLength;
          if (total > maxBytes)
            throw new AiRuntimeError(
              'TRANSPORT_RESPONSE_TOO_LARGE',
              'invalid_response',
              'transport response exceeds the configured byte limit',
            );
          yield chunk;
        }
      },
    },
  });
}

async function discardResponseBody(
  body: AsyncIterable<Uint8Array>,
): Promise<void> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    await iterator.return?.();
  } catch {
    // Cleanup failure must not mask the redirect policy decision.
  }
}

function limitRequestBody(
  body: BoundTransportRequest['body'],
  maxBytes: number,
): BoundTransportRequest['body'] {
  if (body === undefined) return undefined;
  if (typeof body === 'string') {
    if (new TextEncoder().encode(body).byteLength > maxBytes)
      throw requestTooLarge();
    return body;
  }
  if (body instanceof Uint8Array) {
    if (body.byteLength > maxBytes) throw requestTooLarge();
    return body;
  }
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          return;
        }
        total += result.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          controller.error(requestTooLarge());
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

function requestTooLarge(): AiRuntimeError {
  return new AiRuntimeError(
    'TRANSPORT_REQUEST_TOO_LARGE',
    'invalid_request',
    'transport request exceeds the configured byte limit',
  );
}

function redirectLocation(response: {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}): string | undefined {
  return response.status >= 300 && response.status <= 399
    ? response.headers.location
    : undefined;
}

export function isProtectedHeader(name: string): boolean {
  return protectedHeaderNames.has(name.toLowerCase());
}

function normalizeHeaderName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(normalized))
    throw new AiRuntimeError(
      'INVALID_HEADER',
      'invalid_request',
      'invalid request header name',
    );
  return normalized;
}

export function createSecretHeaderValue(
  secret: SecretValue,
  scheme: string,
): SecretHeaderValue {
  return Object.freeze({
    secret,
    prefix: scheme.length > 0 ? `${scheme} ` : '',
  });
}
