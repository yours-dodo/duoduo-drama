import { createHmac, randomBytes } from 'node:crypto';

import type { IdentityTokenSecurity } from '../ports/identity-token-security.js';

export class NodeLoginChallengeSecurity implements IdentityTokenSecurity {
  constructor(private readonly pepper: string) {}

  issueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    return this.digest('login-token', token);
  }

  issueSessionToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashLoginToken(token: string): string {
    return this.hashToken(token);
  }

  hashSessionToken(token: string): string {
    return this.digest('session-token', token);
  }

  digestSource(sourceAddress: string): string {
    return this.digest('login-source', sourceAddress.trim());
  }

  private digest(purpose: string, value: string): string {
    return createHmac('sha256', this.pepper)
      .update(purpose)
      .update('\0')
      .update(value)
      .digest('hex');
  }
}
