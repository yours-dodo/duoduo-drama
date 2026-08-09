import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import {
  SERVER_CONFIG,
  type ServerConfig,
} from '../../config/server-config.js';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { TransactionRunner } from '../../platform/database/transaction-runner.js';
import { Logout } from './application/logout.js';
import { RequestEmailLogin } from './application/request-email-login.js';
import { VerifyEmailLogin } from './application/verify-email-login.js';
import { AuthController } from './http/auth.controller.js';
import { SessionAuthGuard } from './http/session-auth.guard.js';
import { TrustedOriginGuard } from './http/trusted-origin.guard.js';
import { LocalEmailDelivery } from './infrastructure/local-email-delivery.js';
import { NodeLoginChallengeSecurity } from './infrastructure/node-login-challenge-security.js';
import { PrismaIdentitySecurityEventRepository } from './infrastructure/prisma-identity-security-event.repository.js';
import { PrismaLoginChallengeRepository } from './infrastructure/prisma-login-challenge.repository.js';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository.js';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository.js';
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
    PrismaUserRepository,
    { provide: USER_REPOSITORY, useExisting: PrismaUserRepository },
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
      provide: LocalEmailDelivery,
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) =>
        new LocalEmailDelivery(config.environment, config.publicWebUrl),
    },
    { provide: EMAIL_DELIVERY, useExisting: LocalEmailDelivery },
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
    IDENTITY_TOKEN_SECURITY,
    RequestEmailLogin,
    SESSION_REPOSITORY,
    SessionAuthGuard,
  ],
})
export class IdentityModule {}
