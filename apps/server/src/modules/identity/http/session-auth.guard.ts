import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';

import { ApplicationError } from '../../../platform/http/application-error.js';
import {
  IDENTITY_TOKEN_SECURITY,
  type IdentityTokenSecurity,
} from '../ports/identity-token-security.js';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from '../ports/session-repository.js';

export const SESSION_COOKIE_NAME = 'duoduo_session';

const AUTHENTICATED_SESSION = Symbol('AUTHENTICATED_SESSION');

export interface AuthenticatedSessionContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly email: string;
  readonly expiresAt: string;
}

type RequestWithSession = {
  cookies?: Record<string, unknown>;
  [AUTHENTICATED_SESSION]?: AuthenticatedSessionContext;
};

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(IDENTITY_TOKEN_SECURITY)
    private readonly security: Pick<IdentityTokenSecurity, 'hashSessionToken'>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (typeof token !== 'string' || token.length === 0) {
      throw authenticationRequired();
    }

    const session = await this.sessions.findActiveByTokenHash(
      this.security.hashSessionToken(token),
    );
    if (session === null) {
      throw authenticationRequired();
    }

    request[AUTHENTICATED_SESSION] = Object.freeze({
      sessionId: session.id,
      userId: session.userId,
      email: session.email,
      expiresAt: session.expiresAt.toISOString(),
    });
    return true;
  }
}

export function readAuthenticatedSession(
  request: object,
): AuthenticatedSessionContext {
  const session = (request as RequestWithSession)[AUTHENTICATED_SESSION];
  if (session === undefined) {
    throw new Error('Authenticated session context is unavailable');
  }

  return session;
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError({
    code: 'AUTHENTICATION_REQUIRED',
    message: 'Authentication is required',
    statusCode: HttpStatus.UNAUTHORIZED,
  });
}
