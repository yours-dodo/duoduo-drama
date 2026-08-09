import { Session } from '../../../domain/identity/session.js';
import type { IdentitySecurityEventRepository } from '../ports/identity-security-event-repository.js';
import type { IdentityTokenSecurity } from '../ports/identity-token-security.js';
import type { LoginChallengeRepository } from '../ports/login-challenge-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { UserRepository } from '../ports/user-repository.js';

const MAXIMUM_LOGIN_ATTEMPTS = 5;

export interface TransactionBoundary {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface VerifyEmailLoginInput {
  token: string;
  requestId: string;
}

export interface VerifyEmailLoginOutput {
  user: { id: string; email: string };
  sessionToken: string;
  sessionExpiresAt: Date;
}

type VerificationOutcome =
  { verified: false } | { verified: true; output: VerifyEmailLoginOutput };

export class InvalidLoginChallengeError extends Error {
  constructor() {
    super('Login challenge is invalid or expired');
    this.name = 'InvalidLoginChallengeError';
  }
}

export class VerifyEmailLogin {
  constructor(
    private readonly challenges: LoginChallengeRepository,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly securityEvents: IdentitySecurityEventRepository,
    private readonly security: Pick<
      IdentityTokenSecurity,
      'issueSessionToken' | 'hashLoginToken' | 'hashSessionToken'
    >,
    private readonly transactions: TransactionBoundary,
    private readonly ids: { create(): string },
  ) {}

  async execute(input: VerifyEmailLoginInput): Promise<VerifyEmailLoginOutput> {
    const outcome = await this.transactions.run<VerificationOutcome>(
      async () => {
        const challenge = await this.challenges.consumeForVerification({
          tokenHash: this.security.hashLoginToken(input.token),
          maximumAttempts: MAXIMUM_LOGIN_ATTEMPTS,
        });

        if (challenge.status !== 'verified') {
          if (challenge.status === 'locked' && challenge.newlyLocked) {
            await this.securityEvents.record({
              id: this.ids.create(),
              userId: null,
              sessionId: null,
              action: 'LOGIN_CHALLENGE_LOCKED',
              targetId: challenge.challengeId,
              requestId: input.requestId,
              occurredAt: challenge.occurredAt,
            });
          }

          return { verified: false };
        }

        const user = await this.users.findOrCreateByEmail({
          email: challenge.email,
          newUserId: this.ids.create(),
        });
        const sessionToken = this.security.issueSessionToken();
        const session = Session.issue({
          id: this.ids.create(),
          userId: user.id,
          tokenHash: this.security.hashSessionToken(sessionToken),
          issuedAt: challenge.consumedAt,
        }).toSnapshot();

        await this.sessions.create(session);

        return {
          verified: true,
          output: {
            user: { id: user.id, email: user.email },
            sessionToken,
            sessionExpiresAt: session.expiresAt,
          },
        };
      },
    );

    if (!outcome.verified) {
      throw new InvalidLoginChallengeError();
    }

    return outcome.output;
  }
}
