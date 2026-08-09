import type { IdentitySecurityEventRepository } from '../ports/identity-security-event-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { TransactionBoundary } from './verify-email-login.js';

export interface LogoutInput {
  sessionId: string;
  requestId: string;
}

export class Logout {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly securityEvents: IdentitySecurityEventRepository,
    private readonly transactions: TransactionBoundary,
    private readonly ids: { create(): string },
  ) {}

  async execute(input: LogoutInput): Promise<void> {
    await this.transactions.run(async () => {
      const revoked = await this.sessions.revoke(input.sessionId);
      if (revoked === null) {
        return;
      }

      await this.securityEvents.record({
        id: this.ids.create(),
        userId: revoked.userId,
        sessionId: revoked.id,
        action: 'SESSION_REVOKED',
        targetId: revoked.id,
        requestId: input.requestId,
        occurredAt: revoked.revokedAt,
      });
    });
  }
}
