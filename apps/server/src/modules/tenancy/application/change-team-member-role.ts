import {
  TeamMembership,
  type TeamRole,
} from '../../../domain/tenancy/team-membership.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { requireTeamAdministrator } from './team-administrator.js';
import { TeamMemberNotFoundError } from './tenancy-errors.js';
import type { TeamMembershipRepository } from '../ports/team-membership-repository.js';

export class ChangeTeamMemberRole {
  constructor(
    private readonly memberships: TeamMembershipRepository,
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
    membershipId: string;
    role: TeamRole;
    requestId: string;
  }) {
    return this.transactions.run(async () => {
      await this.memberships.lockAdministration(input.tenantId);
      await requireTeamAdministrator(this.memberships, input);
      const snapshot = await this.memberships.findByIdLocked({
        tenantId: input.tenantId,
        membershipId: input.membershipId,
      });
      if (snapshot === null || snapshot.removedAt !== null) {
        throw new TeamMemberNotFoundError();
      }

      const membership = TeamMembership.restore(snapshot);
      const administratorCount =
        await this.memberships.countActiveAdministrators(input.tenantId);
      if (!membership.changeRole(input.role, administratorCount)) {
        return { membership: membershipOutput(snapshot) };
      }

      const changed = membership.toSnapshot();
      await this.memberships.update(changed);
      const now = await this.databaseClock.now();
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'TEAM_MEMBER_ROLE_CHANGED',
        targetType: 'TEAM_MEMBERSHIP',
        targetId: changed.id,
        beforeSummary: { role: snapshot.role },
        afterSummary: { role: changed.role },
        requestId: input.requestId,
        occurredAt: now,
      });

      return { membership: membershipOutput(changed) };
    });
  }
}

function membershipOutput(membership: {
  id: string;
  userId: string;
  role: TeamRole;
  joinedAt: Date;
}) {
  return {
    id: membership.id,
    userId: membership.userId,
    role: membership.role,
    joinedAt: new Date(membership.joinedAt),
  };
}
