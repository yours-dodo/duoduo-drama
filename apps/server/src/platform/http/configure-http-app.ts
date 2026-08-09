import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import cookieParser from 'cookie-parser';

import type { ServerConfig } from '../../config/server-config.js';
import {
  JsonRequestLogSink,
  RequestLoggingInterceptor,
  type RequestLogSink,
} from '../observability/request-logging.interceptor.js';
import { HttpExceptionFilter } from './http-exception.filter.js';
import { requestIdMiddleware } from './request-id.middleware.js';

export interface ConfigureHttpAppOptions {
  requestLogSink?: RequestLogSink;
}

export function configureHttpApp(
  app: INestApplication,
  config: ServerConfig,
  options: ConfigureHttpAppOptions = {},
): void {
  app.use(requestIdMiddleware);
  app.enableCors({
    credentials: true,
    origin: config.trustedOrigins,
  });
  app.enableVersioning({ type: VersioningType.URI });
  app.use(cookieParser(config.cookieSecret));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new RequestLoggingInterceptor(
      config.environment,
      options.requestLogSink ?? new JsonRequestLogSink(),
    ),
  );
}
