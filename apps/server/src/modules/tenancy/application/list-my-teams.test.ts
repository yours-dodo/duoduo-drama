import { describe, expect, it, vi } from 'vitest';

import { ListMyTeams } from './list-my-teams.js';
import type { TeamRepository } from '../ports/team-repository.js';

describe('ListMyTeams', () => {
  it('returns every active team membership without storing a current team', async () => {
    const teams: TeamRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      listForUser: vi.fn(async () => [
        {
          id: 'team-one',
          name: '团队一',
          role: 'admin',
          createdAt: new Date('2026-08-10T00:00:00.000Z'),
        },
        {
          id: 'team-two',
          name: '团队二',
          role: 'member',
          createdAt: new Date('2026-08-11T00:00:00.000Z'),
        },
      ]),
    };

    const result = await new ListMyTeams(teams).execute({ userId: 'user-id' });

    expect(teams.listForUser).toHaveBeenCalledWith('user-id');
    expect(result).toEqual({
      teams: [
        {
          id: 'team-one',
          name: '团队一',
          role: 'admin',
          createdAt: new Date('2026-08-10T00:00:00.000Z'),
        },
        {
          id: 'team-two',
          name: '团队二',
          role: 'member',
          createdAt: new Date('2026-08-11T00:00:00.000Z'),
        },
      ],
    });
  });
});
