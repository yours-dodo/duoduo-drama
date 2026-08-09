import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp } from '../../../test/create-test-app.js';
import { ListAuditRecords } from '../../audit/application/list-audit-records.js';
import { SESSION_COOKIE_NAME } from '../../identity/http/session-auth.guard.js';
import { IDENTITY_TOKEN_SECURITY } from '../../identity/ports/identity-token-security.js';
import { SESSION_REPOSITORY } from '../../identity/ports/session-repository.js';
import { AcceptTeamInvitation } from '../application/accept-team-invitation.js';
import { ChangeTeamMemberRole } from '../application/change-team-member-role.js';
import { CreateTeamInvitation } from '../application/create-team-invitation.js';
import { ListTeamInvitations } from '../application/list-team-invitations.js';
import { ListTeamMembers } from '../application/list-team-members.js';
import { RemoveTeamMember } from '../application/remove-team-member.js';
import { RevokeTeamInvitation } from '../application/revoke-team-invitation.js';
import {
  TeamAdministratorRequiredError,
  TeamInvitationNotFoundError,
} from '../application/tenancy-errors.js';
import { TEAM_MEMBERSHIP_REPOSITORY } from '../ports/team-membership-repository.js';

const TEAM_ID = '10000000-0000-4000-8000-000000000001';
const MEMBERSHIP_ID = '20000000-0000-4000-8000-000000000001';
const INVITATION_ID = '30000000-0000-4000-8000-000000000001';
const SESSION_TOKEN = 's'.repeat(43);
const NOW = new Date('2026-08-10T05:00:00.000Z');

