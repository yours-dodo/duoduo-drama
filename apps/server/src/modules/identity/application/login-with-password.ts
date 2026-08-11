import { Inject, Injectable } from '@nestjs/common';

import { EmailAddress } from '../../../domain/identity/email-address.js';
import { TransactionRunner } from '../../../platform/database/transaction-runner.js';
import { CreateIdentitySession } from './create-identity-session.js';
import {
  InvalidPasswordCredentialsError,
  assertPasswordPolicy,
} from './password-errors.js';
import {
  PASSWORD_CREDENTIAL_REPOSITORY,
  type PasswordCredentialRepository,
} from '../ports/password-credential-repository.js';
import {
  PASSWORD_SECURITY,
  type PasswordSecurity,
} from '../ports/password-security.js';

@Injectable()
export class LoginWithPassword {
  constructor(
    @Inject(PASSWORD_CREDENTIAL_REPOSITORY)
    private readonly credentials: PasswordCredentialRepository,
    @Inject(PASSWORD_SECURITY) private readonly security: PasswordSecurity,
    private readonly sessions: CreateIdentitySession,
    private readonly transactions: TransactionRunner,
  ) {}

  async execute(input: { email: string; password: string }): Promise<{
    user: { id: string; email: string };
    sessionToken: string;
    sessionExpiresAt: Date;
    hasPassword: true;
  }> {
    const email = EmailAddress.parse(input.email);
    assertPasswordPolicy(input.password);
    const credential = await this.credentials.findByEmail(email.value);
    const valid =
      credential !== null &&
      credential.passwordHash !== null &&
      (await this.security.verifyPassword(
        input.password,
        credential.passwordHash,
      ));

    if (!valid || credential === null) {
      throw new InvalidPasswordCredentialsError();
    }

    const session = await this.transactions.run(() =>
      this.sessions.execute({
        userId: credential.userId,
        email: credential.email,
        issuedAt: new Date(),
      }),
    );

    return {
      user: { id: credential.userId, email: credential.email },
      ...session,
      hasPassword: true,
    };
  }
}
