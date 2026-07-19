import { describe, expect, it } from 'vitest';

import { secret } from '../index.js';
import {
  bindRequestTransport,
  createFinalRequestTarget,
  createSecretHeaderValue,
} from './request-transport.js';
import { TransportDriverFailure, type RetrySafety } from './dispatcher.js';
import { parseRetryAfter } from './retry.js';
import type {
  MaterializedTransportRequest,
  TransportDriver,
  TransportResponse,
} from './types.js';

const emptyBody: AsyncIterable<Uint8Array> = {
  async *[Symbol.asyncIterator]() {},
};

function response(
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): TransportResponse {
  return { status, headers, body: emptyBody };
}

function target() {
  return createFinalRequestTarget({
    endpoint: new URL('https://api.example.com/v1/responses'),
    headers: {
      authorization: createSecretHeaderValue(secret('sk-dispatch'), 'Bearer'),
      'content-type': 'application/json',
    },
  });
}

function request() {
  return {
    method: 'POST' as const,
    body: '{}',
    responseMode: 'stream' as const,
    signal: new AbortController().signal,
  };
}

function retrySafety(mode: RetrySafety['mode']): RetrySafety {
  return mode === 'idempotency-key'
    ? { mode, headerName: 'idempotency-key', keyVersion: 1 }
    : { mode };
}

const retry = {
  maxAttempts: 2,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitterRatio: 0,
  retryOn: ['network', 'rate_limit', 'provider_5xx'] as const,
};

