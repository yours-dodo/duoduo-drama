import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';

import {
  OBJECT_STORAGE_CONFIG,
  type ObjectStorageConfig,
} from '../../config/server-config.js';
import { DatabaseClock } from '../../platform/database/database-clock.js';
import { DatabaseModule } from '../../platform/database/database.module.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../platform/object-storage/object-storage.js';
import { ObjectStorageModule } from '../../platform/object-storage/object-storage.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { StoryModule } from '../story/story.module.js';
import {
  PROJECT_COLLABORATOR_REPOSITORY,
  type ProjectCollaboratorRepository,
} from '../story/ports/project-collaborator-repository.js';
import {
  STORY_PROJECT_REPOSITORY,
  type StoryProjectRepository,
} from '../story/ports/story-project-repository.js';
import {
  TEAM_MEMBERSHIP_REPOSITORY,
  type TeamMembershipRepository,
} from '../tenancy/ports/team-membership-repository.js';
import { CompleteAssetUpload } from './application/complete-asset-upload.js';
import { CreateAssetUploadUrl } from './application/create-asset-upload-url.js';
import { DeleteAsset } from './application/delete-asset.js';
import { ListProjectAssets } from './application/list-project-assets.js';
import { AssetsController } from './http/assets.controller.js';
import { PrismaAssetRepository } from './infrastructure/prisma-asset.repository.js';
import {
  ASSET_REPOSITORY,
  type AssetRepository,
} from './ports/asset-repository.js';

@Module({
  imports: [DatabaseModule, IdentityModule, ObjectStorageModule, StoryModule],
  controllers: [AssetsController],
  providers: [
    PrismaAssetRepository,
    { provide: ASSET_REPOSITORY, useExisting: PrismaAssetRepository },
    {
      provide: CreateAssetUploadUrl,
      inject: [
        ASSET_REPOSITORY,
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        OBJECT_STORAGE,
        OBJECT_STORAGE_CONFIG,
        DatabaseClock,
      ],
      useFactory: (
        assets: AssetRepository,
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        objectStorage: ObjectStorage,
        objectStorageConfig: ObjectStorageConfig,
        databaseClock: DatabaseClock,
      ) =>
        new CreateAssetUploadUrl(
          assets,
          projects,
          memberships,
          collaborators,
          objectStorage,
          objectStorageConfig,
          databaseClock,
          ids(),
        ),
    },
    {
      provide: CompleteAssetUpload,
      inject: [
        ASSET_REPOSITORY,
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        OBJECT_STORAGE,
        DatabaseClock,
      ],
      useFactory: (
        assets: AssetRepository,
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        objectStorage: ObjectStorage,
        databaseClock: DatabaseClock,
      ) =>
        new CompleteAssetUpload(
          assets,
          projects,
          memberships,
          collaborators,
          objectStorage,
          databaseClock,
        ),
    },
    {
      provide: ListProjectAssets,
      inject: [
        ASSET_REPOSITORY,
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
      ],
      useFactory: (
        assets: AssetRepository,
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
      ) => new ListProjectAssets(assets, projects, memberships, collaborators),
    },
    {
      provide: DeleteAsset,
      inject: [
        ASSET_REPOSITORY,
        STORY_PROJECT_REPOSITORY,
        TEAM_MEMBERSHIP_REPOSITORY,
        PROJECT_COLLABORATOR_REPOSITORY,
        OBJECT_STORAGE,
      ],
      useFactory: (
        assets: AssetRepository,
        projects: StoryProjectRepository,
        memberships: TeamMembershipRepository,
        collaborators: ProjectCollaboratorRepository,
        objectStorage: ObjectStorage,
      ) =>
        new DeleteAsset(
          assets,
          projects,
          memberships,
          collaborators,
          objectStorage,
        ),
    },
  ],
})
export class AssetsModule {}

function ids() {
  return { create: () => randomUUID() };
}
