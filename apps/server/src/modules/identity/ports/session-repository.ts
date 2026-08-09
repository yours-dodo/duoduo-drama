import type { SessionSnapshot } from '../../../domain/identity/session.js';

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

export interface AuthenticatedSessionSnapshot {
  id: string;
  userId: string;
  email: string;
  expiresAt: Date;
}

export interface RevokedSessionSnapshot {
  id: string;
  userId: string;
  revokedAt: Date;
}

export interface SessionRepository {
  create(session: SessionSnapshot): Promise<SessionSnapshot>;
  findActiveByTokenHash(
    tokenHash: string,
  ): Promise<AuthenticatedSessionSnapshot | null>;
  revoke(sessionId: string): Promise<RevokedSessionSnapshot | null>;
}
