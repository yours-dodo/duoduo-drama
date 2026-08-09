import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';

import {
  SERVER_CONFIG,
  type ServerConfig,
} from '../../config/server-config.js';
import { DatabaseModule } from '../../platform/database/database.module.js';
import {
  RequestEmailLogin,
  type LoginChallengeSecurity,
} from './application/request-email-login.js';
import { AuthController } from './http/auth.controller.js';
import { LocalEmailDelivery } from './infrastructure/local-email-delivery.js';
import { NodeLoginChallengeSecurity } from './infrastructure/node-login-challenge-security.js';
import { PrismaLoginChallengeRepository } from './infrastructure/prisma-login-challenge.repository.js';
import { EMAIL_DELIVERY, type EmailDelivery } from './ports/email-delivery.js';
import {
  LOGIN_CHALLENGE_REPOSITORY,
  type LoginChallengeRepository,
} from './ports/login-challenge-repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    PrismaLoginChallengeRepository,
    {
      provide: LOGIN_CHALLENGE_REPOSITORY,
      useExisting: PrismaLoginChallengeRepository,
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
      inject: [LOGIN_CHALLENGE_REPOSITORY, EMAIL_DELIVERY, SERVER_CONFIG],
      useFactory: (
        challenges: LoginChallengeRepository,
        emailDelivery: EmailDelivery,
        config: ServerConfig,
      ) => {
        const security: LoginChallengeSecurity = new NodeLoginChallengeSecurity(
          config.loginTokenPepper,
        );

        return new RequestEmailLogin(
          challenges,
          emailDelivery,
          security,
          { now: () => new Date() },
          { create: () => randomUUID() },
        );
      },
    },
  ],
  exports: [EMAIL_DELIVERY, RequestEmailLogin],
})
export class IdentityModule {}
