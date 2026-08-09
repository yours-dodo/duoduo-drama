import type { TeamMembershipSnapshot } from '../../../domain/tenancy/team-membership.js';

export const TEAM_MEMBERSHIP_REPOSITORY = Symbol('TEAM_MEMBERSHIP_REPOSITORY');

export interface FindActiveMembershipRequest {
  tenantId: string;
  userId: string;
}

export interface TeamMembershipRepository {
  create(membership: TeamMembershipSnapshot): Promise<TeamMembershipSnapshot>;
  findActive(
    request: FindActiveMembershipRequest,
  ): Promise<TeamMembershipSnapshot | null>;
}
