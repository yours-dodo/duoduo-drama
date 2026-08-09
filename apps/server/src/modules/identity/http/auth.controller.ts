import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';

import { InvalidEmailAddressError } from '../../../domain/identity/email-address.js';
import { ApplicationError } from '../../../platform/http/application-error.js';
import {
  RequestEmailLogin,
  type RequestEmailLoginOutput,
} from '../application/request-email-login.js';
import { RequestEmailLoginDto } from './request-email-login.dto.js';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    @Inject(RequestEmailLogin)
    private readonly requestEmailLogin: RequestEmailLogin,
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
}
