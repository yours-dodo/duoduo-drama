import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export type RequestWithId = Request & { requestId: string };

export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const suppliedRequestId = request.get(REQUEST_ID_HEADER);
  const requestId =
    suppliedRequestId !== undefined && VALID_REQUEST_ID.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();

  (request as RequestWithId).requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

export function readRequestId(request: Request): string {
  return (request as RequestWithId).requestId;
}
