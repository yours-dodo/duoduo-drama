import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';

import type { ServerEnvironment } from '../../config/server-config.js';
import { readRequestId } from '../http/request-id.middleware.js';

export interface RequestLogRecord {
  event: 'http.request.completed';
  service: 'server';
  environment: ServerEnvironment;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

export interface RequestLogSink {
  write(record: RequestLogRecord): void;
}

export class JsonRequestLogSink implements RequestLogSink {
  private readonly logger = new Logger('HttpRequest');

  write(record: RequestLogRecord): void {
    this.logger.log(JSON.stringify(record));
  }
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly environment: ServerEnvironment,
    private readonly sink: RequestLogSink,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    response.once('finish', () => {
      const elapsedNanoseconds = process.hrtime.bigint() - startedAt;

      this.sink.write({
        event: 'http.request.completed',
        service: 'server',
        environment: this.environment,
        requestId: readRequestId(request),
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Number(elapsedNanoseconds) / 1_000_000,
      });
    });

    return next.handle();
  }
}
