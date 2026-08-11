import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { EmailAddress } from '../../../domain/identity/email-address.js';
import {
  EmailVerificationCode,
  type EmailCodePurpose,
} from '../../../domain/identity/email-verification-code.js';
import { DatabaseClock } from '../../../platform/database/database-clock.js';
import {
  EMAIL_CODE_DELIVERY,
  type EmailCodeDelivery,
} from '../ports/email-code-delivery.js';
import {
  EMAIL_CODE_REPOSITORY,
  type EmailCodeRepository,
} from '../ports/email-code-repository.js';
import {
  EMAIL_CODE_SECURITY,
  type EmailCodeSecurity,
} from '../ports/email-code-security.js';

const EMAIL_RATE_LIMIT = 5;
const SOURCE_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;

@Injectable()
export class RequestEmailCode {
  constructor(
    @Inject(EMAIL_CODE_REPOSITORY)
    private readonly codes: EmailCodeRepository,
    @Inject(EMAIL_CODE_DELIVERY)
    private readonly delivery: EmailCodeDelivery,
    @Inject(EMAIL_CODE_SECURITY)
    private readonly security: EmailCodeSecurity,
    @Inject(DatabaseClock)
    private readonly clock: Pick<DatabaseClock, 'now'>,
  ) {}

  async execute(input: {
    email: string;
    sourceAddress: string;
    purpose: EmailCodePurpose;
  }): Promise<{
    message: 'If the address can receive email, a verification code was sent.';
  }> {
    const email = EmailAddress.parse(input.email);
    const code = this.security.issueCode();
    const issuedAt = await this.clock.now();
    const snapshot = EmailVerificationCode.issue({
      id: randomUUID(),
      email,
      purpose: input.purpose,
      codeHash: this.security.hashCode(email.value, input.purpose, code),
      sourceDigest: this.security.digestSource(input.sourceAddress),
      issuedAt,
    }).toSnapshot();

    const result = await this.codes.createIfAllowed({
      code: snapshot,
      limits: {
        email: { maximum: EMAIL_RATE_LIMIT, windowMs: RATE_LIMIT_WINDOW_MS },
        source: { maximum: SOURCE_RATE_LIMIT, windowMs: RATE_LIMIT_WINDOW_MS },
      },
    });

    if (result.created) {
      await this.delivery.deliver({
        email: snapshot.email,
        code,
        purpose: snapshot.purpose,
        expiresAt: result.code.expiresAt,
      });
    }

    return {
      message:
        'If the address can receive email, a verification code was sent.',
    };
  }
}
