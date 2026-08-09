import { describe, expect, it, vi } from 'vitest';

import { CreateTeam, IdempotencyConflictError } from './create-team.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import type { IdempotencyRepository } from '../ports/idempotency-repository.js';
import type { TeamMembershipRepository } from '../ports/team-membership-repository.js';
import type { TeamRepository } from '../ports/team-repository.js';

const NOW = new Date('2026-08-10T00:00:00.000Z');

describe('CreateTeam', () => {
  it('atomically creates a tenant, its first administrator, idempotency result, and audit record', async () => {
    const teams = teamRepository();
    const memberships = membershipRepository();
    const idempotency = idempotencyRepository(null);
    const audit = auditRepository();
    const transaction = {
      run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    };
    const createTeam = new CreateTeam(
      teams,
      memberships,
      idempotency,
      audit,
      transaction,
      { now: async () => NOW },
      { hash: (value) => `hash:${value}` },
      sequentialIds('team-id', 'membership-id', 'idempotency-id', 'audit-id'),
    );

    const result = await createTeam.execute({
      actorUserId: 'user-id',
      name: '  多多   编剧组  ',
      idempotencyKey: 'create-team-key',
      requestId: 'request-id',
    });

    expect(transaction.run).toHaveBeenCalledOnce();
    expect(idempotency.findLocked).toHaveBeenCalledWith({
      scopeKey: 'user:user-id',
      operationType: 'CREATE_TEAM',
      idempotencyKey: 'create-team-key',
    });
    expect(teams.create).toHaveBeenCalledWith({
      id: 'team-id',
      name: '多多 编剧组',
      createdByUserId: 'user-id',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(memberships.create).toHaveBeenCalledWith({
      id: 'membership-id',
      tenantId: 'team-id',
      userId: 'user-id',
      role: 'admin',
      joinedAt: NOW,
      removedAt: null,
    });
    expect(idempotency.create).toHaveBeenCalledWith({
      id: 'idempotency-id',
      tenantId: 'team-id',
      scopeKey: 'user:user-id',
      operationType: 'CREATE_TEAM',
      idempotencyKey: 'create-team-key',
      requestHash: 'hash:{"name":"多多 编剧组"}',
      resultId: 'team-id',
      createdAt: NOW,
    });
    expect(audit.record).toHaveBeenCalledWith({
      id: 'audit-id',
      tenantId: 'team-id',
      actorUserId: 'user-id',
      action: 'TEAM_CREATED',
      targetType: 'TEAM',
      targetId: 'team-id',
      beforeSummary: null,
      afterSummary: { name: '多多 编剧组' },
      requestId: 'request-id',
      occurredAt: NOW,
    });
    expect(result).toEqual({
      team: {
        id: 'team-id',
        name: '多多 编剧组',
        role: 'admin',
        createdAt: NOW,
      },
    });
  });

  it('returns the original team for an identical idempotent replay', async () => {
    const existingTeam = {
      id: 'team-id',
      name: '多多编剧组',
      createdByUserId: 'user-id',
      createdAt: NOW,
      updatedAt: NOW,
    };
    const teams = teamRepository(existingTeam);
    const memberships = membershipRepository();
    const idempotency = idempotencyRepository({
      id: 'idempotency-id',
      tenantId: 'team-id',
      scopeKey: 'user:user-id',
      operationType: 'CREATE_TEAM',
      idempotencyKey: 'create-team-key',
      requestHash: 'hash:{"name":"多多编剧组"}',
      resultId: 'team-id',
      createdAt: NOW,
    });
    const audit = auditRepository();
    const createTeam = new CreateTeam(
      teams,
      memberships,
      idempotency,
      audit,
      { run: async (operation) => operation() },
      { now: async () => NOW },
      { hash: (value) => `hash:${value}` },
      sequentialIds(),
    );

    await expect(
      createTeam.execute({
        actorUserId: 'user-id',
        name: '多多编剧组',
        idempotencyKey: 'create-team-key',
        requestId: 'retry-request',
      }),
    ).resolves.toEqual({
      team: {
        id: 'team-id',
        name: '多多编剧组',
        role: 'admin',
        createdAt: NOW,
      },
    });
    expect(teams.create).not.toHaveBeenCalled();
    expect(memberships.create).not.toHaveBeenCalled();
    expect(idempotency.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key with different input', async () => {
    const teams = teamRepository();
    const idempotency = idempotencyRepository({
      id: 'idempotency-id',
      tenantId: 'team-id',
      scopeKey: 'user:user-id',
      operationType: 'CREATE_TEAM',
      idempotencyKey: 'create-team-key',
      requestHash: 'hash:{"name":"原团队"}',
      resultId: 'team-id',
      createdAt: NOW,
    });
    const createTeam = new CreateTeam(
      teams,
      membershipRepository(),
      idempotency,
      auditRepository(),
      { run: async (operation) => operation() },
      { now: async () => NOW },
      { hash: (value) => `hash:${value}` },
      sequentialIds(),
    );

    await expect(
      createTeam.execute({
        actorUserId: 'user-id',
        name: '另一个团队',
        idempotencyKey: 'create-team-key',
        requestId: 'conflict-request',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(teams.create).not.toHaveBeenCalled();
  });
});

function teamRepository(
  found: Awaited<ReturnType<TeamRepository['findById']>> = null,
): TeamRepository & {
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(async (team) => team),
    findById: vi.fn(async () => found),
    listForUser: vi.fn(),
  };
}

function membershipRepository(): TeamMembershipRepository & {
  create: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(async (membership) => membership),
    findActive: vi.fn(),
  };
}

function idempotencyRepository(
  found: Awaited<ReturnType<IdempotencyRepository['findLocked']>>,
): IdempotencyRepository & {
  findLocked: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
} {
  return {
    findLocked: vi.fn(async () => found),
    create: vi.fn(async (record) => record),
  };
}

function auditRepository(): AuditRepository & {
  record: ReturnType<typeof vi.fn>;
} {
  return { record: vi.fn(async () => undefined) };
}

function sequentialIds(...ids: string[]): { create(): string } {
  return {
    create: vi.fn(() => {
      const id = ids.shift();
      if (id === undefined) {
        throw new Error('No test ID remains');
      }
      return id;
    }),
  };
}
