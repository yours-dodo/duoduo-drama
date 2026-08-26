import type { ObjectStorage } from '../../../platform/object-storage/object-storage.js';
import type { ObjectStorageConfig } from '../../../config/server-config.js';
import type { ProjectCollaboratorRepository } from '../../story/ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../../story/ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import type { AssetRepository } from '../ports/asset-repository.js';
import { requireAssetProjectView } from './asset-authorization.js';
import { AssetNotFoundError, AssetStateConflictError } from './asset-errors.js';
import { assetOutput } from './asset-output.js';

export class CreateAssetDownloadUrl {
  constructor(
    private readonly assets: AssetRepository,
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly objectStorage: ObjectStorage,
    private readonly objectStorageConfig: ObjectStorageConfig,
  ) {}

  async execute(input: {
    tenantId: string | null;
    actorUserId: string;
    projectId: string;
    assetId: string;
  }) {
    await requireAssetProjectView({
      ...input,
      projects: this.projects,
      memberships: this.memberships,
      collaborators: this.collaborators,
    });
    const asset = await this.assets.findById(input);
    if (asset === null) throw new AssetNotFoundError();
    if (asset.status !== 'uploaded') throw new AssetStateConflictError();

    const signed = await this.objectStorage.createDownloadUrl({
      objectKey: asset.objectKey,
      expiresInSeconds: this.objectStorageConfig.presignedUrlTtlSeconds,
    });
    return {
      asset: assetOutput(asset),
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt,
    };
  }
}
