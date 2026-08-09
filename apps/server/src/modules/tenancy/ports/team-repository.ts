import type { TeamSnapshot } from '../../../domain/tenancy/team.js';
import type { TeamRole } from '../../../domain/tenancy/team-membership.js';

export const TEAM_REPOSITORY = Symbol('TEAM_REPOSITORY');

export interface TeamAccessSnapshot {
  id: string;
  name: string;
  role: TeamRole;
  createdAt: Date;
}

export interface TeamRepository {
  create(team: TeamSnapshot): Promise<TeamSnapshot>;
  findById(teamId: string): Promise<TeamSnapshot | null>;
  listForUser(userId: string): Promise<TeamAccessSnapshot[]>;
}
