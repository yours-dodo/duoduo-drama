import type { ObjectStorage } from '../../../platform/object-storage/object-storage.js';
import type { ObjectStorageConfig } from '../../../config/server-config.js';
import type { DatabaseClock } from '../../../platform/database/database-clock.js';
import type { ProjectCollaboratorRepository } from '../../story/ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../../story/ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import type { AssetRepository } from '../ports/asset-repository.js';
import { assetOutput } from './asset-output.js';
import { assetObjectKey, validateAssetUpload } from './asset-upload-policy.js';
import { requireAssetProjectEdit } from './asset-authorization.js';

export class CreateAssetUploadUrl {
  constructor(
    private readonly assets: AssetRepository,
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly objectStorage: ObjectStorage,
    private readonly objectStorageConfig: ObjectStorageConfig,
    private readonly databaseClock: Pick<DatabaseClock, 'now'>,
    private readonly ids: { create(): string },
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    fileName: string;
    contentType: string;
    byteSize: number;
  }) {
    await requireAssetProjectEdit({
      ...input,
      projects: this.projects,
      memberships: this.memberships,
      collaborators: this.collaborators,
    });
    const upload = validateAssetUpload(input);
    const now = await this.databaseClock.now();
    const assetId = this.ids.create();
    const asset = await this.assets.create({
      id: assetId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      uploadedByUserId: input.actorUserId,
      objectKey: assetObjectKey({
        tenantId: input.tenantId,
        projectId: input.projectId,
        assetId,
      }),
      originalFileName: upload.fileName,
      contentType: upload.contentType,
      byteSize: upload.byteSize,
      checksum: null,
      status: 'pending_upload',
      uploadExpiresAt: new Date(
        now.getTime() + this.objectStorageConfig.presignedUrlTtlSeconds * 1000,
      ),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const signed = await this.objectStorage.createUploadUrl({
        objectKey: asset.objectKey,
        contentType: asset.contentType,
        contentLength: asset.byteSize,
        expiresInSeconds: this.objectStorageConfig.presignedUrlTtlSeconds,
      });
      return {
        asset: assetOutput(asset),
        uploadUrl: signed.url,
        expiresAt: signed.expiresAt,
        requiredHeaders: signed.requiredHeaders,
      };
    } catch (error) {
      await this.assets.transition({
        tenantId: asset.tenantId,
        projectId: asset.projectId,
        assetId: asset.id,
        from: 'pending_upload',
        to: 'failed',
      });
      throw error;
    }
  }
}
