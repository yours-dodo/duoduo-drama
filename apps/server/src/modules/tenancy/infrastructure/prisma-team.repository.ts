import { Inject, Injectable } from '@nestjs/common';

import type { TeamSnapshot } from '../../../domain/tenancy/team.js';
import type { TeamRole } from '../../../domain/tenancy/team-membership.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type {
  TeamAccessSnapshot,
  TeamRepository,
} from '../ports/team-repository.js';

interface TeamAccessRow {
  id: string;
  name: string;
  role: string;
  createdAt: Date;
}

@Injectable()
export class PrismaTeamRepository implements TeamRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(team: TeamSnapshot): Promise<TeamSnapshot> {
    return this.database.withClient((client) =>
      client.team.create({ data: team }),
    );
  }

  findById(teamId: string): Promise<TeamSnapshot | null> {
    return this.database.withClient((client) =>
      client.team.findUnique({ where: { id: teamId } }),
    );
  }

  listForUser(userId: string): Promise<TeamAccessSnapshot[]> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<TeamAccessRow[]>`
        SELECT
          team.id,
          team.name,
          membership.role,
          team.created_at AS "createdAt"
        FROM team_memberships AS membership
        INNER JOIN teams AS team ON team.id = membership.tenant_id
        WHERE membership.user_id = ${userId}::uuid
          AND membership.removed_at IS NULL
        ORDER BY team.created_at ASC, team.id ASC
      `;

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        role: readTeamRole(row.role),
        createdAt: new Date(row.createdAt),
      }));
    });
  }
}

function readTeamRole(role: string): TeamRole {
  if (role !== 'admin' && role !== 'member') {
    throw new Error('Database returned an invalid team role');
  }
  return role;
}
