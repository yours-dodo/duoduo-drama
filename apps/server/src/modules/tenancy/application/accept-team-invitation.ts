import {
  TeamInvitation,
  TeamInvitationUnavailableError,
} from '../../../domain/tenancy/team-invitation.js';
import {
  TeamMembership,
  type TeamMembershipSnapshot,
} from '../../../domain/tenancy/team-membership.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import {
  TeamInvitationNotFoundError,
  TeamMemberAlreadyActiveError,
} from './tenancy-errors.js';
import type { TeamInvitationRepository } from '../ports/team-invitation-repository.js';
import type { TeamInvitationSecurity } from '../ports/team-invitation-security.js';
import type { TeamMembershipRepository } from '../ports/team-membership-repository.js';

export interface AcceptTeamInvitationInput {
  actorUserId: string;
  actorEmail: string;
  token: string;
  requestId: string;
}

export class AcceptTeamInvitation {
  constructor(
    private readonly invitations: TeamInvitationRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly audit: AuditRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly security: Pick<TeamInvitationSecurity, 'hashToken'>,
    private readonly ids: { create(): string },
  ) {}

  execute(input: AcceptTeamInvitationInput) {
    const tokenHash = this.security.hashToken(input.token);

    return this.transactions.run(async () => {
      const invitationSnapshot =
        await this.invitations.findByTokenHashLocked(tokenHash);
      if (invitationSnapshot === null) {
        throw new TeamInvitationNotFoundError();
      }

      const now = await this.databaseClock.now();
      const invitation = TeamInvitation.restore(invitationSnapshot);
      try {
        invitation.accept({
          userId: input.actorUserId,
          email: input.actorEmail,
          at: now,
        });
      } catch (error) {
        if (error instanceof TeamInvitationUnavailableError) {
          throw new TeamInvitationNotFoundError();
        }
        throw error;
      }

      const existing = await this.memberships.findByUserLocked({
        tenantId: invitationSnapshot.tenantId,
        userId: input.actorUserId,
      });
      const membership = await this.joinMembership({
        existing,
        tenantId: invitationSnapshot.tenantId,
        userId: input.actorUserId,
        joinedAt: now,
      });

      await this.invitations.update(invitation.toSnapshot());
      await this.audit.record({
        id: this.ids.create(),
        tenantId: invitationSnapshot.tenantId,
        actorUserId: input.actorUserId,
        action: 'TEAM_MEMBER_JOINED',
        targetType: 'TEAM_MEMBERSHIP',
        targetId: membership.id,
        beforeSummary: null,
        afterSummary: {
          role: membership.role,
          invitationId: invitationSnapshot.id,
        },
        requestId: input.requestId,
        occurredAt: now,
      });

      return {
        membership: {
          id: membership.id,
          tenantId: membership.tenantId,
          role: membership.role,
          joinedAt: new Date(membership.joinedAt),
        },
      };
    });
  }

  private async joinMembership(input: {
    existing: TeamMembershipSnapshot | null;
    tenantId: string;
    userId: string;
    joinedAt: Date;
  }): Promise<TeamMembershipSnapshot> {
    if (input.existing === null) {
      const membership = TeamMembership.createMember({
        id: this.ids.create(),
        tenantId: input.tenantId,
        userId: input.userId,
        joinedAt: input.joinedAt,
      }).toSnapshot();
      await this.memberships.create(membership);
      return membership;
    }

    const membership = TeamMembership.restore(input.existing);
    if (!membership.reactivate(input.joinedAt)) {
      throw new TeamMemberAlreadyActiveError();
    }
    const reactivated = membership.toSnapshot();
    await this.memberships.update(reactivated);
    return reactivated;
  }
}
