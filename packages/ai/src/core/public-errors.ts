import {
  AiRuntimeError,
  type AiError,
  type AiErrorCategory,
} from './errors.js';
import type { AiDiagnostic } from './events.js';

export interface PublicErrorFallback {
  readonly code: string;
  readonly category: AiErrorCategory;
  readonly message: string;
  readonly retryable?: boolean;
}

const publicCategoryMessages: Readonly<Record<AiErrorCategory, string>> =
  Object.freeze({
    invalid_request: 'AI request is invalid',
    provider: 'AI provider request failed',
    protocol: 'AI provider protocol failed',
    invalid_response: 'AI provider returned an invalid response',
    timeout: 'AI request timed out',
    network: 'AI network request failed',
    rate_limit: 'AI provider rate limit exceeded',
    auth: 'AI authentication failed',
    cancelled: 'AI request was cancelled',
    internal: 'AI provider failed internally',
  });

const categories = new Set<AiErrorCategory>(
  Object.keys(publicCategoryMessages) as AiErrorCategory[],
);

export function toPublicAiError(
  error: unknown,
  fallback: PublicErrorFallback,
): AiError {
  const candidate = readAiError(error);
  if (!candidate)
    return new AiRuntimeError(
      fallback.code,
      fallback.category,
      fallback.message,
      fallback.retryable ?? false,
    );

  const category = categories.has(candidate.category)
    ? candidate.category
    : fallback.category;
  const code = isSafeErrorCode(candidate.code) ? candidate.code : fallback.code;
  return new AiRuntimeError(
    code,
    category,
    category === fallback.category
      ? fallback.message
      : publicCategoryMessages[category],
    candidate.retryable,
  );
}

export function toPublicDiagnostics(
  diagnostics: readonly AiDiagnostic[] | undefined,
): readonly AiDiagnostic[] | undefined {
  if (!diagnostics) return undefined;
  return Object.freeze(
    diagnostics.map((diagnostic) => {
      const code = isSafeErrorCode(diagnostic.code)
        ? diagnostic.code
        : 'AI_DIAGNOSTIC';
      const message = safeDiagnosticMessage(code, diagnostic.message);
      return Object.freeze({
        code,
        ...(message === undefined ? {} : { message }),
      });
    }),
  );
}

function readAiError(error: unknown):
  | Readonly<{
      code: string;
      category: AiErrorCategory;
      retryable: boolean;
    }>
  | undefined {
  if (!error || typeof error !== 'object') return undefined;
  try {
    const candidate = error as Partial<AiError>;
    if (
      candidate.name !== 'AiError' ||
      typeof candidate.code !== 'string' ||
      typeof candidate.category !== 'string' ||
      !categories.has(candidate.category as AiErrorCategory) ||
      typeof candidate.retryable !== 'boolean'
    )
      return undefined;
    return {
      code: candidate.code,
      category: candidate.category as AiErrorCategory,
      retryable: candidate.retryable,
    };
  } catch {
    return undefined;
  }
}

function isSafeErrorCode(code: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/u.test(code);
}

function safeDiagnosticMessage(
  code: string,
  message: string | undefined,
): string | undefined {
  if (message === undefined) return undefined;
  if (code === 'BEDROCK_LATENCY_MS' && /^\d{1,12}$/u.test(message))
    return message;
  if (
    code === 'LATE_PROVIDER_EVENT_DROPPED' &&
    /^\d{1,12} provider event\(s\) arrived after the attempt closed$/u.test(
      message,
    )
  )
    return message;
  return undefined;
}
