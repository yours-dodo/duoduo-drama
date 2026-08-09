import { TeamAdministratorRequiredError } from './tenancy-errors.js';
import type { TeamMembershipRepository } from '../ports/team-membership-repository.js';

export async function requireTeamAdministrator(
  memberships: TeamMembershipRepository,
  input: { tenantId: string; actorUserId: string },
): Promise<void> {
  const actor = await memberships.findActive({
    tenantId: input.tenantId,
    userId: input.actorUserId,
  });
  if (actor?.role !== 'admin') {
    throw new TeamAdministratorRequiredError();
  }
}
