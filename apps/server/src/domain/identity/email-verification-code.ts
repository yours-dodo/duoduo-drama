import type { EmailAddress } from './email-address.js';

export type EmailCodePurpose = 'login' | 'password_reset';

const EMAIL_CODE_TTL_MS = 10 * 60 * 1_000;

export interface IssueEmailVerificationCodeInput {
  id: string;
  email: EmailAddress;
  purpose: EmailCodePurpose;
  codeHash: string;
  sourceDigest: string;
  issuedAt: Date;
}

export interface EmailVerificationCodeSnapshot {
  id: string;
  email: string;
  purpose: EmailCodePurpose;
  codeHash: string;
  sourceDigest: string;
  createdAt: Date;
  expiresAt: Date;
  attemptCount: number;
  consumedAt: Date | null;
}

export class EmailVerificationCode {
  private constructor(
    private readonly snapshot: EmailVerificationCodeSnapshot,
  ) {}

  static issue(input: IssueEmailVerificationCodeInput): EmailVerificationCode {
    const createdAt = new Date(input.issuedAt);

    return new EmailVerificationCode({
      id: input.id,
      email: input.email.value,
      purpose: input.purpose,
      codeHash: input.codeHash,
      sourceDigest: input.sourceDigest,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + EMAIL_CODE_TTL_MS),
      attemptCount: 0,
      consumedAt: null,
    });
  }

  toSnapshot(): EmailVerificationCodeSnapshot {
    return {
      ...this.snapshot,
      createdAt: new Date(this.snapshot.createdAt),
      expiresAt: new Date(this.snapshot.expiresAt),
      consumedAt:
        this.snapshot.consumedAt === null
          ? null
          : new Date(this.snapshot.consumedAt),
    };
  }
}
