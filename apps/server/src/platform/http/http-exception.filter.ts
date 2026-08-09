import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  ApplicationError,
  type ApplicationErrorDetail,
} from './application-error.js';
import { readRequestId } from './request-id.middleware.js';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details: readonly ApplicationErrorDetail[];
  };
}

interface MappedException {
  statusCode: number;
  code: string;
  message: string;
  details: readonly ApplicationErrorDetail[];
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const mappedException = mapException(exception);
    const envelope: ErrorEnvelope = {
      error: {
        code: mappedException.code,
        message: mappedException.message,
        requestId: readRequestId(request),
        details: mappedException.details,
      },
    };

    response.status(mappedException.statusCode).json(envelope);
  }
}

function mapException(exception: unknown): MappedException {
  if (exception instanceof ApplicationError) {
    return {
      statusCode: exception.statusCode,
      code: exception.code,
      message: exception.message,
      details: exception.details,
    };
  }

  if (exception instanceof HttpException) {
    return mapHttpException(exception);
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred',
    details: [],
  };
}

function mapHttpException(exception: HttpException): MappedException {
  const statusCode = exception.getStatus();
  const response = exception.getResponse();
  const validationMessages = readValidationMessages(response);

  if (
    statusCode === HttpStatus.BAD_REQUEST &&
    validationMessages !== undefined
  ) {
    return {
      statusCode,
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: validationMessages,
    };
  }

  return {
    statusCode,
    code: httpStatusCode(statusCode),
    message: httpStatusMessage(statusCode),
    details: [],
  };
}

function readValidationMessages(
  response: string | object,
): string[] | undefined {
  if (
    typeof response !== 'object' ||
    response === null ||
    !('message' in response) ||
    !Array.isArray(response.message) ||
    !response.message.every((message) => typeof message === 'string')
  ) {
    return undefined;
  }

  return response.message;
}

function httpStatusCode(statusCode: number): string {
  const codes: Partial<Record<number, string>> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  };

  return codes[statusCode] ?? 'HTTP_ERROR';
}

function httpStatusMessage(statusCode: number): string {
  const messages: Partial<Record<number, string>> = {
    [HttpStatus.BAD_REQUEST]: 'The request was invalid',
    [HttpStatus.UNAUTHORIZED]: 'Authentication is required',
    [HttpStatus.FORBIDDEN]: 'Access is forbidden',
    [HttpStatus.NOT_FOUND]: 'Resource not found',
    [HttpStatus.CONFLICT]: 'The request conflicts with the current state',
    [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests',
  };

  return messages[statusCode] ?? 'The request could not be completed';
}
