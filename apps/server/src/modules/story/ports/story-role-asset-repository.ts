import type { StoryRoleAssetSnapshot } from '../../../domain/story/story-role-asset.js';

export const STORY_ROLE_ASSET_REPOSITORY = Symbol(
  'STORY_ROLE_ASSET_REPOSITORY',
);

export interface StoryRoleAssetRepository {
  create(role: StoryRoleAssetSnapshot): Promise<StoryRoleAssetSnapshot>;
  update(role: StoryRoleAssetSnapshot): Promise<StoryRoleAssetSnapshot>;
  findById(request: {
    tenantId: string | null;
    projectId: string;
    roleId: string;
  }): Promise<StoryRoleAssetSnapshot | null>;
  findByIdLocked(request: {
    tenantId: string | null;
    projectId: string;
    roleId: string;
  }): Promise<StoryRoleAssetSnapshot | null>;
  listByProject(request: {
    tenantId: string | null;
    projectId: string;
  }): Promise<StoryRoleAssetSnapshot[]>;
}

export const STORY_ROLE_ASSET_REFERENCE_REPOSITORY = Symbol(
  'STORY_ROLE_ASSET_REFERENCE_REPOSITORY',
);

export interface StoryRoleAssetReferenceRepository {
  hasReferences(request: {
    tenantId: string | null;
    projectId: string;
    roleId: string;
  }): Promise<boolean>;
}
