import type { ObjectStorage } from '../../../platform/object-storage/object-storage.js';
import type { ProjectCollaboratorRepository } from '../../story/ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../../story/ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import type { AssetRepository } from '../ports/asset-repository.js';
import { requireAssetProjectEdit } from './asset-authorization.js';
import {
  AssetInUseError,
  AssetNotFoundError,
  AssetStateConflictError,
} from './asset-errors.js';
import { assetOutput } from './asset-output.js';

export class DeleteAsset {
  constructor(
    private readonly assets: AssetRepository,
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly objectStorage: ObjectStorage,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
  ) {}

  async execute(input: {
    tenantId: string | null;
    actorUserId: string;
    projectId: string;
    assetId: string;
  }) {
    return this.transactions.run(async () => {
      await requireAssetProjectEdit({
        ...input,
        lock: true,
        projects: this.projects,
        memberships: this.memberships,
        collaborators: this.collaborators,
      });
      const asset = await this.assets.findById(input);
      if (asset === null) throw new AssetNotFoundError();
      if (asset.status === 'deleted') return { asset: assetOutput(asset) };
      if (await this.assets.hasRoleReferences(input)) {
        throw new AssetInUseError();
      }

      await this.objectStorage.deleteObject(asset.objectKey);
      const deleted = await this.assets.transition({
        tenantId: asset.tenantId,
        projectId: asset.projectId,
        assetId: asset.id,
        from: ['pending_upload', 'uploaded', 'failed'],
        to: 'deleted',
      });
      if (deleted !== null) return { asset: assetOutput(deleted) };

      const current = await this.assets.findById(input);
      if (current?.status === 'deleted') return { asset: assetOutput(current) };
      throw new AssetStateConflictError();
    });
  }
}
