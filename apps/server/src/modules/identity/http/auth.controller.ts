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
import { LoginWithPassword } from '../application/login-with-password.js';
import { DevelopmentLogin } from '../application/development-login.js';
import { Logout } from '../application/logout.js';
import {
  InvalidEmailVerificationCodeError,
  InvalidPasswordCredentialsError,
  InvalidPasswordError,
} from '../application/password-errors.js';
import { RequestEmailCode } from '../application/request-email-code.js';
import {
  RequestEmailLogin,
  type RequestEmailLoginOutput,
} from '../application/request-email-login.js';
import { ResetPasswordWithCode } from '../application/reset-password-with-code.js';
import { SetPassword } from '../application/set-password.js';
import { VerifyEmailCodeLogin } from '../application/verify-email-code-login.js';
import {
  InvalidLoginChallengeError,
  VerifyEmailLogin,
} from '../application/verify-email-login.js';
import { RequestEmailCodeDto } from './request-email-code.dto.js';
import { RequestEmailLoginDto } from './request-email-login.dto.js';
import { PasswordLoginDto } from './password-login.dto.js';
import { ResetPasswordDto } from './reset-password.dto.js';
import { SetPasswordDto } from './set-password.dto.js';
import { buildSessionCookieOptions } from './session-cookie.js';
import {
  readAuthenticatedSession,
  SessionAuthGuard,
  SESSION_COOKIE_NAME,
} from './session-auth.guard.js';
import { VerifyEmailCodeDto } from './verify-email-code.dto.js';
import { VerifyEmailLoginDto } from './verify-email-login.dto.js';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    @Inject(RequestEmailLogin)
    private readonly requestEmailLogin: RequestEmailLogin,
    @Inject(RequestEmailCode)
    private readonly requestEmailCode: RequestEmailCode,
    @Inject(VerifyEmailLogin)
    private readonly verifyEmailLogin: VerifyEmailLogin,
    @Inject(VerifyEmailCodeLogin)
    private readonly verifyEmailCodeLogin: VerifyEmailCodeLogin,
    @Inject(LoginWithPassword)
    private readonly loginWithPassword: LoginWithPassword,
    @Inject(DevelopmentLogin)
    private readonly developmentLogin: DevelopmentLogin,
    @Inject(SetPassword) private readonly setPassword: SetPassword,
    @Inject(ResetPasswordWithCode)
    private readonly resetPasswordWithCode: ResetPasswordWithCode,
    @Inject(Logout) private readonly logout: Logout,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  @Post('email-code-requests')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestEmailCodeChallenge(
    @Body(
      new ValidationPipe({
        expectedType: RequestEmailCodeDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: RequestEmailCodeDto,
    @Req() request: Request,
  ) {
    try {
      return await this.requestEmailCode.execute({
        email: body.email,
        sourceAddress:
          request.ip ?? request.socket.remoteAddress ?? 'unknown-source',
        purpose: 'login',
      });
    } catch (error) {
      throw mapEmailAddressError(error);
    }
  }

  @Post('password-reset-requests')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordResetCode(
    @Body(
      new ValidationPipe({
        expectedType: RequestEmailCodeDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: RequestEmailCodeDto,
    @Req() request: Request,
  ) {
    try {
      return await this.requestEmailCode.execute({
        email: body.email,
        sourceAddress:
          request.ip ?? request.socket.remoteAddress ?? 'unknown-source',
        purpose: 'password_reset',
      });
    } catch (error) {
      throw mapEmailAddressError(error);
    }
  }

  @Post('email-code-verifications')
  @HttpCode(HttpStatus.OK)
  async verifyEmailCode(
    @Body(
      new ValidationPipe({
        expectedType: VerifyEmailCodeDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: VerifyEmailCodeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const verified = await this.verifyEmailCodeLogin.execute({
        email: body.email,
        code: body.code,
        requestId: readRequestId(request),
      });
      this.writeSessionCookie(
        response,
        verified.sessionToken,
        verified.sessionExpiresAt,
      );

      return {
        user: verified.user,
        session: { expiresAt: verified.sessionExpiresAt },
        hasPassword: verified.hasPassword,
      };
    } catch (error) {
      throw mapAuthenticationError(error);
    }
  }

  @Post('development-logins')
  @HttpCode(HttpStatus.OK)
  async developmentLoginByEmail(
    @Body(
      new ValidationPipe({
        expectedType: RequestEmailCodeDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: RequestEmailCodeDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (this.config.environment !== 'development') {
      throw new ApplicationError({
        code: 'NOT_FOUND',
        message: 'Not found',
        statusCode: HttpStatus.NOT_FOUND,
      });
    }

    try {
      const loggedIn = await this.developmentLogin.execute({
        email: body.email,
      });
      this.writeSessionCookie(
        response,
        loggedIn.sessionToken,
        loggedIn.sessionExpiresAt,
      );

      return {
        user: loggedIn.user,
        session: { expiresAt: loggedIn.sessionExpiresAt },
        hasPassword: true,
      };
    } catch (error) {
      throw mapAuthenticationError(error);
    }
  }

  @Post('password-logins')
  @HttpCode(HttpStatus.OK)
  async loginByPassword(
    @Body(
      new ValidationPipe({
        expectedType: PasswordLoginDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: PasswordLoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const loggedIn = await this.loginWithPassword.execute({
        email: body.email,
        password: body.password,
      });
      this.writeSessionCookie(
        response,
        loggedIn.sessionToken,
        loggedIn.sessionExpiresAt,
      );

      return {
        user: loggedIn.user,
        session: { expiresAt: loggedIn.sessionExpiresAt },
        hasPassword: true,
      };
    } catch (error) {
      throw mapAuthenticationError(error);
    }
  }

  @Post('password-reset-verifications')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body(
      new ValidationPipe({
        expectedType: ResetPasswordDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: ResetPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const reset = await this.resetPasswordWithCode.execute(body);
      this.writeSessionCookie(
        response,
        reset.sessionToken,
        reset.sessionExpiresAt,
      );

      return {
        user: reset.user,
        session: { expiresAt: reset.sessionExpiresAt },
        hasPassword: true,
      };
    } catch (error) {
      throw mapAuthenticationError(error);
    }
  }

  @Post('passwords')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard)
  async setUserPassword(
    @Body(
      new ValidationPipe({
        expectedType: SetPasswordDto,
        transform: true,
        whitelist: true,
      }),
    )
    body: SetPasswordDto,
    @Req() request: Request,
  ) {
    try {
      const authenticated = readAuthenticatedSession(request);
      return await this.setPassword.execute({
        userId: authenticated.userId,
        currentPassword: body.currentPassword,
        password: body.password,
      });
    } catch (error) {
      throw mapAuthenticationError(error);
    }
  }

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
      this.writeSessionCookie(
        response,
        verified.sessionToken,
        verified.sessionExpiresAt,
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

  private writeSessionCookie(
    response: Response,
    sessionToken: string,
    sessionExpiresAt: Date,
  ): void {
    response.cookie(
      SESSION_COOKIE_NAME,
      sessionToken,
      buildSessionCookieOptions(this.config, sessionExpiresAt),
    );
  }
}

function mapEmailAddressError(error: unknown): Error {
  if (error instanceof InvalidEmailAddressError) {
    return new ApplicationError({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      statusCode: HttpStatus.BAD_REQUEST,
      details: ['email must be a valid email address'],
    });
  }

  return error instanceof Error ? error : new Error('Authentication failed');
}

function mapAuthenticationError(error: unknown): Error {
  if (error instanceof InvalidEmailAddressError) {
    return new ApplicationError({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      statusCode: HttpStatus.BAD_REQUEST,
      details: ['email must be a valid email address'],
    });
  }

  if (error instanceof InvalidEmailVerificationCodeError) {
    return new ApplicationError({
      code: 'INVALID_EMAIL_VERIFICATION_CODE',
      message: 'The email verification code is invalid or expired',
      statusCode: HttpStatus.UNAUTHORIZED,
    });
  }

  if (error instanceof InvalidPasswordCredentialsError) {
    return new ApplicationError({
      code: 'INVALID_PASSWORD_CREDENTIALS',
      message: 'Email or password is incorrect',
      statusCode: HttpStatus.UNAUTHORIZED,
    });
  }

  if (error instanceof InvalidPasswordError) {
    return new ApplicationError({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      statusCode: HttpStatus.BAD_REQUEST,
      details: ['password must contain between 8 and 128 characters'],
    });
  }

  return error instanceof Error ? error : new Error('Authentication failed');
}
