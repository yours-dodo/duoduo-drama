import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';

import {
  SERVER_CONFIG,
  type ServerConfig,
} from '../../../config/server-config.js';
import { ApplicationError } from '../../../platform/http/application-error.js';
import { SESSION_COOKIE_NAME } from './session-auth.guard.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface OriginRequest {
  method: string;
  cookies?: Record<string, unknown>;
  headers?: { origin?: unknown };
  get?(name: string): string | undefined;
}

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  private readonly trustedOrigins: ReadonlySet<string>;

  constructor(@Inject(SERVER_CONFIG) config: ServerConfig) {
    this.trustedOrigins = new Set(config.trustedOrigins);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<OriginRequest>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    if (
      request.cookies === undefined ||
      !Object.hasOwn(request.cookies, SESSION_COOKIE_NAME)
    ) {
      return true;
    }

    const origin = request.get?.('origin') ?? request.headers?.origin;
    if (typeof origin === 'string' && this.trustedOrigins.has(origin)) {
      return true;
    }

    throw new ApplicationError({
      code: 'UNTRUSTED_ORIGIN',
      message: 'The request Origin is not trusted',
      statusCode: HttpStatus.FORBIDDEN,
    });
  }
}
