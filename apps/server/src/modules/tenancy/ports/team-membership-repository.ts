import type {
  TeamMembershipSnapshot,
  TeamRole,
} from '../../../domain/tenancy/team-membership.js';
import type {
  KeysetPage,
  KeysetPageRequest,
} from '../../../platform/pagination/keyset-page.js';

export const TEAM_MEMBERSHIP_REPOSITORY = Symbol('TEAM_MEMBERSHIP_REPOSITORY');

export interface FindActiveMembershipRequest {
  tenantId: string;
  userId: string;
}

export interface TeamMemberListItem {
  id: string;
  userId: string;
  email: string;
  role: TeamRole;
  joinedAt: Date;
}

export interface TeamMembershipRepository {
  create(membership: TeamMembershipSnapshot): Promise<TeamMembershipSnapshot>;
  update(membership: TeamMembershipSnapshot): Promise<TeamMembershipSnapshot>;
  findActive(
    request: FindActiveMembershipRequest,
  ): Promise<TeamMembershipSnapshot | null>;
  findByIdLocked(request: {
    tenantId: string;
    membershipId: string;
  }): Promise<TeamMembershipSnapshot | null>;
  findByUserLocked(request: {
    tenantId: string;
    userId: string;
  }): Promise<TeamMembershipSnapshot | null>;
  findActiveByEmail(request: {
    tenantId: string;
    email: string;
  }): Promise<TeamMembershipSnapshot | null>;
  lockAdministration(tenantId: string): Promise<void>;
  countActiveAdministrators(tenantId: string): Promise<number>;
  listActive(
    tenantId: string,
    page: KeysetPageRequest,
  ): Promise<KeysetPage<TeamMemberListItem>>;
}
