import { Inject, Injectable } from '@nestjs/common';

import { TransactionRunner } from '../../../platform/database/transaction-runner.js';
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
export class SetPassword {
  constructor(
    @Inject(PASSWORD_CREDENTIAL_REPOSITORY)
    private readonly credentials: PasswordCredentialRepository,
    @Inject(PASSWORD_SECURITY) private readonly security: PasswordSecurity,
    private readonly transactions: TransactionRunner,
  ) {}

  async execute(input: {
    userId: string;
    currentPassword?: string;
    password: string;
  }): Promise<{ hasPassword: true }> {
    assertPasswordPolicy(input.password);

    await this.transactions.run(async () => {
      const credential = await this.credentials.findByUserId(input.userId);
      if (credential === null) {
        throw new InvalidPasswordCredentialsError();
      }

      if (credential.passwordHash !== null) {
        if (
          input.currentPassword === undefined ||
          !(await this.security.verifyPassword(
            input.currentPassword,
            credential.passwordHash,
          ))
        ) {
          throw new InvalidPasswordCredentialsError();
        }
      }

      const passwordHash = await this.security.hashPassword(input.password);
      await this.credentials.setPasswordHash(input.userId, passwordHash);
    });

    return { hasPassword: true };
  }
}
