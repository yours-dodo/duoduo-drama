export type TeamRole = 'admin' | 'member';

export interface CreateAdministratorInput {
  id: string;
  tenantId: string;
  userId: string;
  joinedAt: Date;
}

export type CreateMemberInput = CreateAdministratorInput;

export interface TeamMembershipSnapshot {
  id: string;
  tenantId: string;
  userId: string;
  role: TeamRole;
  joinedAt: Date;
  removedAt: Date | null;
}

export class LastTeamAdministratorError extends Error {
  constructor() {
    super('A team must retain at least one active administrator');
    this.name = 'LastTeamAdministratorError';
  }
}

export class TeamMembership {
  private constructor(private readonly snapshot: TeamMembershipSnapshot) {}

  static createAdministrator(input: CreateAdministratorInput): TeamMembership {
    return new TeamMembership({
      id: input.id,
      tenantId: input.tenantId,
      userId: input.userId,
      role: 'admin',
      joinedAt: new Date(input.joinedAt),
      removedAt: null,
    });
  }

  static createMember(input: CreateMemberInput): TeamMembership {
    return new TeamMembership({
      id: input.id,
      tenantId: input.tenantId,
      userId: input.userId,
      role: 'member',
      joinedAt: new Date(input.joinedAt),
      removedAt: null,
    });
  }

  static restore(snapshot: TeamMembershipSnapshot): TeamMembership {
    return new TeamMembership({
      ...snapshot,
      joinedAt: new Date(snapshot.joinedAt),
      removedAt:
        snapshot.removedAt === null ? null : new Date(snapshot.removedAt),
    });
  }

  isActive(): boolean {
    return this.snapshot.removedAt === null;
  }

  reactivate(at: Date): boolean {
    if (this.isActive()) {
      return false;
    }

    this.snapshot.role = 'member';
    this.snapshot.joinedAt = new Date(at);
    this.snapshot.removedAt = null;
    return true;
  }

  changeRole(nextRole: TeamRole, activeAdministratorCount: number): boolean {
    if (this.snapshot.role === nextRole) {
      return false;
    }

    if (
      this.isActive() &&
      this.snapshot.role === 'admin' &&
      nextRole !== 'admin' &&
      activeAdministratorCount <= 1
    ) {
      throw new LastTeamAdministratorError();
    }

    this.snapshot.role = nextRole;
    return true;
  }

  remove(at: Date, activeAdministratorCount: number): boolean {
    if (!this.isActive()) {
      return false;
    }

    if (this.snapshot.role === 'admin' && activeAdministratorCount <= 1) {
      throw new LastTeamAdministratorError();
    }

    this.snapshot.removedAt = new Date(at);
    return true;
  }

  toSnapshot(): TeamMembershipSnapshot {
    return {
      ...this.snapshot,
      joinedAt: new Date(this.snapshot.joinedAt),
      removedAt:
        this.snapshot.removedAt === null
          ? null
          : new Date(this.snapshot.removedAt),
    };
  }
}
