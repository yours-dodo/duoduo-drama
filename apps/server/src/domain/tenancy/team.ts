const MAX_TEAM_NAME_LENGTH = 100;

export interface CreateTeamInput {
  id: string;
  name: string;
  createdByUserId: string;
  createdAt: Date;
}

export interface TeamSnapshot {
  id: string;
  name: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export class InvalidTeamNameError extends Error {
  constructor() {
    super('Team name is invalid');
    this.name = 'InvalidTeamNameError';
  }
}

export class Team {
  private constructor(private readonly snapshot: TeamSnapshot) {}

  static create(input: CreateTeamInput): Team {
    const name = normalizeTeamName(input.name);

    const createdAt = new Date(input.createdAt);
    return new Team({
      id: input.id,
      name,
      createdByUserId: input.createdByUserId,
      createdAt,
      updatedAt: new Date(createdAt),
    });
  }

  toSnapshot(): TeamSnapshot {
    return {
      ...this.snapshot,
      createdAt: new Date(this.snapshot.createdAt),
      updatedAt: new Date(this.snapshot.updatedAt),
    };
  }
}

export function normalizeTeamName(input: string): string {
  const name = input.trim().replace(/\s+/gu, ' ');
  if (name.length === 0 || name.length > MAX_TEAM_NAME_LENGTH) {
    throw new InvalidTeamNameError();
  }

  return name;
}
