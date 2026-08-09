import { describe, expect, it, vi } from 'vitest';

import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import {
  CreateTeamInvitation,
  IdempotencyConflictError,
} from './create-team-invitation.js';
import {
  TeamAdministratorRequiredError,
  TeamInvitationAlreadyPendingError,
} from './tenancy-errors.js';

const NOW = new Date('2026-08-09T02:00:00.000Z');
const EXPIRES_AT = new Date('2026-08-16T02:00:00.000Z');

describe('CreateTeamInvitation', () => {
  it('atomically creates an invitation and delivers only its raw token', async () => {
    const fixture = buildFixture();

    const result = await fixture.useCase.execute({
      tenantId: 'team-id',
      actorUserId: 'admin-id',
      email: ' Member@Example.com ',
      idempotencyKey: 'invite-key',
      requestId: 'request-id',
    });

    expect(result.invitation).toEqual({
      id: 'invitation-id',
      email: 'member@example.com',
      status: 'pending',
      expiresAt: EXPIRES_AT,
      createdAt: NOW,
    });
    expect(fixture.transactions.run).toHaveBeenCalledOnce();
    expect(fixture.invitations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: 'b'.repeat(64),
        email: 'member@example.com',
      }),
    );
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEAM_INVITATION_CREATED',
        targetType: 'TEAM_INVITATION',
        targetId: 'invitation-id',
      }),
    );
    expect(fixture.delivery.deliver).toHaveBeenCalledWith({
      email: 'member@example.com',
      tenantId: 'team-id',
      token: 'raw-invitation-token',
      expiresAt: EXPIRES_AT,
    });
  });

  it('rejects ordinary members and existing active invitations', async () => {
    const ordinary = buildFixture({ actorRole: 'member' });
    await expect(ordinary.useCase.execute(input())).rejects.toBeInstanceOf(
      TeamAdministratorRequiredError,
    );
    expect(ordinary.invitations.create).not.toHaveBeenCalled();

    const duplicate = buildFixture({
      pendingInvitation: invitationSnapshot(),
    });
    await expect(duplicate.useCase.execute(input())).rejects.toBeInstanceOf(
      TeamInvitationAlreadyPendingError,
    );
    expect(duplicate.invitations.create).not.toHaveBeenCalled();
  });

  it('replays the same idempotent result and rejects a different request', async () => {
    const replay = buildFixture({
      idempotencyRecord: {
        id: 'idempotency-id',
        tenantId: 'team-id',
        scopeKey: 'tenant:team-id:user:admin-id',
        operationType: 'CREATE_TEAM_INVITATION',
        idempotencyKey: 'invite-key',
        requestHash: 'request-hash',
        resultId: 'invitation-id',
        createdAt: NOW,
      },
      existingInvitation: invitationSnapshot(),
    });
    await expect(replay.useCase.execute(input())).resolves.toMatchObject({
      invitation: { id: 'invitation-id' },
    });
    expect(replay.invitations.create).not.toHaveBeenCalled();
    expect(replay.delivery.deliver).not.toHaveBeenCalled();

    replay.fingerprint.hash.mockReturnValueOnce('different-request-hash');
    await expect(replay.useCase.execute(input())).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
  });
});

function input() {
  return {
    tenantId: 'team-id',
    actorUserId: 'admin-id',
    email: 'member@example.com',
    idempotencyKey: 'invite-key',
    requestId: 'request-id',
  };
}

function invitationSnapshot() {
  return {
    id: 'invitation-id',
    tenantId: 'team-id',
    email: 'member@example.com',
    invitedByUserId: 'admin-id',
    tokenHash: 'b'.repeat(64),
    createdAt: NOW,
    expiresAt: EXPIRES_AT,
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
  };
}

function buildFixture(
  options: {
    actorRole?: 'admin' | 'member';
    pendingInvitation?: ReturnType<typeof invitationSnapshot> | null;
    idempotencyRecord?: Record<string, unknown> | null;
    existingInvitation?: ReturnType<typeof invitationSnapshot> | null;
  } = {},
) {
  const memberships = {
    lockAdministration: vi.fn(async () => undefined),
    findActive: vi.fn(async () => ({
      id: 'admin-membership-id',
      tenantId: 'team-id',
      userId: 'admin-id',
      role: options.actorRole ?? 'admin',
      joinedAt: NOW,
      removedAt: null,
    })),
    findActiveByEmail: vi.fn(async () => null),
  };
  const invitations = {
    findPendingByEmailLocked: vi.fn(
      async () => options.pendingInvitation ?? null,
    ),
    findById: vi.fn(async () => options.existingInvitation ?? null),
    create: vi.fn(async (value) => value),
    update: vi.fn(async (value) => value),
  };
  const idempotency = {
    findLocked: vi.fn(async () => options.idempotencyRecord ?? null),
    create: vi.fn(async (value) => value),
  };
  const audit: AuditRepository & { record: ReturnType<typeof vi.fn> } = {
    record: vi.fn(async () => undefined),
  };
  const transactions = {
    run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
  };
  const fingerprint = { hash: vi.fn(() => 'request-hash') };
  const security = {
    issueToken: vi.fn(() => 'raw-invitation-token'),
    hashToken: vi.fn(() => 'b'.repeat(64)),
  };
  const delivery = { deliver: vi.fn(async () => undefined) };
  const ids = {
    create: vi
      .fn()
      .mockReturnValueOnce('invitation-id')
      .mockReturnValueOnce('idempotency-id')
      .mockReturnValueOnce('audit-id'),
  };
  const useCase = new CreateTeamInvitation(
    memberships as never,
    invitations as never,
    idempotency as never,
    audit,
    transactions,
    { now: vi.fn(async () => NOW) },
    fingerprint,
    security,
    delivery,
    ids,
  );

  return {
    useCase,
    memberships,
    invitations,
    audit,
    transactions,
    fingerprint,
    delivery,
  };
}
