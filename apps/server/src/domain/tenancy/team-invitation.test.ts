import { describe, expect, it } from 'vitest';

import {
  TeamInvitation,
  TeamInvitationUnavailableError,
} from './team-invitation.js';

const CREATED_AT = new Date('2026-08-09T01:00:00.000Z');
const EXPIRES_AT = new Date('2026-08-16T01:00:00.000Z');

describe('TeamInvitation', () => {
  it('issues a pending invitation for one normalized email and team', () => {
    const invitation = issue().toSnapshot();

    expect(invitation).toEqual({
      id: 'invitation-id',
      tenantId: 'team-id',
      email: 'member@example.com',
      invitedByUserId: 'admin-id',
      tokenHash: 'a'.repeat(64),
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
    });
  });

  it('accepts only once when the authenticated email matches', () => {
    const invitation = issue();
    const acceptedAt = new Date('2026-08-10T01:00:00.000Z');

    expect(
      invitation.accept({
        userId: 'member-id',
        email: ' MEMBER@example.com ',
        at: acceptedAt,
      }),
    ).toBe(true);
    expect(invitation.toSnapshot()).toMatchObject({
      acceptedAt,
      acceptedByUserId: 'member-id',
    });
    expect(() =>
      invitation.accept({
        userId: 'member-id',
        email: 'member@example.com',
        at: acceptedAt,
      }),
    ).toThrow(TeamInvitationUnavailableError);
  });

  it.each([
    ['another@example.com', new Date('2026-08-10T01:00:00.000Z')],
    ['member@example.com', EXPIRES_AT],
  ])('rejects a mismatched or expired acceptance', (email, at) => {
    expect(() => issue().accept({ userId: 'member-id', email, at })).toThrow(
      TeamInvitationUnavailableError,
    );
  });

  it('cannot accept a revoked invitation', () => {
    const invitation = issue();
    invitation.revoke(new Date('2026-08-10T01:00:00.000Z'));

    expect(() =>
      invitation.accept({
        userId: 'member-id',
        email: 'member@example.com',
        at: new Date('2026-08-11T01:00:00.000Z'),
      }),
    ).toThrow(TeamInvitationUnavailableError);
  });
});

function issue(): TeamInvitation {
  return TeamInvitation.issue({
    id: 'invitation-id',
    tenantId: 'team-id',
    email: ' Member@Example.com ',
    invitedByUserId: 'admin-id',
    tokenHash: 'a'.repeat(64),
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
  });
}
