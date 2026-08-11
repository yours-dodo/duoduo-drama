import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import {
  SERVER_CONFIG,
  type ServerConfig,
} from '../../config/server-config.js';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { TransactionRunner } from '../../platform/database/transaction-runner.js';
import { CreateIdentitySession } from './application/create-identity-session.js';
import { LoginWithPassword } from './application/login-with-password.js';
import { Logout } from './application/logout.js';
import { RequestEmailCode } from './application/request-email-code.js';
import { RequestEmailLogin } from './application/request-email-login.js';
import { ResetPasswordWithCode } from './application/reset-password-with-code.js';
import { SetPassword } from './application/set-password.js';
import { VerifyEmailCodeLogin } from './application/verify-email-code-login.js';
import { VerifyEmailLogin } from './application/verify-email-login.js';
import { AuthController } from './http/auth.controller.js';
import { SessionAuthGuard } from './http/session-auth.guard.js';
import { TrustedOriginGuard } from './http/trusted-origin.guard.js';
import { ConsoleEmailCodeDelivery } from './infrastructure/console-email-code-delivery.js';
import { LocalEmailDelivery } from './infrastructure/local-email-delivery.js';
import { NodeEmailCodeSecurity } from './infrastructure/node-email-code-security.js';
import { NodeLoginChallengeSecurity } from './infrastructure/node-login-challenge-security.js';
import { NodePasswordSecurity } from './infrastructure/node-password-security.js';
import { PrismaEmailCodeRepository } from './infrastructure/prisma-email-code-repository.js';
import { PrismaIdentitySecurityEventRepository } from './infrastructure/prisma-identity-security-event.repository.js';
import { PrismaLoginChallengeRepository } from './infrastructure/prisma-login-challenge.repository.js';
import { PrismaPasswordCredentialRepository } from './infrastructure/prisma-password-credential-repository.js';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository.js';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository.js';
import { EMAIL_CODE_DELIVERY } from './ports/email-code-delivery.js';
import { EMAIL_CODE_REPOSITORY } from './ports/email-code-repository.js';
import { EMAIL_CODE_SECURITY } from './ports/email-code-security.js';
import { EMAIL_DELIVERY, type EmailDelivery } from './ports/email-delivery.js';
import {
  IDENTITY_SECURITY_EVENT_REPOSITORY,
  type IdentitySecurityEventRepository,
} from './ports/identity-security-event-repository.js';
import {
  IDENTITY_TOKEN_SECURITY,
  type IdentityTokenSecurity,
} from './ports/identity-token-security.js';
import {
  LOGIN_CHALLENGE_REPOSITORY,
  type LoginChallengeRepository,
} from './ports/login-challenge-repository.js';
import { PASSWORD_CREDENTIAL_REPOSITORY } from './ports/password-credential-repository.js';
import { PASSWORD_SECURITY } from './ports/password-security.js';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from './ports/session-repository.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from './ports/user-repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    PrismaLoginChallengeRepository,
    {
      provide: LOGIN_CHALLENGE_REPOSITORY,
      useExisting: PrismaLoginChallengeRepository,
    },
    PrismaEmailCodeRepository,
    {
      provide: EMAIL_CODE_REPOSITORY,
      useExisting: PrismaEmailCodeRepository,
    },
    PrismaUserRepository,
    { provide: USER_REPOSITORY, useExisting: PrismaUserRepository },
    PrismaPasswordCredentialRepository,
    {
      provide: PASSWORD_CREDENTIAL_REPOSITORY,
      useExisting: PrismaPasswordCredentialRepository,
    },
    PrismaSessionRepository,
    { provide: SESSION_REPOSITORY, useExisting: PrismaSessionRepository },
    PrismaIdentitySecurityEventRepository,
    {
      provide: IDENTITY_SECURITY_EVENT_REPOSITORY,
      useExisting: PrismaIdentitySecurityEventRepository,
    },
    {
      provide: NodeLoginChallengeSecurity,
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) =>
        new NodeLoginChallengeSecurity(config.loginTokenPepper),
    },
    {
      provide: IDENTITY_TOKEN_SECURITY,
      useExisting: NodeLoginChallengeSecurity,
    },
    {
      provide: NodeEmailCodeSecurity,
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) =>
        new NodeEmailCodeSecurity(config.loginTokenPepper),
    },
    {
      provide: EMAIL_CODE_SECURITY,
      useExisting: NodeEmailCodeSecurity,
    },
    {
      provide: LocalEmailDelivery,
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) =>
        new LocalEmailDelivery(config.environment, config.publicWebUrl),
    },
    { provide: EMAIL_DELIVERY, useExisting: LocalEmailDelivery },
    {
      provide: ConsoleEmailCodeDelivery,
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) =>
        new ConsoleEmailCodeDelivery(config.environment),
    },
    {
      provide: EMAIL_CODE_DELIVERY,
      useExisting: ConsoleEmailCodeDelivery,
    },
    NodePasswordSecurity,
    { provide: PASSWORD_SECURITY, useExisting: NodePasswordSecurity },
    {
      provide: RequestEmailLogin,
      inject: [
        LOGIN_CHALLENGE_REPOSITORY,
        EMAIL_DELIVERY,
        IDENTITY_TOKEN_SECURITY,
      ],
      useFactory: (
        challenges: LoginChallengeRepository,
        emailDelivery: EmailDelivery,
        security: IdentityTokenSecurity,
      ) =>
        new RequestEmailLogin(
          challenges,
          emailDelivery,
          security,
          { now: () => new Date() },
          { create: () => randomUUID() },
        ),
    },
    {
      provide: VerifyEmailLogin,
      inject: [
        LOGIN_CHALLENGE_REPOSITORY,
        USER_REPOSITORY,
        SESSION_REPOSITORY,
        IDENTITY_SECURITY_EVENT_REPOSITORY,
        IDENTITY_TOKEN_SECURITY,
        TransactionRunner,
      ],
      useFactory: (
        challenges: LoginChallengeRepository,
        users: UserRepository,
        sessions: SessionRepository,
        securityEvents: IdentitySecurityEventRepository,
        security: IdentityTokenSecurity,
        transactions: TransactionRunner,
      ) =>
        new VerifyEmailLogin(
          challenges,
          users,
          sessions,
          securityEvents,
          security,
          transactions,
          { create: () => randomUUID() },
        ),
    },
    CreateIdentitySession,
    RequestEmailCode,
    VerifyEmailCodeLogin,
    LoginWithPassword,
    SetPassword,
    ResetPasswordWithCode,
    {
      provide: Logout,
      inject: [
        SESSION_REPOSITORY,
        IDENTITY_SECURITY_EVENT_REPOSITORY,
        TransactionRunner,
      ],
      useFactory: (
        sessions: SessionRepository,
        securityEvents: IdentitySecurityEventRepository,
        transactions: TransactionRunner,
      ) =>
        new Logout(sessions, securityEvents, transactions, {
          create: () => randomUUID(),
        }),
    },
    SessionAuthGuard,
    TrustedOriginGuard,
    { provide: APP_GUARD, useExisting: TrustedOriginGuard },
  ],
  exports: [
    EMAIL_DELIVERY,
    EMAIL_CODE_DELIVERY,
    IDENTITY_TOKEN_SECURITY,
    RequestEmailLogin,
    SESSION_REPOSITORY,
    SessionAuthGuard,
  ],
})
export class IdentityModule {}
