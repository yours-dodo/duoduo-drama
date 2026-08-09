import { EmailAddress } from '../identity/email-address.js';

export interface IssueTeamInvitationInput {
  id: string;
  tenantId: string;
  email: string;
  invitedByUserId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface TeamInvitationSnapshot extends IssueTeamInvitationInput {
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  revokedAt: Date | null;
}

export class TeamInvitationUnavailableError extends Error {
  constructor() {
    super('Team invitation is unavailable');
    this.name = 'TeamInvitationUnavailableError';
  }
}

export class TeamInvitation {
  private constructor(private readonly snapshot: TeamInvitationSnapshot) {}

  static issue(input: IssueTeamInvitationInput): TeamInvitation {
    return new TeamInvitation({
      ...input,
      email: EmailAddress.parse(input.email).value,
      createdAt: new Date(input.createdAt),
      expiresAt: new Date(input.expiresAt),
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
    });
  }

  static restore(snapshot: TeamInvitationSnapshot): TeamInvitation {
    return new TeamInvitation(copySnapshot(snapshot));
  }

  accept(input: { userId: string; email: string; at: Date }): boolean {
    const at = new Date(input.at);
    const email = EmailAddress.parse(input.email).value;
    if (
      this.snapshot.acceptedAt !== null ||
      this.snapshot.revokedAt !== null ||
      at >= this.snapshot.expiresAt ||
      email !== this.snapshot.email
    ) {
      throw new TeamInvitationUnavailableError();
    }

    this.snapshot.acceptedAt = at;
    this.snapshot.acceptedByUserId = input.userId;
    return true;
  }

  revoke(at: Date): boolean {
    if (this.snapshot.acceptedAt !== null || this.snapshot.revokedAt !== null) {
      return false;
    }

    this.snapshot.revokedAt = new Date(at);
    return true;
  }

  toSnapshot(): TeamInvitationSnapshot {
    return copySnapshot(this.snapshot);
  }
}

function copySnapshot(
  snapshot: TeamInvitationSnapshot,
): TeamInvitationSnapshot {
  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    expiresAt: new Date(snapshot.expiresAt),
    acceptedAt:
      snapshot.acceptedAt === null ? null : new Date(snapshot.acceptedAt),
    revokedAt:
      snapshot.revokedAt === null ? null : new Date(snapshot.revokedAt),
  };
}
