export const IDENTITY_SECURITY_EVENT_REPOSITORY = Symbol(
  'IDENTITY_SECURITY_EVENT_REPOSITORY',
);

export type IdentitySecurityAction =
  'LOGIN_CHALLENGE_LOCKED' | 'SESSION_REVOKED';

export interface IdentitySecurityEventSnapshot {
  id: string;
  userId: string | null;
  sessionId: string | null;
  action: IdentitySecurityAction;
  targetId: string;
  requestId: string;
  occurredAt: Date;
}

export interface IdentitySecurityEventRepository {
  record(event: IdentitySecurityEventSnapshot): Promise<void>;
}
