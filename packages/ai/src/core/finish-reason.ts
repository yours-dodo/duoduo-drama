import type { AiError } from './errors.js';
import type {
  CompletedFinishReason,
  FinishReason,
  ResponseStatus,
} from './messages.js';

export function isCompletedFinishReason(
  reason: FinishReason,
): reason is CompletedFinishReason {
  return reason !== 'error' && reason !== 'cancelled';
}

export function statusForFinishReason(reason: FinishReason): ResponseStatus {
  if (reason === 'cancelled') return 'cancelled';
  if (reason === 'error') return 'failed';
  return 'completed';
}

export function isCancellableError(
  error: AiError,
): error is AiError & { readonly category: 'cancelled' } {
  return error.category === 'cancelled';
}
