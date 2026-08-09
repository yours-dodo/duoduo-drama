import { EmailAddress } from '../../../domain/identity/email-address.js';
import { LoginChallenge } from '../../../domain/identity/login-challenge.js';
import type { EmailDelivery } from '../ports/email-delivery.js';
import type { IdentityTokenSecurity } from '../ports/identity-token-security.js';
import type { LoginChallengeRepository } from '../ports/login-challenge-repository.js';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const EMAIL_RATE_LIMIT = 5;
const SOURCE_RATE_LIMIT = 20;

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  create(): string;
}

export interface RequestEmailLoginInput {
  email: string;
  sourceAddress: string;
}

export interface RequestEmailLoginOutput {
  message: 'If the address can receive email, sign-in instructions were sent.';
}

export class RequestEmailLogin {
  constructor(
    private readonly challenges: LoginChallengeRepository,
    private readonly emailDelivery: EmailDelivery,
    private readonly security: Pick<
      IdentityTokenSecurity,
      'issueToken' | 'hashToken' | 'digestSource'
    >,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    input: RequestEmailLoginInput,
  ): Promise<RequestEmailLoginOutput> {
    const email = EmailAddress.parse(input.email);
    const issuedAt = this.clock.now();
    const token = this.security.issueToken();
    const challenge = LoginChallenge.issue({
      id: this.ids.create(),
      email,
      tokenHash: this.security.hashToken(token),
      sourceDigest: this.security.digestSource(input.sourceAddress),
      issuedAt,
    });
    const snapshot = challenge.toSnapshot();
    const result = await this.challenges.createIfAllowed({
      challenge: snapshot,
      limits: {
        email: { maximum: EMAIL_RATE_LIMIT, windowMs: RATE_LIMIT_WINDOW_MS },
        source: { maximum: SOURCE_RATE_LIMIT, windowMs: RATE_LIMIT_WINDOW_MS },
      },
    });

    if (result.created) {
      await this.emailDelivery.deliver({
        email: snapshot.email,
        token,
        expiresAt: result.challenge.expiresAt,
      });
    }

    return {
      message:
        'If the address can receive email, sign-in instructions were sent.',
    };
  }
}
