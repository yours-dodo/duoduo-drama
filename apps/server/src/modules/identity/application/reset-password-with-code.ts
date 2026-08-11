import { Inject, Injectable } from '@nestjs/common';

import { EmailAddress } from '../../../domain/identity/email-address.js';
import { TransactionRunner } from '../../../platform/database/transaction-runner.js';
import { CreateIdentitySession } from './create-identity-session.js';
import {
  InvalidEmailVerificationCodeError,
  assertPasswordPolicy,
} from './password-errors.js';
import {
  EMAIL_CODE_REPOSITORY,
  type EmailCodeRepository,
} from '../ports/email-code-repository.js';
import {
  EMAIL_CODE_SECURITY,
  type EmailCodeSecurity,
} from '../ports/email-code-security.js';
import {
  PASSWORD_CREDENTIAL_REPOSITORY,
  type PasswordCredentialRepository,
} from '../ports/password-credential-repository.js';
import {
  PASSWORD_SECURITY,
  type PasswordSecurity,
} from '../ports/password-security.js';

const MAXIMUM_CODE_ATTEMPTS = 5;

@Injectable()
export class ResetPasswordWithCode {
  constructor(
    @Inject(EMAIL_CODE_REPOSITORY)
    private readonly codes: EmailCodeRepository,
    @Inject(EMAIL_CODE_SECURITY)
    private readonly codeSecurity: EmailCodeSecurity,
    @Inject(PASSWORD_CREDENTIAL_REPOSITORY)
    private readonly credentials: PasswordCredentialRepository,
    @Inject(PASSWORD_SECURITY)
    private readonly passwordSecurity: PasswordSecurity,
    private readonly sessions: CreateIdentitySession,
    private readonly transactions: TransactionRunner,
  ) {}

  async execute(input: {
    email: string;
    code: string;
    password: string;
  }): Promise<{
    user: { id: string; email: string };
    sessionToken: string;
    sessionExpiresAt: Date;
    hasPassword: true;
  }> {
    const email = EmailAddress.parse(input.email);
    assertPasswordPolicy(input.password);

    const result = await this.transactions.run(async () => {
      const consumed = await this.codes.consumeForVerification({
        email: email.value,
        purpose: 'password_reset',
        codeHash: this.codeSecurity.hashCode(
          email.value,
          'password_reset',
          input.code,
        ),
        maximumAttempts: MAXIMUM_CODE_ATTEMPTS,
      });
      if (consumed.status !== 'verified') {
        throw new InvalidEmailVerificationCodeError();
      }

      const credential = await this.credentials.findByEmail(email.value);
      if (credential === null) {
        throw new InvalidEmailVerificationCodeError();
      }

      const passwordHash = await this.passwordSecurity.hashPassword(
        input.password,
      );
      await this.credentials.setPasswordHash(credential.userId, passwordHash);
      const session = await this.sessions.execute({
        userId: credential.userId,
        email: credential.email,
        issuedAt: consumed.consumedAt,
      });

      return {
        user: { id: credential.userId, email: credential.email },
        ...session,
        hasPassword: true as const,
      };
    });

    return result;
  }
}