describe('team lifecycle HTTP API', () => {
  let app: INestApplication;
  let useCases: Record<string, { execute: ReturnType<typeof vi.fn> }>;

  beforeEach(async () => {
    useCases = {
      createInvitation: executable({
        invitation: {
          id: INVITATION_ID,
          email: 'member@example.com',
          status: 'pending',
          createdAt: NOW,
          expiresAt: new Date('2026-08-17T05:00:00.000Z'),
        },
      }),
      acceptInvitation: executable({
        membership: {
          id: MEMBERSHIP_ID,
          tenantId: TEAM_ID,
          role: 'member',
          joinedAt: NOW,
        },
      }),
      listMembers: executable({ items: [], next: null }),
      changeRole: executable({
        membership: {
          id: MEMBERSHIP_ID,
          userId: 'member-id',
          role: 'admin',
          joinedAt: NOW,
        },
      }),
      removeMember: executable(undefined),
      listInvitations: executable({ items: [], next: null }),
      revokeInvitation: executable(undefined),
      listAudit: executable({ items: [], next: null }),
    };
    const memberships = {
      findActive: vi.fn(async () => ({
        id: 'admin-membership-id',
        tenantId: TEAM_ID,
        userId: 'admin-id',
        role: 'admin',
        joinedAt: NOW,
        removedAt: null,
      })),
    };

    app = await createTestApp({
      providerOverrides: [
        { token: CreateTeamInvitation, value: useCases.createInvitation },
        { token: AcceptTeamInvitation, value: useCases.acceptInvitation },
        { token: ListTeamMembers, value: useCases.listMembers },
        { token: ChangeTeamMemberRole, value: useCases.changeRole },
        { token: RemoveTeamMember, value: useCases.removeMember },
        { token: ListTeamInvitations, value: useCases.listInvitations },
        { token: RevokeTeamInvitation, value: useCases.revokeInvitation },
        { token: ListAuditRecords, value: useCases.listAudit },
        { token: TEAM_MEMBERSHIP_REPOSITORY, value: memberships },
        {
          token: SESSION_REPOSITORY,
          value: {
            findActiveByTokenHash: vi.fn(async () => ({
              id: 'session-id',
              userId: 'admin-id',
              email: 'admin@example.com',
              expiresAt: new Date('2026-09-10T00:00:00.000Z'),
            })),
          },
        },
        {
          token: IDENTITY_TOKEN_SECURITY,
          value: { hashSessionToken: vi.fn(() => 'session-hash') },
        },
      ],
    });
  });

  afterEach(async () => {
    await app?.close();
  });

  it('exposes bounded member, invitation, acceptance, and audit resources', async () => {
    const auth = (builder: request.Test) =>
      builder.set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`);
    const write = (builder: request.Test) =>
      auth(builder).set('Origin', 'http://localhost:3000');

    await auth(request(app.getHttpServer()).get(`/v1/teams/${TEAM_ID}/members`))
      .query({ limit: 25 })
      .expect(200, { items: [], nextCursor: null });
    await write(
      request(app.getHttpServer()).patch(
        `/v1/teams/${TEAM_ID}/members/${MEMBERSHIP_ID}`,
      ),
    )
      .send({ role: 'admin' })
      .expect(200);
    await write(
      request(app.getHttpServer()).delete(
        `/v1/teams/${TEAM_ID}/members/${MEMBERSHIP_ID}`,
      ),
    ).expect(204);

    await write(
      request(app.getHttpServer()).post(`/v1/teams/${TEAM_ID}/invitations`),
    )
      .set('Idempotency-Key', 'invite-key')
      .send({ email: 'member@example.com' })
      .expect(201);
    await auth(
      request(app.getHttpServer()).get(`/v1/teams/${TEAM_ID}/invitations`),
    ).expect(200, { items: [], nextCursor: null });
    await write(
      request(app.getHttpServer()).delete(
        `/v1/teams/${TEAM_ID}/invitations/${INVITATION_ID}`,
      ),
    ).expect(204);

    await write(
      request(app.getHttpServer()).post('/v1/team-invitation-acceptances'),
    )
      .send({ token: 't'.repeat(43) })
      .expect(201);
    await auth(
      request(app.getHttpServer()).get(`/v1/teams/${TEAM_ID}/audit-records`),
    ).expect(200, { items: [], nextCursor: null });

    expect(useCases.createInvitation.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TEAM_ID,
        actorUserId: 'admin-id',
        email: 'member@example.com',
        idempotencyKey: 'invite-key',
      }),
    );
    expect(useCases.acceptInvitation.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-id',
        actorEmail: 'admin@example.com',
        token: 't'.repeat(43),
      }),
    );
  });

  it('maps authorization and opaque invitation failures to stable errors', async () => {
    useCases.listMembers.execute.mockRejectedValueOnce(
      new TeamAdministratorRequiredError(),
    );
    const forbidden = await request(app.getHttpServer())
      .get(`/v1/teams/${TEAM_ID}/members`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('x-request-id', 'forbidden-request')
      .expect(403);
    expect(forbidden.body.error.code).toBe('TEAM_ADMINISTRATOR_REQUIRED');

    useCases.acceptInvitation.execute.mockRejectedValueOnce(
      new TeamInvitationNotFoundError(),
    );
    const unavailable = await request(app.getHttpServer())
      .post('/v1/team-invitation-acceptances')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('Origin', 'http://localhost:3000')
      .set('x-request-id', 'unavailable-request')
      .send({ token: 'u'.repeat(43) })
      .expect(404);
    expect(unavailable.body.error.code).toBe('TEAM_INVITATION_NOT_FOUND');
  });

  it('rejects unbounded pages and malformed opaque cursors', async () => {
    await request(app.getHttpServer())
      .get(`/v1/teams/${TEAM_ID}/members`)
      .query({ limit: 101 })
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .expect(400);

    const invalidCursor = await request(app.getHttpServer())
      .get(`/v1/teams/${TEAM_ID}/members`)
      .query({ cursor: 'not-a-cursor' })
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('x-request-id', 'cursor-request')
      .expect(400);
    expect(invalidCursor.body.error).toMatchObject({
      code: 'INVALID_CURSOR',
      requestId: 'cursor-request',
    });
  });
});

function executable(result: unknown) {
  return { execute: vi.fn(async () => result) };
}
