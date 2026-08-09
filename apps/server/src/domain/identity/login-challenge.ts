import type { EmailAddress } from './email-address.js';

const LOGIN_CHALLENGE_TTL_MS = 10 * 60 * 1_000;

export interface IssueLoginChallengeInput {
  id: string;
  email: EmailAddress;
  tokenHash: string;
  sourceDigest: string;
  issuedAt: Date;
}

export interface LoginChallengeSnapshot {
  id: string;
  email: string;
  tokenHash: string;
  sourceDigest: string;
  createdAt: Date;
  expiresAt: Date;
  attemptCount: number;
  consumedAt: Date | null;
}

export class LoginChallenge {
  private constructor(private readonly snapshot: LoginChallengeSnapshot) {}

  static issue(input: IssueLoginChallengeInput): LoginChallenge {
    const createdAt = new Date(input.issuedAt);

    return new LoginChallenge({
      id: input.id,
      email: input.email.value,
      tokenHash: input.tokenHash,
      sourceDigest: input.sourceDigest,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + LOGIN_CHALLENGE_TTL_MS),
      attemptCount: 0,
      consumedAt: null,
    });
  }

  isExpired(at: Date): boolean {
    return at.getTime() >= this.snapshot.expiresAt.getTime();
  }

  toSnapshot(): LoginChallengeSnapshot {
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
