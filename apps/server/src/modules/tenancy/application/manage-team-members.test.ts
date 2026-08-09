import { describe, expect, it, vi } from 'vitest';

import { LastTeamAdministratorError } from '../../../domain/tenancy/team-membership.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { ChangeTeamMemberRole } from './change-team-member-role.js';
import { ListTeamMembers } from './list-team-members.js';
import { RemoveTeamMember } from './remove-team-member.js';
import {
  TeamAdministratorRequiredError,
  TeamMemberNotFoundError,
} from './tenancy-errors.js';

const NOW = new Date('2026-08-10T03:00:00.000Z');

describe('team member management', () => {
  it('lets an administrator change a role and records the transition', async () => {
    const fixture = buildFixture();
    const useCase = changeRoleUseCase(fixture);

    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'admin-id',
        membershipId: 'member-membership-id',
        role: 'admin',
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({ membership: { role: 'admin' } });
    expect(fixture.memberships.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'member-membership-id', role: 'admin' }),
    );
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEAM_MEMBER_ROLE_CHANGED',
        beforeSummary: { role: 'member' },
        afterSummary: { role: 'admin' },
      }),
    );
  });

  it('protects the last administrator and hides unknown members', async () => {
    const lastAdmin = buildFixture({
      target: membership({ role: 'admin' }),
      administratorCount: 1,
    });
    await expect(
      changeRoleUseCase(lastAdmin).execute({
        tenantId: 'team-id',
        actorUserId: 'admin-id',
        membershipId: 'member-membership-id',
        role: 'member',
        requestId: 'request-id',
      }),
    ).rejects.toBeInstanceOf(LastTeamAdministratorError);

    const missing = buildFixture({ target: null });
    await expect(
      removeUseCase(missing).execute(removeInput()),
    ).rejects.toBeInstanceOf(TeamMemberNotFoundError);
  });

  it('removes a member once and makes repeated removal idempotent', async () => {
    const fixture = buildFixture();
    await expect(
      removeUseCase(fixture).execute(removeInput()),
    ).resolves.toEqual(undefined);
    expect(fixture.memberships.update).toHaveBeenCalledWith(
      expect.objectContaining({ removedAt: NOW }),
    );
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TEAM_MEMBER_REMOVED' }),
    );

    const alreadyRemoved = buildFixture({
      target: membership({ removedAt: NOW }),
    });
    await expect(
      removeUseCase(alreadyRemoved).execute(removeInput()),
    ).resolves.toBeUndefined();
    expect(alreadyRemoved.audit.record).not.toHaveBeenCalled();
  });

  it('requires administrator access for mutation and member listing', async () => {
    const fixture = buildFixture({ actorRole: 'member' });
    await expect(
      changeRoleUseCase(fixture).execute({
        tenantId: 'team-id',
        actorUserId: 'admin-id',
        membershipId: 'member-membership-id',
        role: 'admin',
        requestId: 'request-id',
      }),
    ).rejects.toBeInstanceOf(TeamAdministratorRequiredError);

    const list = new ListTeamMembers(fixture.memberships as never);
    await expect(
      list.execute({
        tenantId: 'team-id',
        actorUserId: 'admin-id',
        page: { limit: 50, after: null },
      }),
    ).rejects.toBeInstanceOf(TeamAdministratorRequiredError);
  });
});

function removeInput() {
  return {
    tenantId: 'team-id',
    actorUserId: 'admin-id',
    membershipId: 'member-membership-id',
    requestId: 'request-id',
  };
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'member-membership-id',
    tenantId: 'team-id',
    userId: 'member-id',
    role: 'member',
    joinedAt: new Date('2026-08-09T03:00:00.000Z'),
    removedAt: null,
    ...overrides,
  };
}

function buildFixture(
  options: {
    actorRole?: 'admin' | 'member';
    target?: ReturnType<typeof membership> | null;
    administratorCount?: number;
  } = {},
) {
  const memberships = {
    lockAdministration: vi.fn(async () => undefined),
    findActive: vi.fn(async () => ({
      ...membership({
        id: 'admin-membership-id',
        userId: 'admin-id',
        role: options.actorRole ?? 'admin',
      }),
    })),
    findByIdLocked: vi.fn(async () =>
      options.target === undefined ? membership() : options.target,
    ),
    countActiveAdministrators: vi.fn(
      async () => options.administratorCount ?? 2,
    ),
    update: vi.fn(async (value) => value),
    listActive: vi.fn(async () => ({ items: [], next: null })),
  };
  const audit: AuditRepository & { record: ReturnType<typeof vi.fn> } = {
    record: vi.fn(async () => undefined),
  };
  const shared = {
    memberships,
    audit,
    transactions: {
      run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    },
    clock: { now: vi.fn(async () => NOW) },
    ids: { create: vi.fn(() => 'audit-id') },
  };
  return shared;
}

function changeRoleUseCase(fixture: ReturnType<typeof buildFixture>) {
  return new ChangeTeamMemberRole(
    fixture.memberships as never,
    fixture.audit,
    fixture.transactions,
    fixture.clock,
    fixture.ids,
  );
}

function removeUseCase(fixture: ReturnType<typeof buildFixture>) {
  return new RemoveTeamMember(
    fixture.memberships as never,
    fixture.audit,
    fixture.transactions,
    fixture.clock,
    fixture.ids,
  );
}
