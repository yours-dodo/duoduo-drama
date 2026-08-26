import {
  ObjectStorageObjectNotFoundError,
  type ObjectStorage,
} from '../../../platform/object-storage/object-storage.js';
import type { DatabaseClock } from '../../../platform/database/database-clock.js';
import type { ProjectCollaboratorRepository } from '../../story/ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../../story/ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import type {
  AssetRepository,
  AssetSnapshot,
} from '../ports/asset-repository.js';
import { requireAssetProjectEdit } from './asset-authorization.js';
import {
  AssetNotFoundError,
  AssetStateConflictError,
  AssetUploadExpiredError,
  AssetUploadMismatchError,
  AssetUploadMissingObjectError,
} from './asset-errors.js';
import { assetOutput } from './asset-output.js';

export class CompleteAssetUpload {
  constructor(
    private readonly assets: AssetRepository,
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly objectStorage: ObjectStorage,
    private readonly databaseClock: Pick<DatabaseClock, 'now'>,
  ) {}

  async execute(input: {
    tenantId: string | null;
    actorUserId: string;
    projectId: string;
    assetId: string;
  }) {
    await requireAssetProjectEdit({
      ...input,
      projects: this.projects,
      memberships: this.memberships,
      collaborators: this.collaborators,
    });
    const asset = await this.assets.findById(input);
    if (asset === null) throw new AssetNotFoundError();
    if (asset.status === 'uploaded') return { asset: assetOutput(asset) };
    if (asset.status !== 'pending_upload') {
      throw new AssetStateConflictError();
    }

    const now = await this.databaseClock.now();
    if (now >= asset.uploadExpiresAt) {
      await markFailed(this.assets, asset);
      throw new AssetUploadExpiredError();
    }

    let object: Awaited<ReturnType<ObjectStorage['headObject']>>;
    try {
      object = await this.objectStorage.headObject(asset.objectKey);
    } catch (error) {
      if (error instanceof ObjectStorageObjectNotFoundError) {
        await markFailed(this.assets, asset);
        throw new AssetUploadMissingObjectError();
      }
      throw error;
    }

    if (
      object.contentLength !== asset.byteSize ||
      (object.contentType !== undefined &&
        object.contentType !== asset.contentType)
    ) {
      await markFailed(this.assets, asset);
      throw new AssetUploadMismatchError();
    }

    const completed = await this.assets.transition({
      tenantId: asset.tenantId,
      projectId: asset.projectId,
      assetId: asset.id,
      from: 'pending_upload',
      to: 'uploaded',
      completedAt: now,
    });
    if (completed !== null) return { asset: assetOutput(completed) };

    const current = await this.assets.findById(input);
    if (current?.status === 'uploaded') return { asset: assetOutput(current) };
    throw new AssetStateConflictError();
  }
}

async function markFailed(
  assets: AssetRepository,
  asset: AssetSnapshot,
): Promise<void> {
  await assets.transition({
    tenantId: asset.tenantId,
    projectId: asset.projectId,
    assetId: asset.id,
    from: 'pending_upload',
    to: 'failed',
  });
}
