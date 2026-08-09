import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  SERVER_CONFIG,
  type ServerConfig,
} from '../../../config/server-config.js';
import { InvalidEmailAddressError } from '../../../domain/identity/email-address.js';
import { ApplicationError } from '../../../platform/http/application-error.js';
import { readRequestId } from '../../../platform/http/request-id.middleware.js';
import { Logout } from '../application/logout.js';
import {
  RequestEmailLogin,
  type RequestEmailLoginOutput,
} from '../application/request-email-login.js';
import {
  InvalidLoginChallengeError,
  VerifyEmailLogin,
} from '../application/verify-email-login.js';
import { RequestEmailLoginDto } from './request-email-login.dto.js';
import { buildSessionCookieOptions } from './session-cookie.js';
import {
  readAuthenticatedSession,
  SessionAuthGuard,
  SESSION_COOKIE_NAME,
} from './session-auth.guard.js';
import { VerifyEmailLoginDto } from './verify-email-login.dto.js';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    @Inject(RequestEmailLogin)
    private readonly requestEmailLogin: RequestEmailLogin,
    @Inject(VerifyEmailLogin)
    private readonly verifyEmailLogin: VerifyEmailLogin,
    @Inject(Logout) private readonly logout: Logout,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  @Post('email-login-requests')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestLogin(
    @Body(
      new ValidationPipe({
        expectedType: RequestEmailLoginDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: RequestEmailLoginDto,
    @Req() request: Request,
  ): Promise<RequestEmailLoginOutput> {
    try {
      return await this.requestEmailLogin.execute({
        email: body.email,
        sourceAddress:
          request.ip ?? request.socket.remoteAddress ?? 'unknown-source',
      });
    } catch (error) {
      if (error instanceof InvalidEmailAddressError) {
        throw new ApplicationError({
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          statusCode: HttpStatus.BAD_REQUEST,
          details: ['email must be a valid email address'],
        });
      }

      throw error;
    }
  }

  @Post('email-login-verifications')
  @HttpCode(HttpStatus.OK)
  async verifyLogin(
    @Body(
      new ValidationPipe({
        expectedType: VerifyEmailLoginDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: VerifyEmailLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{
    user: { id: string; email: string };
    session: { expiresAt: Date };
  }> {
    try {
      const verified = await this.verifyEmailLogin.execute({
        token: body.token,
        requestId: readRequestId(request),
      });
      response.cookie(
        SESSION_COOKIE_NAME,
        verified.sessionToken,
        buildSessionCookieOptions(this.config, verified.sessionExpiresAt),
      );

      return {
        user: verified.user,
        session: { expiresAt: verified.sessionExpiresAt },
      };
    } catch (error) {
      if (error instanceof InvalidLoginChallengeError) {
        throw new ApplicationError({
          code: 'INVALID_LOGIN_CHALLENGE',
          message: 'The login token is invalid or expired',
          statusCode: HttpStatus.UNAUTHORIZED,
        });
      }

      throw error;
    }
  }

  @Delete('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  async deleteSession(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const authenticated = readAuthenticatedSession(request);
    await this.logout.execute({
      sessionId: authenticated.sessionId,
      requestId: readRequestId(request),
    });
    response.clearCookie(
      SESSION_COOKIE_NAME,
      buildSessionCookieOptions(this.config),
    );
  }
}
