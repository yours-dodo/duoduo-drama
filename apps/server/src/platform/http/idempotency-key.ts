import { HttpStatus } from '@nestjs/common';

import { ApplicationError } from './application-error.js';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function readIdempotencyKey(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new ApplicationError({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'Idempotency-Key is required',
      statusCode: HttpStatus.BAD_REQUEST,
    });
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ApplicationError({
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key is invalid',
      statusCode: HttpStatus.BAD_REQUEST,
    });
  }
  return value;
}
