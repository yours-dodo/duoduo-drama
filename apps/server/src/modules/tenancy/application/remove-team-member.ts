import { TeamMembership } from '../../../domain/tenancy/team-membership.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { requireTeamAdministrator } from './team-administrator.js';
import { TeamMemberNotFoundError } from './tenancy-errors.js';
import type { TeamMembershipRepository } from '../ports/team-membership-repository.js';

export class RemoveTeamMember {
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
    requestId: string;
  }): Promise<void> {
    return this.transactions.run(async () => {
      await this.memberships.lockAdministration(input.tenantId);
      await requireTeamAdministrator(this.memberships, input);
      const snapshot = await this.memberships.findByIdLocked({
        tenantId: input.tenantId,
        membershipId: input.membershipId,
      });
      if (snapshot === null) {
        throw new TeamMemberNotFoundError();
      }

      const membership = TeamMembership.restore(snapshot);
      const administratorCount =
        await this.memberships.countActiveAdministrators(input.tenantId);
      const now = await this.databaseClock.now();
      if (!membership.remove(now, administratorCount)) {
        return;
      }

      const removed = membership.toSnapshot();
      await this.memberships.update(removed);
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'TEAM_MEMBER_REMOVED',
        targetType: 'TEAM_MEMBERSHIP',
        targetId: removed.id,
        beforeSummary: { role: snapshot.role, active: true },
        afterSummary: { role: removed.role, active: false },
        requestId: input.requestId,
        occurredAt: now,
      });
    });
  }
}
