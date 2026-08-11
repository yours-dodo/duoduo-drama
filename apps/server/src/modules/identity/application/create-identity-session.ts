import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { Session } from '../../../domain/identity/session.js';
import {
  IDENTITY_TOKEN_SECURITY,
  type IdentityTokenSecurity,
} from '../ports/identity-token-security.js';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from '../ports/session-repository.js';

@Injectable()
export class CreateIdentitySession {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(IDENTITY_TOKEN_SECURITY)
    private readonly security: Pick<
      IdentityTokenSecurity,
      'issueSessionToken' | 'hashSessionToken'
    >,
  ) {}

  async execute(input: {
    userId: string;
    email: string;
    issuedAt: Date;
  }): Promise<{
    sessionToken: string;
    sessionExpiresAt: Date;
  }> {
    const sessionToken = this.security.issueSessionToken();
    const session = Session.issue({
      id: randomUUID(),
      userId: input.userId,
      tokenHash: this.security.hashSessionToken(sessionToken),
      issuedAt: input.issuedAt,
    }).toSnapshot();

    await this.sessions.create(session);

    return {
      sessionToken,
      sessionExpiresAt: session.expiresAt,
    };
  }
}
