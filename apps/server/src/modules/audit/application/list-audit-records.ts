import type { KeysetPageRequest } from '../../../platform/pagination/keyset-page.js';
import { TeamAdministratorRequiredError } from '../../tenancy/application/tenancy-errors.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import type { AuditQueryRepository } from '../ports/audit-repository.js';

export class ListAuditRecords {
  constructor(
    private readonly memberships: TeamMembershipRepository,
    private readonly records: AuditQueryRepository,
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    page: KeysetPageRequest;
  }) {
    const actor = await this.memberships.findActive({
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    if (actor?.role !== 'admin') {
      throw new TeamAdministratorRequiredError();
    }
    return this.records.listForTenant(input.tenantId, input.page);
  }
}
