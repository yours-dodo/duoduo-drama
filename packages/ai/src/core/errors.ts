export type AiErrorCategory =
  | 'invalid_request'
  | 'provider'
  | 'protocol'
  | 'invalid_response'
  | 'timeout'
  | 'network'
  | 'rate_limit'
  | 'auth'
  | 'cancelled'
  | 'internal';

export interface AiError extends Error {
  readonly name: 'AiError';
  readonly code: string;
  readonly category: AiErrorCategory;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class AiRuntimeError extends Error implements AiError {
  readonly name = 'AiError' as const;

  constructor(
    readonly code: string,
    readonly category: AiErrorCategory,
    message: string,
    readonly retryable = false,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}

export function isContextOverflowError(error: AiError): boolean {
  return error.code === 'CONTEXT_OVERFLOW';
}
