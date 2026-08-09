import { Inject, Injectable } from '@nestjs/common';

import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { DatabaseClient } from '../../../platform/database/prisma.service.js';
import { TransactionRunner } from '../../../platform/database/transaction-runner.js';
import type {
  ConsumeLoginChallengeRequest,
  ConsumeLoginChallengeResult,
  CreateLoginChallengeRequest,
  CreateLoginChallengeResult,
  LoginChallengeRepository,
} from '../ports/login-challenge-repository.js';
import type { LoginChallengeSnapshot } from '../../../domain/identity/login-challenge.js';

@Injectable()
export class PrismaLoginChallengeRepository implements LoginChallengeRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
    @Inject(TransactionRunner) private readonly transactions: TransactionRunner,
  ) {}

  createIfAllowed(
    request: CreateLoginChallengeRequest,
  ): Promise<CreateLoginChallengeResult> {
    return this.transactions.run(() =>
      this.database.withClient(async (client) => {
        await acquireRateLimitLocks(client, request);
        const [clock] = await client.$queryRaw<
          Array<{ databaseNow: Date }>
        >`SELECT clock_timestamp() AS "databaseNow"`;
        if (!clock) {
          throw new Error('Database clock query returned no rows');
        }

        const databaseNow = new Date(clock.databaseNow);
        const emailWindowStart = new Date(
          databaseNow.getTime() - request.limits.email.windowMs,
        );
        const sourceWindowStart = new Date(
          databaseNow.getTime() - request.limits.source.windowMs,
        );

        const emailCount = await client.emailLoginChallenge.count({
          where: {
            email: request.challenge.email,
            createdAt: { gte: emailWindowStart },
          },
        });
        if (emailCount >= request.limits.email.maximum) {
          return { created: false };
        }

        const sourceCount = await client.emailLoginChallenge.count({
          where: {
            sourceDigest: request.challenge.sourceDigest,
            createdAt: { gte: sourceWindowStart },
          },
        });
        if (sourceCount >= request.limits.source.maximum) {
          return { created: false };
        }

        const lifetimeMs =
          request.challenge.expiresAt.getTime() -
          request.challenge.createdAt.getTime();
        const persistedChallenge = {
          ...request.challenge,
          createdAt: databaseNow,
          expiresAt: new Date(databaseNow.getTime() + lifetimeMs),
        };
        const created = await client.emailLoginChallenge.create({
          data: persistedChallenge,
        });
        return { created: true, challenge: created };
      }),
    );
  }

  async findActiveByTokenHash(
    tokenHash: string,
    at: Date,
  ): Promise<LoginChallengeSnapshot | null> {
    return this.database.withClient(async (client) => {
      const challenge = await client.emailLoginChallenge.findFirst({
        where: {
          tokenHash,
          consumedAt: null,
          expiresAt: { gt: at },
        },
      });

      return challenge === null ? null : challenge;
    });
  }

  consumeForVerification(
    request: ConsumeLoginChallengeRequest,
  ): Promise<ConsumeLoginChallengeResult> {
    return this.database.withClient(async (client) => {
      const [challenge] = await client.$queryRaw<
        Array<{
          id: string;
          email: string;
          expiresAt: Date;
          attemptCount: number;
          consumedAt: Date | null;
          databaseNow: Date;
        }>
      >`
        SELECT
          id,
          email,
          expires_at AS "expiresAt",
          attempt_count AS "attemptCount",
          consumed_at AS "consumedAt",
          clock_timestamp() AS "databaseNow"
        FROM email_login_challenges
        WHERE token_hash = ${request.tokenHash}
        FOR UPDATE
      `;

      if (!challenge) {
        return { status: 'invalid' };
      }

      const databaseNow = new Date(challenge.databaseNow);
      if (challenge.consumedAt !== null) {
        return { status: 'consumed' };
      }

      if (challenge.attemptCount >= request.maximumAttempts) {
        return {
          status: 'locked',
          challengeId: challenge.id,
          occurredAt: databaseNow,
          newlyLocked: false,
        };
      }

      if (challenge.expiresAt.getTime() <= databaseNow.getTime()) {
        const attemptCount = challenge.attemptCount + 1;
        await client.emailLoginChallenge.update({
          where: { id: challenge.id },
          data: { attemptCount },
        });

        if (attemptCount >= request.maximumAttempts) {
          return {
            status: 'locked',
            challengeId: challenge.id,
            occurredAt: databaseNow,
            newlyLocked: true,
          };
        }

        return { status: 'expired' };
      }

      await client.emailLoginChallenge.update({
        where: { id: challenge.id },
        data: {
          attemptCount: { increment: 1 },
          consumedAt: databaseNow,
        },
      });

      return {
        status: 'verified',
        challengeId: challenge.id,
        email: challenge.email,
        consumedAt: databaseNow,
      };
    });
  }
}

async function acquireRateLimitLocks(
  client: DatabaseClient,
  request: CreateLoginChallengeRequest,
): Promise<void> {
  const lockKeys = [
    `email:${request.challenge.email}`,
    `source:${request.challenge.sourceDigest}`,
  ].sort();

  for (const lockKey of lockKeys) {
    await client.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;
  }
}
