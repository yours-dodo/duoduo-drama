import { HttpStatus } from '@nestjs/common';

import type {
  KeysetCursor,
  KeysetPage,
  KeysetPageRequest,
} from '../pagination/keyset-page.js';
import { ApplicationError } from './application-error.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readKeysetPage(input: {
  limit: number;
  cursor?: string;
}): KeysetPageRequest {
  return {
    limit: input.limit,
    after: input.cursor === undefined ? null : decodeCursor(input.cursor),
  };
}

export function keysetPageResponse<T>(page: KeysetPage<T>) {
  return {
    items: page.items,
    nextCursor: page.next === null ? null : encodeCursor(page.next),
  };
}

function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.at.toISOString(), cursor.id]),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(value: string): KeysetCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      !UUID_PATTERN.test(parsed[1])
    ) {
      throw new Error('invalid cursor shape');
    }
    const at = new Date(parsed[0]);
    if (!Number.isFinite(at.getTime()) || at.toISOString() !== parsed[0]) {
      throw new Error('invalid cursor timestamp');
    }
    return { at, id: parsed[1] };
  } catch {
    throw new ApplicationError({
      code: 'INVALID_CURSOR',
      message: 'The pagination cursor is invalid',
      statusCode: HttpStatus.BAD_REQUEST,
    });
  }
}
