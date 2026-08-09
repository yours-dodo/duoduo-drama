import type { TeamRepository } from '../ports/team-repository.js';

export class ListMyTeams {
  constructor(private readonly teams: TeamRepository) {}

  async execute(input: { userId: string }) {
    return { teams: await this.teams.listForUser(input.userId) };
  }
}
