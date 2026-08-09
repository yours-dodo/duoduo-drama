import { TeamInvitation } from '../../../domain/tenancy/team-invitation.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { requireTeamAdministrator } from './team-administrator.js';
import {
  TeamInvitationCannotBeRevokedError,
  TeamInvitationNotFoundError,
} from './tenancy-errors.js';
import type { TeamInvitationRepository } from '../ports/team-invitation-repository.js';
import type { TeamMembershipRepository } from '../ports/team-membership-repository.js';

export class RevokeTeamInvitation {
  constructor(
    private readonly memberships: TeamMembershipRepository,
    private readonly invitations: TeamInvitationRepository,
    private readonly audit: AuditRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly ids: { create(): string },
  ) {}

  execute(input: {
    tenantId: string;
    actorUserId: string;
    invitationId: string;
    requestId: string;
  }): Promise<void> {
    return this.transactions.run(async () => {
      await this.memberships.lockAdministration(input.tenantId);
      await requireTeamAdministrator(this.memberships, input);
      const snapshot = await this.invitations.findByIdLocked({
        tenantId: input.tenantId,
        invitationId: input.invitationId,
      });
      if (snapshot === null) {
        throw new TeamInvitationNotFoundError();
      }
      if (snapshot.acceptedAt !== null) {
        throw new TeamInvitationCannotBeRevokedError();
      }
      if (snapshot.revokedAt !== null) {
        return;
      }

      const now = await this.databaseClock.now();
      const invitation = TeamInvitation.restore(snapshot);
      invitation.revoke(now);
      await this.invitations.update(invitation.toSnapshot());
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'TEAM_INVITATION_REVOKED',
        targetType: 'TEAM_INVITATION',
        targetId: snapshot.id,
        beforeSummary: { status: 'pending' },
        afterSummary: { status: 'revoked' },
        requestId: input.requestId,
        occurredAt: now,
      });
    });
  }
}
