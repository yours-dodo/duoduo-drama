export const TEAM_INVITATION_DELIVERY = Symbol('TEAM_INVITATION_DELIVERY');

export interface DeliverTeamInvitationRequest {
  email: string;
  tenantId: string;
  token: string;
  expiresAt: Date;
}

export interface TeamInvitationDelivery {
  deliver(request: DeliverTeamInvitationRequest): Promise<void>;
}
