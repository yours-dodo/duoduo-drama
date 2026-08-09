import { normalizeTeamName, Team } from '../../../domain/tenancy/team.js';
import { TeamMembership } from '../../../domain/tenancy/team-membership.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import type { IdempotencyRepository } from '../ports/idempotency-repository.js';
import type { TeamMembershipRepository } from '../ports/team-membership-repository.js';
import type { TeamRepository } from '../ports/team-repository.js';

const OPERATION_TYPE = 'CREATE_TEAM';

export interface CreateTeamInput {
  actorUserId: string;
  name: string;
  idempotencyKey: string;
  requestId: string;
}

export interface CreateTeamOutput {
  team: {
    id: string;
    name: string;
    role: 'admin';
    createdAt: Date;
  };
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used with different input');
    this.name = 'IdempotencyConflictError';
  }
}

export class CreateTeam {
  constructor(
    private readonly teams: TeamRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly audit: AuditRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly fingerprint: { hash(value: string): string },
    private readonly ids: { create(): string },
  ) {}

  execute(input: CreateTeamInput): Promise<CreateTeamOutput> {
    const name = normalizeTeamName(input.name);
    const scopeKey = `user:${input.actorUserId}`;
    const requestHash = this.fingerprint.hash(JSON.stringify({ name }));

    return this.transactions.run(async () => {
      const existing = await this.idempotency.findLocked({
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
      });
      if (existing !== null) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }

        const team = await this.teams.findById(existing.resultId);
        if (team === null) {
          throw new Error('Idempotency result team is unavailable');
        }

        return outputFor(team);
      }

      const now = await this.databaseClock.now();
      const team = Team.create({
        id: this.ids.create(),
        name,
        createdByUserId: input.actorUserId,
        createdAt: now,
      }).toSnapshot();
      const membership = TeamMembership.createAdministrator({
        id: this.ids.create(),
        tenantId: team.id,
        userId: input.actorUserId,
        joinedAt: now,
      }).toSnapshot();

      await this.teams.create(team);
      await this.memberships.create(membership);
      await this.idempotency.create({
        id: this.ids.create(),
        tenantId: team.id,
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        resultId: team.id,
        createdAt: now,
      });
      await this.audit.record({
        id: this.ids.create(),
        tenantId: team.id,
        actorUserId: input.actorUserId,
        action: 'TEAM_CREATED',
        targetType: 'TEAM',
        targetId: team.id,
        beforeSummary: null,
        afterSummary: { name: team.name },
        requestId: input.requestId,
        occurredAt: now,
      });

      return outputFor(team);
    });
  }
}

function outputFor(team: {
  id: string;
  name: string;
  createdAt: Date;
}): CreateTeamOutput {
  return {
    team: {
      id: team.id,
      name: team.name,
      role: 'admin',
      createdAt: new Date(team.createdAt),
    },
  };
}
