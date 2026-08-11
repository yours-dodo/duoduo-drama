import type {
  EmailCodePurpose,
  EmailVerificationCodeSnapshot,
} from '../../../domain/identity/email-verification-code.js';

export const EMAIL_CODE_REPOSITORY = Symbol('EMAIL_CODE_REPOSITORY');

export interface EmailCodeRateLimit {
  maximum: number;
  windowMs: number;
}

export interface CreateEmailCodeRequest {
  code: EmailVerificationCodeSnapshot;
  limits: {
    email: EmailCodeRateLimit;
    source: EmailCodeRateLimit;
  };
}

export type CreateEmailCodeResult =
  { created: false } | { created: true; code: EmailVerificationCodeSnapshot };

export interface ConsumeEmailCodeRequest {
  email: string;
  purpose: EmailCodePurpose;
  codeHash: string;
  maximumAttempts: number;
}

export type ConsumeEmailCodeResult =
  | { status: 'invalid' | 'expired' | 'consumed' }
  | {
      status: 'locked';
      challengeId: string;
      occurredAt: Date;
      newlyLocked: boolean;
    }
  | {
      status: 'verified';
      challengeId: string;
      email: string;
      consumedAt: Date;
    };

export interface EmailCodeRepository {
  createIfAllowed(
    request: CreateEmailCodeRequest,
  ): Promise<CreateEmailCodeResult>;
  consumeForVerification(
    request: ConsumeEmailCodeRequest,
  ): Promise<ConsumeEmailCodeResult>;
}
