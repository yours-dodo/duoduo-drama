import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { EmailAddress } from '../../../domain/identity/email-address.js';
import { TransactionRunner } from '../../../platform/database/transaction-runner.js';
import { CreateIdentitySession } from './create-identity-session.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../ports/user-repository.js';

@Injectable()
export class DevelopmentLogin {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly sessions: CreateIdentitySession,
    private readonly transactions: TransactionRunner,
  ) {}

  execute(input: { email: string }): Promise<{
    user: { id: string; email: string };
    sessionToken: string;
    sessionExpiresAt: Date;
    hasPassword: true;
  }> {
    const email = EmailAddress.parse(input.email);

    return this.transactions.run(async () => {
      const user = await this.users.findOrCreateByEmail({
        email: email.value,
        newUserId: randomUUID(),
      });
      const session = await this.sessions.execute({
        userId: user.id,
        email: user.email,
        issuedAt: new Date(),
      });

      return {
        user: { id: user.id, email: user.email },
        ...session,
        hasPassword: true,
      };
    });
  }
}
