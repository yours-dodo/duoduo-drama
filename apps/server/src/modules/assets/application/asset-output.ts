import type { AssetSnapshot } from '../ports/asset-repository.js';

export function assetOutput(asset: AssetSnapshot) {
  return {
    id: asset.id,
    tenantId: asset.tenantId,
    projectId: asset.projectId,
    uploadedByUserId: asset.uploadedByUserId,
    originalFileName: asset.originalFileName,
    contentType: asset.contentType,
    byteSize: asset.byteSize,
    checksum: asset.checksum,
    status: asset.status,
    uploadExpiresAt: new Date(asset.uploadExpiresAt),
    completedAt:
      asset.completedAt === null ? null : new Date(asset.completedAt),
    createdAt: new Date(asset.createdAt),
    updatedAt: new Date(asset.updatedAt),
  };
}
