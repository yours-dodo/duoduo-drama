import { describe, expect, it } from 'vitest';

import {
  LastTeamAdministratorError,
  TeamMembership,
} from './team-membership.js';

describe('TeamMembership', () => {
  it('creates the team creator as an active administrator', () => {
    const joinedAt = new Date('2026-08-10T00:00:00.000Z');
    const membership = TeamMembership.createAdministrator({
      id: 'membership-id',
      tenantId: 'team-id',
      userId: 'user-id',
      joinedAt,
    });

    expect(membership.isActive()).toBe(true);
    expect(membership.toSnapshot()).toEqual({
      id: 'membership-id',
      tenantId: 'team-id',
      userId: 'user-id',
      role: 'admin',
      joinedAt,
      removedAt: null,
    });
  });

  it('protects the last active administrator from removal or demotion', () => {
    const administrator = TeamMembership.createAdministrator({
      id: 'membership-id',
      tenantId: 'team-id',
      userId: 'user-id',
      joinedAt: new Date('2026-08-10T00:00:00.000Z'),
    });

    expect(() =>
      administrator.remove(new Date('2026-08-11T00:00:00.000Z'), 1),
    ).toThrow(LastTeamAdministratorError);
    expect(() => administrator.changeRole('member', 1)).toThrow(
      LastTeamAdministratorError,
    );
    expect(administrator.isActive()).toBe(true);
    expect(administrator.toSnapshot().role).toBe('admin');
  });

  it('allows an administrator change when another active administrator remains', () => {
    const administrator = TeamMembership.createAdministrator({
      id: 'membership-id',
      tenantId: 'team-id',
      userId: 'user-id',
      joinedAt: new Date('2026-08-10T00:00:00.000Z'),
    });

    expect(administrator.changeRole('member', 2)).toBe(true);
    expect(administrator.toSnapshot().role).toBe('member');
    expect(administrator.remove(new Date('2026-08-11T00:00:00.000Z'), 1)).toBe(
      true,
    );
    expect(administrator.isActive()).toBe(false);
  });

  it('creates an ordinary member from an accepted invitation', () => {
    const joinedAt = new Date('2026-08-10T00:00:00.000Z');

    expect(
      TeamMembership.createMember({
        id: 'membership-id',
        tenantId: 'team-id',
        userId: 'member-id',
        joinedAt,
      }).toSnapshot(),
    ).toEqual({
      id: 'membership-id',
      tenantId: 'team-id',
      userId: 'member-id',
      role: 'member',
      joinedAt,
      removedAt: null,
    });
  });

  it('reactivates a removed membership as a member', () => {
    const removedAt = new Date('2026-08-11T00:00:00.000Z');
    const rejoinedAt = new Date('2026-08-12T00:00:00.000Z');
    const membership = TeamMembership.restore({
      id: 'membership-id',
      tenantId: 'team-id',
      userId: 'member-id',
      role: 'admin',
      joinedAt: new Date('2026-08-10T00:00:00.000Z'),
      removedAt,
    });

    expect(membership.reactivate(rejoinedAt)).toBe(true);
    expect(membership.toSnapshot()).toMatchObject({
      role: 'member',
      joinedAt: rejoinedAt,
      removedAt: null,
    });
  });
});
