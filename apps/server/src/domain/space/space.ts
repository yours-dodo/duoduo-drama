export type SpaceKind = 'personal' | 'team';

export interface CreatePersonalSpaceInput {
  id: string;
  ownerUserId: string;
  createdAt: Date;
}

export interface CreateTeamSpaceInput {
  id: string;
  ownerTeamId: string;
  createdAt: Date;
}

export interface SpaceSnapshot {
  id: string;
  kind: SpaceKind;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class InvalidSpaceError extends Error {
  constructor() {
    super('Space owner and kind are invalid');
    this.name = 'InvalidSpaceError';
  }
}

export class Space {
  private constructor(private readonly snapshot: SpaceSnapshot) {}

  static createPersonal(input: CreatePersonalSpaceInput): Space {
    return Space.fromSnapshot({
      id: input.id,
      kind: 'personal',
      ownerUserId: input.ownerUserId,
      ownerTeamId: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }

  static createTeam(input: CreateTeamSpaceInput): Space {
    return Space.fromSnapshot({
      id: input.id,
      kind: 'team',
      ownerUserId: null,
      ownerTeamId: input.ownerTeamId,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }

  static fromSnapshot(snapshot: SpaceSnapshot): Space {
    if (
      (snapshot.kind === 'personal' &&
        (isBlank(snapshot.ownerUserId) || snapshot.ownerTeamId !== null)) ||
      (snapshot.kind === 'team' &&
        (snapshot.ownerUserId !== null || isBlank(snapshot.ownerTeamId))) ||
      (snapshot.kind !== 'personal' && snapshot.kind !== 'team')
    ) {
      throw new InvalidSpaceError();
    }

    return new Space({
      ...snapshot,
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
    });
  }

  toSnapshot(): SpaceSnapshot {
    return {
      ...this.snapshot,
      createdAt: new Date(this.snapshot.createdAt),
      updatedAt: new Date(this.snapshot.updatedAt),
    };
  }
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}
