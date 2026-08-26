import type { StoryRoleAssetSnapshot } from '../../../domain/story/story-role-asset.js';
import type { ObjectStorageConfig } from '../../../config/server-config.js';
import type { ObjectStorage } from '../../../platform/object-storage/object-storage.js';
import type { AssetRepository } from '../../assets/ports/asset-repository.js';
import {
  StoryRoleAssetCoverUnavailableError,
  StoryRoleAssetViewUnavailableError,
} from './story-errors.js';

export interface StoryRoleAssetOutputDependencies {
  assets: AssetRepository;
  objectStorage: ObjectStorage;
  objectStorageConfig: Pick<ObjectStorageConfig, 'presignedUrlTtlSeconds'>;
}

export async function storyRoleAssetOutput(
  role: StoryRoleAssetSnapshot,
  dependencies?: StoryRoleAssetOutputDependencies,
) {
  let coverAsset: {
    id: string;
    originalFileName: string;
    contentType: string;
    byteSize: number;
    downloadUrl: string;
    downloadUrlExpiresAt: string;
  } | null = null;
  let viewAsset: {
    id: string;
    originalFileName: string;
    contentType: string;
    byteSize: number;
    downloadUrl: string;
    downloadUrlExpiresAt: string;
  } | null = null;
  if (
    role.coverAssetId !== null &&
    role.coverAssetId !== undefined &&
    dependencies !== undefined
  ) {
    const asset = await dependencies.assets.findById({
      tenantId: role.tenantId,
      projectId: role.projectId,
      assetId: role.coverAssetId,
    });
    if (asset?.status === 'uploaded') {
      const signed = await dependencies.objectStorage.createDownloadUrl({
        objectKey: asset.objectKey,
        expiresInSeconds:
          dependencies.objectStorageConfig.presignedUrlTtlSeconds,
      });
      coverAsset = {
        id: asset.id,
        originalFileName: asset.originalFileName,
        contentType: asset.contentType,
        byteSize: asset.byteSize,
        downloadUrl: signed.url,
        downloadUrlExpiresAt: signed.expiresAt,
      };
    } else {
      throw new StoryRoleAssetCoverUnavailableError();
    }
  } else if (
    role.coverAssetId !== null &&
    role.coverAssetId !== undefined
  ) {
    throw new StoryRoleAssetCoverUnavailableError();
  }
  if (
    role.viewAssetId !== null &&
    role.viewAssetId !== undefined &&
    dependencies !== undefined
  ) {
    const asset = await dependencies.assets.findById({
      tenantId: role.tenantId,
      projectId: role.projectId,
      assetId: role.viewAssetId,
    });
    if (asset?.status === 'uploaded') {
      const signed = await dependencies.objectStorage.createDownloadUrl({
        objectKey: asset.objectKey,
        expiresInSeconds:
          dependencies.objectStorageConfig.presignedUrlTtlSeconds,
      });
      viewAsset = {
        id: asset.id,
        originalFileName: asset.originalFileName,
        contentType: asset.contentType,
        byteSize: asset.byteSize,
        downloadUrl: signed.url,
        downloadUrlExpiresAt: signed.expiresAt,
      };
    } else {
      throw new StoryRoleAssetViewUnavailableError();
    }
  } else if (role.viewAssetId !== null && role.viewAssetId !== undefined) {
    throw new StoryRoleAssetViewUnavailableError();
  }
  return {
    ...role,
    speechProfile: {
      ...role.speechProfile,
      habits: [...role.speechProfile.habits],
      dialogueExamples: role.speechProfile.dialogueExamples.map((example) => ({
        ...example,
      })),
    },
    createdAt: new Date(role.createdAt),
    updatedAt: new Date(role.updatedAt),
    archivedAt: role.archivedAt === null ? null : new Date(role.archivedAt),
    coverAsset,
    viewAsset,
  };
}
