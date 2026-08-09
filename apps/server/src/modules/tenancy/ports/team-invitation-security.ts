export const TEAM_INVITATION_SECURITY = Symbol('TEAM_INVITATION_SECURITY');

export interface TeamInvitationSecurity {
  issueToken(): string;
  hashToken(token: string): string;
}
