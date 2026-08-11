import { Inject, Injectable } from '@nestjs/common';

import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { DatabaseClient } from '../../../platform/database/prisma.service.js';
import { TransactionRunner } from '../../../platform/database/transaction-runner.js';
import type { EmailVerificationCodeSnapshot } from '../../../domain/identity/email-verification-code.js';
import type {
  ConsumeEmailCodeRequest,
  ConsumeEmailCodeResult,
  CreateEmailCodeRequest,
  CreateEmailCodeResult,
  EmailCodeRepository,
} from '../ports/email-code-repository.js';

@Injectable()
export class PrismaEmailCodeRepository implements EmailCodeRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
    @Inject(TransactionRunner) private readonly transactions: TransactionRunner,
  ) {}

  createIfAllowed(
    request: CreateEmailCodeRequest,
  ): Promise<CreateEmailCodeResult> {
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

        const emailCount = await client.emailVerificationCode.count({
          where: {
            email: request.code.email,
            purpose: request.code.purpose,
            createdAt: { gte: emailWindowStart },
          },
        });
        if (emailCount >= request.limits.email.maximum) {
          return { created: false };
        }

        const sourceCount = await client.emailVerificationCode.count({
          where: {
            sourceDigest: request.code.sourceDigest,
            purpose: request.code.purpose,
            createdAt: { gte: sourceWindowStart },
          },
        });
        if (sourceCount >= request.limits.source.maximum) {
          return { created: false };
        }

        const lifetimeMs =
          request.code.expiresAt.getTime() - request.code.createdAt.getTime();
        const persistedCode = {
          ...request.code,
          createdAt: databaseNow,
          expiresAt: new Date(databaseNow.getTime() + lifetimeMs),
        };
        const created = await client.emailVerificationCode.create({
          data: persistedCode,
        });
        const code: EmailVerificationCodeSnapshot = {
          ...created,
          purpose: request.code.purpose,
        };
        return { created: true, code };
      }),
    );
  }

  consumeForVerification(
    request: ConsumeEmailCodeRequest,
  ): Promise<ConsumeEmailCodeResult> {
    return this.database.withClient(async (client) => {
      const [challenge] = await client.$queryRaw<
        Array<{
          id: string;
          email: string;
          codeHash: string;
          expiresAt: Date;
          attemptCount: number;
          databaseNow: Date;
        }>
      >`
        SELECT
          id,
          email,
          code_hash AS "codeHash",
          expires_at AS "expiresAt",
          attempt_count AS "attemptCount",
          clock_timestamp() AS "databaseNow"
        FROM email_verification_codes
        WHERE email = ${request.email}
          AND purpose = ${request.purpose}
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `;

      if (!challenge) {
        return { status: 'invalid' };
      }

      const databaseNow = new Date(challenge.databaseNow);
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
        await client.emailVerificationCode.update({
          where: { id: challenge.id },
          data: { attemptCount },
        });

        return attemptCount >= request.maximumAttempts
          ? {
              status: 'locked',
              challengeId: challenge.id,
              occurredAt: databaseNow,
              newlyLocked: true,
            }
          : { status: 'expired' };
      }

      if (challenge.codeHash !== request.codeHash) {
        const attemptCount = challenge.attemptCount + 1;
        await client.emailVerificationCode.update({
          where: { id: challenge.id },
          data: { attemptCount },
        });

        return attemptCount >= request.maximumAttempts
          ? {
              status: 'locked',
              challengeId: challenge.id,
              occurredAt: databaseNow,
              newlyLocked: true,
            }
          : { status: 'invalid' };
      }

      await client.emailVerificationCode.update({
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
  request: CreateEmailCodeRequest,
): Promise<void> {
  const lockKeys = [
    `email:${request.code.purpose}:${request.code.email}`,
    `source:${request.code.purpose}:${request.code.sourceDigest}`,
  ].sort();

  for (const lockKey of lockKeys) {
    await client.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;
  }
}
