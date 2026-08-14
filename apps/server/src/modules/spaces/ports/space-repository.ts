import type { SpaceSnapshot } from '../../../domain/space/space.js';

export const SPACE_REPOSITORY = Symbol('SPACE_REPOSITORY');

export interface SpaceRepository {
  findPersonalByUserId(userId: string): Promise<SpaceSnapshot | null>;
  findTeamByTeamId(teamId: string): Promise<SpaceSnapshot | null>;
  create(space: SpaceSnapshot): Promise<SpaceSnapshot>;
  ensurePersonalForUser(input: {
    id: string;
    ownerUserId: string;
    createdAt: Date;
  }): Promise<SpaceSnapshot>;
}
