import type { ServerEnvironment } from '../../../config/server-config.js';
import type {
  DeliverTeamInvitationRequest,
  TeamInvitationDelivery,
} from '../ports/team-invitation-delivery.js';

export interface LocalTeamInvitationEmail extends DeliverTeamInvitationRequest {
  acceptanceLink: string;
}

export class LocalTeamInvitationDelivery implements TeamInvitationDelivery {
  private latest: LocalTeamInvitationEmail | null = null;

  constructor(
    private readonly environment: ServerEnvironment,
    private readonly publicWebUrl: string,
  ) {
    if (environment === 'production') {
      throw new Error(
        'Local team invitation delivery cannot run in production',
      );
    }
  }

  async deliver(request: DeliverTeamInvitationRequest): Promise<void> {
    const link = new URL('/team-invitations/accept', this.publicWebUrl);
    link.searchParams.set('token', request.token);
    this.latest = {
      ...request,
      expiresAt: new Date(request.expiresAt),
      acceptanceLink: link.toString(),
    };
  }

  readLatestForTest(): LocalTeamInvitationEmail | null {
    if (this.environment !== 'test') {
      throw new Error('Local invitation inspection is available only in tests');
    }
    return this.latest === null
      ? null
      : { ...this.latest, expiresAt: new Date(this.latest.expiresAt) };
  }
}
