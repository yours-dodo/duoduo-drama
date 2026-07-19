export type RetryKind = 'network' | 'rate_limit' | 'timeout' | 'provider_5xx';

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
  readonly retryOn: readonly RetryKind[];
}

export function parseRetryAfter(
  value: string | undefined,
  now = Date.now(),
): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed))
    return Math.max(0, Math.ceil(Number(trimmed) * 1_000));
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : undefined;
}

export function retryDelay(
  policy: RetryPolicy,
  attempt: number,
  retryAfterMs?: number,
  random = Math.random,
): number {
  const exponential = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  const jitter = exponential * policy.jitterRatio * (random() * 2 - 1);
  const calculated = Math.max(0, Math.round(exponential + jitter));
  return Math.max(calculated, retryAfterMs ?? 0);
}

export function validateRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1)
    throw new TypeError('retry maxAttempts must be a positive integer');
  if (
    !Number.isFinite(policy.baseDelayMs) ||
    policy.baseDelayMs < 0 ||
    !Number.isFinite(policy.maxDelayMs) ||
    policy.maxDelayMs < policy.baseDelayMs
  )
    throw new TypeError('retry delays must be finite and ordered');
  if (
    !Number.isFinite(policy.jitterRatio) ||
    policy.jitterRatio < 0 ||
    policy.jitterRatio > 1
  )
    throw new TypeError('retry jitterRatio must be between zero and one');
}
