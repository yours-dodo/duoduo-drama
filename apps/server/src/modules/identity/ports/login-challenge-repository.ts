import type { LoginChallengeSnapshot } from '../../../domain/identity/login-challenge.js';

export const LOGIN_CHALLENGE_REPOSITORY = Symbol('LOGIN_CHALLENGE_REPOSITORY');

export interface LoginRateLimit {
  maximum: number;
  windowMs: number;
}

export interface CreateLoginChallengeRequest {
  challenge: LoginChallengeSnapshot;
  limits: {
    email: LoginRateLimit;
    source: LoginRateLimit;
  };
}

export type CreateLoginChallengeResult =
  { created: false } | { created: true; challenge: LoginChallengeSnapshot };

export interface ConsumeLoginChallengeRequest {
  tokenHash: string;
  maximumAttempts: number;
}

export type ConsumeLoginChallengeResult =
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

export interface LoginChallengeRepository {
  createIfAllowed(
    request: CreateLoginChallengeRequest,
  ): Promise<CreateLoginChallengeResult>;

  findActiveByTokenHash(
    tokenHash: string,
    at: Date,
  ): Promise<LoginChallengeSnapshot | null>;

  consumeForVerification(
    request: ConsumeLoginChallengeRequest,
  ): Promise<ConsumeLoginChallengeResult>;
}
