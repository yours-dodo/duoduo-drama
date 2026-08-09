import type { KeysetPageRequest } from '../../../platform/pagination/keyset-page.js';
import { requireTeamAdministrator } from './team-administrator.js';
import type { TeamMembershipRepository } from '../ports/team-membership-repository.js';

export class ListTeamMembers {
  constructor(private readonly memberships: TeamMembershipRepository) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    page: KeysetPageRequest;
  }) {
    await requireTeamAdministrator(this.memberships, input);
    return this.memberships.listActive(input.tenantId, input.page);
  }
}
