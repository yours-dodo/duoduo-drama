import type { KeysetPageRequest } from '../../../platform/pagination/keyset-page.js';
import { invitationStatus } from './create-team-invitation.js';
import { requireTeamAdministrator } from './team-administrator.js';
import type { TeamInvitationRepository } from '../ports/team-invitation-repository.js';
import type { TeamMembershipRepository } from '../ports/team-membership-repository.js';

export class ListTeamInvitations {
  constructor(
    private readonly memberships: TeamMembershipRepository,
    private readonly invitations: TeamInvitationRepository,
    private readonly databaseClock: { now(): Promise<Date> },
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    page: KeysetPageRequest;
  }) {
    await requireTeamAdministrator(this.memberships, input);
    const [page, now] = await Promise.all([
      this.invitations.listForTenant(input.tenantId, input.page),
      this.databaseClock.now(),
    ]);

    return {
      items: page.items.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        status: invitationStatus(invitation, now),
        createdAt: new Date(invitation.createdAt),
        expiresAt: new Date(invitation.expiresAt),
        acceptedAt:
          invitation.acceptedAt === null
            ? null
            : new Date(invitation.acceptedAt),
        revokedAt:
          invitation.revokedAt === null ? null : new Date(invitation.revokedAt),
      })),
      next: page.next,
    };
  }
}
