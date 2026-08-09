import { describe, expect, it } from 'vitest';

import { InvalidTeamNameError, Team } from './team.js';

describe('Team', () => {
  it('creates a tenant team with a normalized display name', () => {
    const createdAt = new Date('2026-08-10T00:00:00.000Z');
    const team = Team.create({
      id: 'team-id',
      name: '  多多   编剧组  ',
      createdByUserId: 'user-id',
      createdAt,
    });

    expect(team.toSnapshot()).toEqual({
      id: 'team-id',
      name: '多多 编剧组',
      createdByUserId: 'user-id',
      createdAt,
      updatedAt: createdAt,
    });
  });

  it.each(['', '   ', 'a'.repeat(101)])(
    'rejects an invalid team name',
    (name) => {
      expect(() =>
        Team.create({
          id: 'team-id',
          name,
          createdByUserId: 'user-id',
          createdAt: new Date('2026-08-10T00:00:00.000Z'),
        }),
      ).toThrow(InvalidTeamNameError);
    },
  );
});