describe('transport dispatcher', () => {
  it('retries a pre-dispatch failure without requiring idempotency', async () => {
    let attempts = 0;
    const driver: TransportDriver = {
      send: async () => {
        attempts += 1;
        if (attempts === 1)
          throw new TransportDriverFailure({
            phase: 'pre_dispatch',
            kind: 'network',
          });
        return response();
      },
    };
    const transport = bindRequestTransport({
      target: target(),
      driver,
      networkPolicy: { authorize: async () => undefined },
      retry,
      retrySafety: retrySafety('before-dispatch-only'),
    });

    await expect(transport.send(request())).resolves.toMatchObject({
      status: 200,
    });
    expect(attempts).toBe(2);
  });

  it('does not retry a post-dispatch failure without idempotency', async () => {
    let attempts = 0;
    const driver: TransportDriver = {
      send: async () => {
        attempts += 1;
        throw new TransportDriverFailure({
          phase: 'post_dispatch',
          kind: 'network',
        });
      },
    };
    const transport = bindRequestTransport({
      target: target(),
      driver,
      networkPolicy: { authorize: async () => undefined },
      retry,
      retrySafety: retrySafety('before-dispatch-only'),
    });

    await expect(transport.send(request())).rejects.toBeInstanceOf(
      TransportDriverFailure,
    );
    expect(attempts).toBe(1);
  });

  it('reuses one idempotency key while honoring Retry-After', async () => {
    const requests: MaterializedTransportRequest[] = [];
    const driver: TransportDriver = {
      send: async (materialized) => {
        requests.push(materialized);
        return requests.length === 1
          ? response(429, { 'retry-after': '0' })
          : response();
      },
    };
    const transport = bindRequestTransport({
      target: target(),
      driver,
      networkPolicy: { authorize: async () => undefined },
      retry,
      retrySafety: retrySafety('idempotency-key'),
    });

    await expect(transport.send(request())).resolves.toMatchObject({
      status: 200,
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers['idempotency-key']).toMatch(/^v1\./);
    expect(requests[1]?.headers['idempotency-key']).toBe(
      requests[0]?.headers['idempotency-key'],
    );
    expect(parseRetryAfter('2', 1_000)).toBe(2_000);
    expect(parseRetryAfter(new Date(4_000).toUTCString(), 1_000)).toBe(3_000);
  });

  it('discards a retryable response body before the next attempt', async () => {
    let attempts = 0;
    let discardCalls = 0;
    const driver: TransportDriver = {
      send: async () => {
        attempts += 1;
        if (attempts > 1) return response();
        return {
          status: 500,
          headers: {},
          body: {
            [Symbol.asyncIterator]() {
              return {
                next: async () => ({ done: true, value: undefined }),
                return: async () => {
                  discardCalls += 1;
                  return { done: true, value: undefined };
                },
              };
            },
          },
        };
      },
    };
    const transport = bindRequestTransport({
      target: target(),
      driver,
      networkPolicy: { authorize: async () => undefined },
      retry,
      retrySafety: retrySafety('idempotent'),
    });

    await expect(transport.send(request())).resolves.toMatchObject({
      status: 200,
    });
    expect(attempts).toBe(2);
    expect(discardCalls).toBe(1);
  });

  it('does not replay a streaming request body after dispatch', async () => {
    let attempts = 0;
    const transport = bindRequestTransport({
      target: target(),
      driver: {
        send: async () => {
          attempts += 1;
          return response(500);
        },
      },
      networkPolicy: { authorize: async () => undefined },
      retry,
      retrySafety: retrySafety('idempotent'),
    });

    await expect(
      transport.send({
        ...request(),
        body: new ReadableStream<Uint8Array>(),
      }),
    ).resolves.toMatchObject({ status: 500 });
    expect(attempts).toBe(1);
  });

  it('never retries a failure with unknown dispatch state', async () => {
    let attempts = 0;
    const transport = bindRequestTransport({
      target: target(),
      driver: {
        send: async () => {
          attempts += 1;
          throw new TransportDriverFailure({
            phase: 'dispatch_unknown',
            kind: 'network',
          });
        },
      },
      networkPolicy: { authorize: async () => undefined },
      retry,
      retrySafety: retrySafety('idempotent'),
    });

    await expect(transport.send(request())).rejects.toMatchObject({
      phase: 'dispatch_unknown',
    });
    expect(attempts).toBe(1);
  });

  it('retries timeouts only when the retry policy opts in', async () => {
    const attemptCounts: number[] = [];
    const run = async (retryOn: readonly ('network' | 'timeout')[]) => {
      let attempts = 0;
      const transport = bindRequestTransport({
        target: target(),
        driver: {
          send: async () => {
            attempts += 1;
            if (attempts === 1)
              throw new TransportDriverFailure({
                phase: 'pre_dispatch',
                kind: 'timeout',
              });
            return response();
          },
        },
        networkPolicy: { authorize: async () => undefined },
        retry: { ...retry, retryOn },
        retrySafety: retrySafety('before-dispatch-only'),
      });
      try {
        return await transport.send(request());
      } finally {
        attemptCounts.push(attempts);
      }
    };

    await expect(run(['network'])).rejects.toMatchObject({ kind: 'timeout' });
    await expect(run(['timeout'])).resolves.toMatchObject({ status: 200 });
    expect(attemptCounts).toEqual([1, 2]);
  });

  it('re-authorizes each same-origin redirect without exposing auth cross-origin', async () => {
    const requests: MaterializedTransportRequest[] = [];
    const authorizations: { url: string; redirectFrom?: string }[] = [];
    const driver: TransportDriver = {
      send: async (materialized) => {
        requests.push(materialized);
        return requests.length === 1
          ? response(307, { location: '/v1/redirected' })
          : response();
      },
    };
    const transport = bindRequestTransport({
      target: target(),
      driver,
      networkPolicy: {
        authorize: async ({ url, redirectFrom }) => {
          authorizations.push({
            url: url.href,
            ...(redirectFrom ? { redirectFrom: redirectFrom.href } : {}),
          });
        },
      },
      redirect: 'same-origin',
    });

    await expect(transport.send(request())).resolves.toMatchObject({
      status: 200,
    });
    expect(requests.map((item) => item.url.href)).toEqual([
      'https://api.example.com/v1/responses',
      'https://api.example.com/v1/redirected',
    ]);
    expect(requests[1]?.headers.authorization).toBe('Bearer sk-dispatch');
    expect(authorizations[1]).toEqual({
      url: 'https://api.example.com/v1/redirected',
      redirectFrom: 'https://api.example.com/v1/responses',
    });

    const crossOriginDriver: TransportDriver = {
      send: async () =>
        response(307, { location: 'https://evil.example/v1/steal' }),
    };
    const crossOrigin = bindRequestTransport({
      target: target(),
      driver: crossOriginDriver,
      networkPolicy: { authorize: async () => undefined },
      redirect: 'same-origin',
    });
    await expect(crossOrigin.send(request())).rejects.toMatchObject({
      code: 'REDIRECT_NOT_ALLOWED',
    });
  });

  it('rejects per-request protected header overrides before dispatch', async () => {
    let attempts = 0;
    const transport = bindRequestTransport({
      target: target(),
      driver: {
        send: async () => {
          attempts += 1;
          return response();
        },
      },
      networkPolicy: { authorize: async () => undefined },
    });

    await expect(
      transport.send({
        ...request(),
        headers: { Authorization: 'caller-value' },
      }),
    ).rejects.toMatchObject({ code: 'PROTECTED_HEADER_CONFLICT' });
    expect(attempts).toBe(0);
  });
});
