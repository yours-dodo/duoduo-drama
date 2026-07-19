import { AiRuntimeError } from '../core/errors.js';
import type { SecretValue } from '../auth/secret-value.js';
import { revealSecret } from '../auth/secret-value.js';
import type {
  BoundTransportRequest,
  NetworkPolicy,
  RequestTransport,
  TransportDriver,
  TransportLimits,
} from './types.js';

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
}): RequestTransport {
  return Object.freeze({
    send: async (request: BoundTransportRequest) => {
      await input.networkPolicy.authorize(
        { url: new URL(input.target.endpoint), purpose: 'model' },
        request.signal,
      );
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(input.target.headers))
        headers[name] =
          typeof value === 'string'
            ? value
            : 'secret' in value
              ? `${value.prefix}${revealSecret(value.secret)}`
              : revealSecret(value);
      return input.driver.send({
        url: new URL(input.target.endpoint),
        method: request.method,
        headers: Object.freeze(headers),
        body: request.body,
        responseMode: request.responseMode,
        redirect: 'manual',
        limits: input.target.limits,
        signal: request.signal,
      });
    },
  });
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
