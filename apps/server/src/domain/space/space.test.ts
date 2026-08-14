import { describe, expect, it } from 'vitest';

import { InvalidSpaceError, Space } from './space.js';

const CREATED_AT = new Date('2026-08-13T00:00:00.000Z');

describe('Space', () => {
  it('creates a personal space owned by a user', () => {
    expect(
      Space.createPersonal({
        id: 'personal-space-id',
        ownerUserId: 'user-id',
        createdAt: CREATED_AT,
      }).toSnapshot(),
    ).toEqual({
      id: 'personal-space-id',
      kind: 'personal',
      ownerUserId: 'user-id',
      ownerTeamId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it('creates a team space owned by a team', () => {
    expect(
      Space.createTeam({
        id: 'team-space-id',
        ownerTeamId: 'team-id',
        createdAt: CREATED_AT,
      }).toSnapshot(),
    ).toMatchObject({
      id: 'team-space-id',
      kind: 'team',
      ownerUserId: null,
      ownerTeamId: 'team-id',
    });
  });

  it.each([
    {
      kind: 'personal' as const,
      ownerUserId: null,
      ownerTeamId: null,
    },
    {
      kind: 'personal' as const,
      ownerUserId: 'user-id',
      ownerTeamId: 'team-id',
    },
    {
      kind: 'team' as const,
      ownerUserId: 'user-id',
      ownerTeamId: 'team-id',
    },
    {
      kind: 'team' as const,
      ownerUserId: null,
      ownerTeamId: null,
    },
    {
      kind: 'other' as never,
      ownerUserId: 'user-id',
      ownerTeamId: null,
    },
  ])('rejects an invalid kind and owner combination', (owner) => {
    expect(() =>
      Space.fromSnapshot({
        id: 'space-id',
        ...owner,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    ).toThrow(InvalidSpaceError);
  });
});
