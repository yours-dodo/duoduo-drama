import type { TeamInvitationSnapshot } from '../../../domain/tenancy/team-invitation.js';
import type {
  KeysetPage,
  KeysetPageRequest,
} from '../../../platform/pagination/keyset-page.js';

export const TEAM_INVITATION_REPOSITORY = Symbol('TEAM_INVITATION_REPOSITORY');

export interface TeamInvitationRepository {
  create(invitation: TeamInvitationSnapshot): Promise<TeamInvitationSnapshot>;
  update(invitation: TeamInvitationSnapshot): Promise<TeamInvitationSnapshot>;
  findById(request: {
    tenantId: string;
    invitationId: string;
  }): Promise<TeamInvitationSnapshot | null>;
  findByIdLocked(request: {
    tenantId: string;
    invitationId: string;
  }): Promise<TeamInvitationSnapshot | null>;
  findPendingByEmailLocked(request: {
    tenantId: string;
    email: string;
  }): Promise<TeamInvitationSnapshot | null>;
  findByTokenHashLocked(
    tokenHash: string,
  ): Promise<TeamInvitationSnapshot | null>;
  listForTenant(
    tenantId: string,
    page: KeysetPageRequest,
  ): Promise<KeysetPage<TeamInvitationSnapshot>>;
}
