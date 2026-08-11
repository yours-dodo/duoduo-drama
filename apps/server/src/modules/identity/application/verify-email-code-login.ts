import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { EmailAddress } from '../../../domain/identity/email-address.js';
import {
  EMAIL_CODE_REPOSITORY,
  type EmailCodeRepository,
} from '../ports/email-code-repository.js';
import {
  EMAIL_CODE_SECURITY,
  type EmailCodeSecurity,
} from '../ports/email-code-security.js';
import {
  IDENTITY_SECURITY_EVENT_REPOSITORY,
  type IdentitySecurityEventRepository,
} from '../ports/identity-security-event-repository.js';
import {
  PASSWORD_CREDENTIAL_REPOSITORY,
  type PasswordCredentialRepository,
} from '../ports/password-credential-repository.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../ports/user-repository.js';
import { TransactionRunner } from '../../../platform/database/transaction-runner.js';
import { CreateIdentitySession } from './create-identity-session.js';
import { InvalidEmailVerificationCodeError } from './password-errors.js';

const MAXIMUM_CODE_ATTEMPTS = 5;

@Injectable()
export class VerifyEmailCodeLogin {
  constructor(
    @Inject(EMAIL_CODE_REPOSITORY)
    private readonly codes: EmailCodeRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_CREDENTIAL_REPOSITORY)
    private readonly credentials: PasswordCredentialRepository,
    @Inject(IDENTITY_SECURITY_EVENT_REPOSITORY)
    private readonly securityEvents: IdentitySecurityEventRepository,
    @Inject(EMAIL_CODE_SECURITY)
    private readonly security: EmailCodeSecurity,
    private readonly sessions: CreateIdentitySession,
    private readonly transactions: TransactionRunner,
  ) {}

  async execute(input: {
    email: string;
    code: string;
    requestId: string;
  }): Promise<{
    user: { id: string; email: string };
    sessionToken: string;
    sessionExpiresAt: Date;
    hasPassword: boolean;
  }> {
    const email = EmailAddress.parse(input.email);
    const outcome = await this.transactions.run(async () => {
      const consumed = await this.codes.consumeForVerification({
        email: email.value,
        purpose: 'login',
        codeHash: this.security.hashCode(email.value, 'login', input.code),
        maximumAttempts: MAXIMUM_CODE_ATTEMPTS,
      });

      if (consumed.status !== 'verified') {
        if (consumed.status === 'locked' && consumed.newlyLocked) {
          await this.securityEvents.record({
            id: randomUUID(),
            userId: null,
            sessionId: null,
            action: 'EMAIL_LOGIN_CODE_LOCKED',
            targetId: consumed.challengeId,
            requestId: input.requestId,
            occurredAt: consumed.occurredAt,
          });
        }
        return null;
      }

      const user = await this.users.findOrCreateByEmail({
        email: consumed.email,
        newUserId: randomUUID(),
      });
      const credential = await this.credentials.findByUserId(user.id);
      const session = await this.sessions.execute({
        userId: user.id,
        email: user.email,
        issuedAt: consumed.consumedAt,
      });

      return {
        user: { id: user.id, email: user.email },
        ...session,
        hasPassword: credential !== null && credential.passwordHash !== null,
      };
    });

    if (outcome === null) {
      throw new InvalidEmailVerificationCodeError();
    }

    return outcome;
  }
}
