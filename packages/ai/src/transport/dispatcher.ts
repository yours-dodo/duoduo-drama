import { randomUUID } from 'node:crypto';

import type {
  MaterializedTransportRequest,
  TransportDriver,
  TransportResponse,
} from './types.js';
import {
  parseRetryAfter,
  retryDelay,
  type RetryKind,
  type RetryPolicy,
  validateRetryPolicy,
} from './retry.js';

export type RetrySafety =
  | Readonly<{ mode: 'before-dispatch-only' }>
  | Readonly<{ mode: 'idempotent' }>
  | Readonly<{
      mode: 'idempotency-key';
      headerName: string;
      keyVersion: number;
    }>;

export type TransportFailurePhase =
  'pre_dispatch' | 'post_dispatch' | 'dispatch_unknown';

export interface TransportDriverFailureOptions {
  readonly phase: TransportFailurePhase;
  readonly kind: 'network' | 'timeout';
  readonly cause?: unknown;
}

export class TransportDriverFailure extends Error {
  readonly phase: TransportFailurePhase;
  readonly kind: 'network' | 'timeout';

  constructor(options: TransportDriverFailureOptions) {
    super('transport driver failed', { cause: options.cause });
    this.name = 'TransportDriverFailure';
    this.phase = options.phase;
    this.kind = options.kind;
  }
}

export function createIdempotencyHeaders(
  safety: RetrySafety | undefined,
): Readonly<Record<string, string>> {
  if (safety?.mode !== 'idempotency-key') return Object.freeze({});
  const headerName = safety.headerName.trim().toLowerCase();
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(headerName))
    throw new TypeError('invalid idempotency header name');
  if (!Number.isInteger(safety.keyVersion) || safety.keyVersion < 1)
    throw new TypeError('idempotency keyVersion must be a positive integer');
  return Object.freeze({
    [headerName]: `v${safety.keyVersion}.${randomUUID()}`,
  });
}

export async function dispatchWithRetry(input: {
  readonly driver: TransportDriver;
  readonly request: MaterializedTransportRequest;
  readonly retry?: false | RetryPolicy;
  readonly retrySafety?: RetrySafety;
}): Promise<TransportResponse> {
  const policy = input.retry === false ? undefined : input.retry;
  if (policy) validateRetryPolicy(policy);
  const maxAttempts = policy?.maxAttempts ?? 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await input.driver.send(input.request);
      const kind = retryKindForStatus(response.status);
      if (
        !kind ||
        !policy ||
        attempt >= maxAttempts ||
        !policy.retryOn.includes(kind) ||
        !canRetryAfterDispatch(input.retrySafety, input.request.body)
      )
        return response;
      await discardResponseBody(response.body);
      await waitForRetry(
        retryDelay(
          policy,
          attempt,
          parseRetryAfter(response.headers['retry-after']),
        ),
        input.request.signal,
      );
    } catch (error) {
      if (!(error instanceof TransportDriverFailure)) throw error;
      if (
        !policy ||
        attempt >= maxAttempts ||
        !policy.retryOn.includes(error.kind) ||
        !canRetryFailure(error, input.retrySafety)
      )
        throw error;
      await waitForRetry(retryDelay(policy, attempt), input.request.signal);
    }
  }
}

function retryKindForStatus(status: number): RetryKind | undefined {
  if (status === 429) return 'rate_limit';
  if (status >= 500 && status <= 599) return 'provider_5xx';
  return undefined;
}

function canRetryFailure(
  failure: TransportDriverFailure,
  safety: RetrySafety | undefined,
): boolean {
  if (failure.phase === 'pre_dispatch') return true;
  if (failure.phase === 'dispatch_unknown') return false;
  return canRetryAfterDispatch(safety);
}

function canRetryAfterDispatch(
  safety: RetrySafety | undefined,
  body?: MaterializedTransportRequest['body'],
): boolean {
  if (body instanceof ReadableStream) return false;
  return safety?.mode === 'idempotent' || safety?.mode === 'idempotency-key';
}

async function discardResponseBody(
  body: AsyncIterable<Uint8Array>,
): Promise<void> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    await iterator.return?.();
  } catch {
    // A failed discard must not replace the retry decision.
  }
}

async function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
