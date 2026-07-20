import type { JsonValue } from '../core/content.js';
import type { GenerationDomain } from './progress.js';

export interface GenerationOperationEnvelope {
  readonly domain: GenerationDomain;
  readonly claimsVersion: number;
  readonly claims: JsonValue;
}

export interface GenerationOperationPolicy {
  readonly maxTtlMs: number;
  readonly allowedClockSkewMs: number;
}

export type GenerationOperationSealResult =
  | Readonly<{ status: 'sealed'; token: string }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

export type GenerationOperationOpenResult =
  | Readonly<{ status: 'opened'; envelope: GenerationOperationEnvelope }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

export interface GenerationOperationCodec {
  readonly persistence: 'cross-runtime';
  seal(
    envelope: GenerationOperationEnvelope,
    signal?: AbortSignal,
  ): Promise<GenerationOperationSealResult>;
  open(
    sealedToken: string,
    signal?: AbortSignal,
  ): Promise<GenerationOperationOpenResult>;
}

export const defaultGenerationOperationPolicy: Readonly<GenerationOperationPolicy> =
  Object.freeze({ maxTtlMs: 86_400_000, allowedClockSkewMs: 60_000 });

export function resolveGenerationOperationPolicy(
  input: GenerationOperationPolicy = defaultGenerationOperationPolicy,
): Readonly<GenerationOperationPolicy> {
  if (
    !Number.isInteger(input.maxTtlMs) ||
    input.maxTtlMs < 60_000 ||
    input.maxTtlMs > 604_800_000
  )
    throw new TypeError('generation operation maxTtlMs is out of range');
  if (
    !Number.isInteger(input.allowedClockSkewMs) ||
    input.allowedClockSkewMs < 0 ||
    input.allowedClockSkewMs > 300_000
  )
    throw new TypeError(
      'generation operation allowedClockSkewMs is out of range',
    );
  return Object.freeze({ ...input });
}

export function validateGenerationOperationEnvelope(
  input: unknown,
): Readonly<GenerationOperationEnvelope> {
  if (!isPlainRecord(input))
    throw new TypeError('generation operation envelope must be an object');
  if (input.domain !== 'images' && input.domain !== 'videos')
    throw new TypeError('invalid generation operation domain');
  if (!Number.isInteger(input.claimsVersion) || Number(input.claimsVersion) < 1)
    throw new TypeError('invalid generation operation claimsVersion');
  assertJsonValue(input.claims, new Set());
  return Object.freeze({
    domain: input.domain,
    claimsVersion: Number(input.claimsVersion),
    claims: input.claims as JsonValue,
  });
}

export function validateGenerationOperationTimes(
  input: Readonly<{ issuedAt: number; expiresAt: number }>,
  policy: GenerationOperationPolicy,
  now: number,
): void {
  if (!Number.isInteger(input.issuedAt) || !Number.isInteger(input.expiresAt))
    throw new TypeError('operation timestamps must be integers');
  if (input.issuedAt >= input.expiresAt)
    throw new TypeError('operation issuedAt must precede expiresAt');
  if (input.expiresAt - input.issuedAt > policy.maxTtlMs)
    throw new TypeError('operation TTL exceeds maxTtlMs');
  if (input.issuedAt > now + policy.allowedClockSkewMs)
    throw new TypeError('operation was issued too far in the future');
  if (now > input.expiresAt + policy.allowedClockSkewMs)
    throw new TypeError('operation has expired');
}

export function isSerializedOperationTokenShape(value: string): boolean {
  return (
    value.length >= 16 &&
    value.length <= 16_384 &&
    /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,4}$/u.test(value)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite JSON number');
    return;
  }
  if (typeof value !== 'object') throw new TypeError('claims must be JSON');
  if (seen.has(value)) throw new TypeError('cyclic operation claims');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen);
  } else {
    if (!isPlainRecord(value)) throw new TypeError('invalid claims prototype');
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor')
        throw new TypeError('unsafe operation claims key');
      assertJsonValue((value as Record<string, unknown>)[key], seen);
    }
  }
  seen.delete(value);
}
