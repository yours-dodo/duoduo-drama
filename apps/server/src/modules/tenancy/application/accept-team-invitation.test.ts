import { describe, expect, it, vi } from 'vitest';

import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { AcceptTeamInvitation } from './accept-team-invitation.js';
import {
  TeamInvitationNotFoundError,
  TeamMemberAlreadyActiveError,
} from './tenancy-errors.js';

const NOW = new Date('2026-08-10T02:00:00.000Z');

describe('AcceptTeamInvitation', () => {
  it('atomically consumes a matching invitation and creates membership', async () => {
    const fixture = buildFixture();

    await expect(
      fixture.useCase.execute({
        actorUserId: 'member-id',
        actorEmail: ' Member@Example.com ',
        token: 'raw-token',
        requestId: 'request-id',
      }),
    ).resolves.toEqual({
      membership: {
        id: 'membership-id',
        tenantId: 'team-id',
        role: 'member',
        joinedAt: NOW,
      },
    });

    expect(fixture.security.hashToken).toHaveBeenCalledWith('raw-token');
    expect(fixture.memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'member-id', role: 'member' }),
    );
    expect(fixture.invitations.update).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedByUserId: 'member-id',
        acceptedAt: NOW,
      }),
    );
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEAM_MEMBER_JOINED',
        targetId: 'membership-id',
      }),
    );
  });

  it('returns the same not-found result for invalid, expired, or mismatched invitations', async () => {
    const missing = buildFixture({ invitation: null });
    await expect(missing.useCase.execute(input())).rejects.toBeInstanceOf(
      TeamInvitationNotFoundError,
    );

    const mismatch = buildFixture();
    await expect(
      mismatch.useCase.execute({ ...input(), actorEmail: 'other@example.com' }),
    ).rejects.toBeInstanceOf(TeamInvitationNotFoundError);
  });

  it('reactivates a removed membership but rejects an active one', async () => {
    const removed = buildFixture({
      existingMembership: {
        id: 'old-membership-id',
        tenantId: 'team-id',
        userId: 'member-id',
        role: 'admin',
        joinedAt: new Date('2026-01-01T00:00:00.000Z'),
        removedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });
    await expect(removed.useCase.execute(input())).resolves.toMatchObject({
      membership: { id: 'old-membership-id', role: 'member' },
    });
    expect(removed.memberships.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'old-membership-id',
        joinedAt: NOW,
        removedAt: null,
      }),
    );
    expect(removed.memberships.create).not.toHaveBeenCalled();

    const active = buildFixture({
      existingMembership: {
        id: 'active-membership-id',
        tenantId: 'team-id',
        userId: 'member-id',
        role: 'member',
        joinedAt: NOW,
        removedAt: null,
      },
    });
    await expect(active.useCase.execute(input())).rejects.toBeInstanceOf(
      TeamMemberAlreadyActiveError,
    );
  });
});

function input() {
  return {
    actorUserId: 'member-id',
    actorEmail: 'member@example.com',
    token: 'raw-token',
    requestId: 'request-id',
  };
}

function invitationSnapshot() {
  return {
    id: 'invitation-id',
    tenantId: 'team-id',
    email: 'member@example.com',
    invitedByUserId: 'admin-id',
    tokenHash: 'c'.repeat(64),
    createdAt: new Date('2026-08-09T02:00:00.000Z'),
    expiresAt: new Date('2026-08-16T02:00:00.000Z'),
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
  };
}

function buildFixture(
  options: {
    invitation?: ReturnType<typeof invitationSnapshot> | null;
    existingMembership?: Record<string, unknown> | null;
  } = {},
) {
  const invitations = {
    findByTokenHashLocked: vi.fn(async () =>
      options.invitation === undefined
        ? invitationSnapshot()
        : options.invitation,
    ),
    update: vi.fn(async (value) => value),
  };
  const memberships = {
    findByUserLocked: vi.fn(async () => options.existingMembership ?? null),
    create: vi.fn(async (value) => value),
    update: vi.fn(async (value) => value),
  };
  const audit: AuditRepository & { record: ReturnType<typeof vi.fn> } = {
    record: vi.fn(async () => undefined),
  };
  const security = { hashToken: vi.fn(() => 'c'.repeat(64)) };
  const useCase = new AcceptTeamInvitation(
    invitations as never,
    memberships as never,
    audit,
    {
      run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    },
    { now: vi.fn(async () => NOW) },
    security as never,
    { create: vi.fn(() => 'membership-id') },
  );

  return { useCase, invitations, memberships, audit, security };
}
