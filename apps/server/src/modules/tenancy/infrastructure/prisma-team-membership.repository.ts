import { Inject, Injectable } from '@nestjs/common';

import type { TeamMembershipSnapshot } from '../../../domain/tenancy/team-membership.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type {
  FindActiveMembershipRequest,
  TeamMembershipRepository,
} from '../ports/team-membership-repository.js';

@Injectable()
export class PrismaTeamMembershipRepository implements TeamMembershipRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(membership: TeamMembershipSnapshot): Promise<TeamMembershipSnapshot> {
    return this.database.withClient((client) =>
      client.teamMembership.create({ data: membership }),
    ) as Promise<TeamMembershipSnapshot>;
  }

  findActive(
    request: FindActiveMembershipRequest,
  ): Promise<TeamMembershipSnapshot | null> {
    return this.database.withClient(async (client) => {
      const membership = await client.teamMembership.findUnique({
        where: {
          tenantId_userId: {
            tenantId: request.tenantId,
            userId: request.userId,
          },
          removedAt: null,
        },
      });

      return membership as TeamMembershipSnapshot | null;
    });
  }
}
