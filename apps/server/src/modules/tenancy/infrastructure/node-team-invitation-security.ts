import { createHmac, randomBytes } from 'node:crypto';

import type { TeamInvitationSecurity } from '../ports/team-invitation-security.js';

export class NodeTeamInvitationSecurity implements TeamInvitationSecurity {
  constructor(private readonly pepper: string) {}

  issueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    return createHmac('sha256', this.pepper)
      .update('team-invitation-token')
      .update('\0')
      .update(token)
      .digest('hex');
  }
}
