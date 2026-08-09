import { describe, expect, it, vi } from 'vitest';

import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { ListTeamInvitations } from './list-team-invitations.js';
import { RevokeTeamInvitation } from './revoke-team-invitation.js';
import {
  TeamAdministratorRequiredError,
  TeamInvitationCannotBeRevokedError,
  TeamInvitationNotFoundError,
} from './tenancy-errors.js';

const NOW = new Date('2026-08-10T04:00:00.000Z');

describe('team invitation management', () => {
  it('revokes a pending invitation and records the transition', async () => {
    const fixture = buildFixture();

    await expect(
      revokeUseCase(fixture).execute(input()),
    ).resolves.toBeUndefined();
    expect(fixture.invitations.update).toHaveBeenCalledWith(
      expect.objectContaining({ revokedAt: NOW }),
    );
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEAM_INVITATION_REVOKED',
        targetId: 'invitation-id',
      }),
    );
  });

  it('makes repeated revocation safe but rejects accepted or unknown invitations', async () => {
    const revoked = buildFixture({
      invitation: invitation({ revokedAt: NOW }),
    });
    await expect(
      revokeUseCase(revoked).execute(input()),
    ).resolves.toBeUndefined();
    expect(revoked.audit.record).not.toHaveBeenCalled();

    const accepted = buildFixture({
      invitation: invitation({
        acceptedAt: NOW,
        acceptedByUserId: 'member-id',
      }),
    });
    await expect(
      revokeUseCase(accepted).execute(input()),
    ).rejects.toBeInstanceOf(TeamInvitationCannotBeRevokedError);

    const missing = buildFixture({ invitation: null });
    await expect(
      revokeUseCase(missing).execute(input()),
    ).rejects.toBeInstanceOf(TeamInvitationNotFoundError);
  });

  it('lists status-projected invitations only for administrators', async () => {
    const fixture = buildFixture();
    const list = new ListTeamInvitations(
      fixture.memberships as never,
      fixture.invitations as never,
      fixture.clock,
    );
    await expect(
      list.execute({
        tenantId: 'team-id',
        actorUserId: 'admin-id',
        page: { limit: 50, after: null },
      }),
    ).resolves.toMatchObject({
      items: [{ id: 'invitation-id', status: 'pending' }],
      next: null,
    });

    fixture.memberships.findActive.mockResolvedValueOnce({
      ...membership(),
      role: 'member',
    });
    await expect(
      list.execute({
        tenantId: 'team-id',
        actorUserId: 'admin-id',
        page: { limit: 50, after: null },
      }),
    ).rejects.toBeInstanceOf(TeamAdministratorRequiredError);
  });
});

function input() {
  return {
    tenantId: 'team-id',
    actorUserId: 'admin-id',
    invitationId: 'invitation-id',
    requestId: 'request-id',
  };
}

function membership() {
  return {
    id: 'admin-membership-id',
    tenantId: 'team-id',
    userId: 'admin-id',
    role: 'admin' as const,
    joinedAt: NOW,
    removedAt: null,
  };
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invitation-id',
    tenantId: 'team-id',
    email: 'member@example.com',
    invitedByUserId: 'admin-id',
    tokenHash: 'd'.repeat(64),
    createdAt: new Date('2026-08-09T04:00:00.000Z'),
    expiresAt: new Date('2026-08-16T04:00:00.000Z'),
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
    ...overrides,
  };
}

function buildFixture(
  options: {
    invitation?: ReturnType<typeof invitation> | null;
  } = {},
) {
  const memberships = {
    lockAdministration: vi.fn(async () => undefined),
    findActive: vi.fn(async () => membership()),
  };
  const selected =
    options.invitation === undefined ? invitation() : options.invitation;
  const invitations = {
    findByIdLocked: vi.fn(async () => selected),
    update: vi.fn(async (value) => value),
    listForTenant: vi.fn(async () => ({
      items: selected === null ? [] : [selected],
      next: null,
    })),
  };
  const audit: AuditRepository & { record: ReturnType<typeof vi.fn> } = {
    record: vi.fn(async () => undefined),
  };
  const clock = { now: vi.fn(async () => NOW) };
  return {
    memberships,
    invitations,
    audit,
    clock,
    transactions: {
      run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    },
    ids: { create: vi.fn(() => 'audit-id') },
  };
}

function revokeUseCase(fixture: ReturnType<typeof buildFixture>) {
  return new RevokeTeamInvitation(
    fixture.memberships as never,
    fixture.invitations as never,
    fixture.audit,
    fixture.transactions,
    fixture.clock,
    fixture.ids,
  );
}
