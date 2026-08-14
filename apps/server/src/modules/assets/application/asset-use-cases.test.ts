import { describe, expect, it, vi } from 'vitest';

import {
  ObjectStorageObjectNotFoundError,
  ObjectStorageUnavailableError,
} from '../../../platform/object-storage/object-storage.js';
import { CompleteAssetUpload } from './complete-asset-upload.js';
import { CreateAssetUploadUrl } from './create-asset-upload-url.js';
import { DeleteAsset } from './delete-asset.js';
import {
  AssetUploadMissingObjectError,
  AssetUploadMismatchError,
} from './asset-errors.js';
import type { AssetSnapshot } from '../ports/asset-repository.js';

const TENANT_ID = 'team-1';
const PROJECT_ID = 'project-1';
const ACTOR_ID = 'user-1';
const ASSET_ID = 'asset-1';
const NOW = new Date('2026-08-10T02:00:00.000Z');
const EXPIRES_AT = new Date('2026-08-10T02:10:00.000Z');

describe('CreateAssetUploadUrl', () => {
  it('creates a tenant-scoped pending asset and presigned upload URL', async () => {
    const assets = {
      create: vi.fn(async (asset: AssetSnapshot) => asset),
      transition: vi.fn(),
    };
    const objectStorage = {
      createUploadUrl: vi.fn().mockResolvedValue({
        url: 'http://minio.test/upload',
        expiresAt: EXPIRES_AT.toISOString(),
        requiredHeaders: { 'content-type': 'image/png' },
      }),
    };
    const useCase = new CreateAssetUploadUrl(
      assets as never,
      projectAccess().projects as never,
      projectAccess().memberships as never,
      projectAccess().collaborators as never,
      objectStorage as never,
      {
        endpoint: 'http://minio.test',
        region: 'us-east-1',
        accessKey: 'access',
        secretKey: 'secret',
        bucket: 'assets',
        presignedUrlTtlSeconds: 600,
        forcePathStyle: true,
      },
      { now: vi.fn().mockResolvedValue(NOW) },
      { create: () => ASSET_ID },
    );

    await expect(
      useCase.execute({
        tenantId: TENANT_ID,
        actorUserId: ACTOR_ID,
        projectId: PROJECT_ID,
        fileName: ' cover.png ',
        contentType: 'image/png',
        byteSize: 2048,
      }),
    ).resolves.toEqual({
      asset: expect.objectContaining({
        id: ASSET_ID,
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        originalFileName: 'cover.png',
        status: 'pending_upload',
      }),
      uploadUrl: 'http://minio.test/upload',
      expiresAt: EXPIRES_AT.toISOString(),
      requiredHeaders: { 'content-type': 'image/png' },
    });
    expect(assets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey:
          'tenants/team-1/story-projects/project-1/assets/asset-1/original',
        uploadExpiresAt: EXPIRES_AT,
      }),
    );
    expect(objectStorage.createUploadUrl).toHaveBeenCalledWith({
      objectKey:
        'tenants/team-1/story-projects/project-1/assets/asset-1/original',
      contentType: 'image/png',
      contentLength: 2048,
      expiresInSeconds: 600,
    });
  });

  it('marks the asset failed when signing the upload URL fails', async () => {
    const assets = {
      create: vi.fn(async (asset: AssetSnapshot) => asset),
      transition: vi.fn().mockResolvedValue(null),
    };
    const objectStorage = {
      createUploadUrl: vi
        .fn()
        .mockRejectedValue(new ObjectStorageUnavailableError()),
    };
    const access = projectAccess();
    const useCase = new CreateAssetUploadUrl(
      assets as never,
      access.projects as never,
      access.memberships as never,
      access.collaborators as never,
      objectStorage as never,
      objectStorageConfig(),
      { now: vi.fn().mockResolvedValue(NOW) },
      { create: () => ASSET_ID },
    );

    await expect(
      useCase.execute({
        tenantId: TENANT_ID,
        actorUserId: ACTOR_ID,
        projectId: PROJECT_ID,
        fileName: 'cover.png',
        contentType: 'image/png',
        byteSize: 2048,
      }),
    ).rejects.toBeInstanceOf(ObjectStorageUnavailableError);
    expect(assets.transition).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
      from: 'pending_upload',
      to: 'failed',
    });
  });
});

describe('CompleteAssetUpload', () => {
  it('verifies the object metadata before marking the asset uploaded', async () => {
    const asset = pendingAsset();
    const completed = {
      ...asset,
      status: 'uploaded' as const,
      completedAt: NOW,
    };
    const assets = {
      findById: vi.fn().mockResolvedValue(asset),
      transition: vi.fn().mockResolvedValue(completed),
    };
    const objectStorage = {
      headObject: vi.fn().mockResolvedValue({
        contentType: asset.contentType,
        contentLength: asset.byteSize,
      }),
    };
    const access = projectAccess();
    const useCase = new CompleteAssetUpload(
      assets as never,
      access.projects as never,
      access.memberships as never,
      access.collaborators as never,
      objectStorage as never,
      { now: vi.fn().mockResolvedValue(NOW) },
    );

    await expect(useCase.execute(assetRequest())).resolves.toEqual({
      asset: expect.objectContaining({ status: 'uploaded', completedAt: NOW }),
    });
    expect(assets.transition).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
      from: 'pending_upload',
      to: 'uploaded',
      completedAt: NOW,
    });
  });

  it('marks the asset failed when the uploaded object is missing', async () => {
    const asset = pendingAsset();
    const assets = {
      findById: vi.fn().mockResolvedValue(asset),
      transition: vi.fn().mockResolvedValue(null),
    };
    const objectStorage = {
      headObject: vi
        .fn()
        .mockRejectedValue(
          new ObjectStorageObjectNotFoundError(asset.objectKey),
        ),
    };
    const access = projectAccess();
    const useCase = new CompleteAssetUpload(
      assets as never,
      access.projects as never,
      access.memberships as never,
      access.collaborators as never,
      objectStorage as never,
      { now: vi.fn().mockResolvedValue(NOW) },
    );

    await expect(useCase.execute(assetRequest())).rejects.toBeInstanceOf(
      AssetUploadMissingObjectError,
    );
    expect(assets.transition).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
      from: 'pending_upload',
      to: 'failed',
    });
  });

  it('marks the asset failed when object metadata does not match', async () => {
    const asset = pendingAsset();
    const assets = {
      findById: vi.fn().mockResolvedValue(asset),
      transition: vi.fn().mockResolvedValue(null),
    };
    const objectStorage = {
      headObject: vi.fn().mockResolvedValue({
        contentType: 'image/jpeg',
        contentLength: asset.byteSize,
      }),
    };
    const access = projectAccess();
    const useCase = new CompleteAssetUpload(
      assets as never,
      access.projects as never,
      access.memberships as never,
      access.collaborators as never,
      objectStorage as never,
      { now: vi.fn().mockResolvedValue(NOW) },
    );

    await expect(useCase.execute(assetRequest())).rejects.toBeInstanceOf(
      AssetUploadMismatchError,
    );
    expect(assets.transition).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'pending_upload', to: 'failed' }),
    );
  });

  it('is idempotent after the asset is already uploaded', async () => {
    const asset = { ...pendingAsset(), status: 'uploaded' as const };
    const assets = { findById: vi.fn().mockResolvedValue(asset) };
    const objectStorage = { headObject: vi.fn() };
    const access = projectAccess();
    const useCase = new CompleteAssetUpload(
      assets as never,
      access.projects as never,
      access.memberships as never,
      access.collaborators as never,
      objectStorage as never,
      { now: vi.fn() },
    );

    await expect(useCase.execute(assetRequest())).resolves.toEqual({
      asset: expect.objectContaining({ status: 'uploaded' }),
    });
    expect(objectStorage.headObject).not.toHaveBeenCalled();
  });
});

describe('DeleteAsset', () => {
  it('deletes the object and transitions the metadata', async () => {
    const asset = { ...pendingAsset(), status: 'uploaded' as const };
    const deleted = { ...asset, status: 'deleted' as const };
    const assets = {
      findById: vi.fn().mockResolvedValue(asset),
      transition: vi.fn().mockResolvedValue(deleted),
    };
    const objectStorage = {
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };
    const access = projectAccess();
    const useCase = new DeleteAsset(
      assets as never,
      access.projects as never,
      access.memberships as never,
      access.collaborators as never,
      objectStorage as never,
    );

    await expect(useCase.execute(assetRequest())).resolves.toEqual({
      asset: expect.objectContaining({ status: 'deleted' }),
    });
    expect(objectStorage.deleteObject).toHaveBeenCalledWith(asset.objectKey);
    expect(assets.transition).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
      from: ['pending_upload', 'uploaded', 'failed'],
      to: 'deleted',
    });
  });
});

function projectAccess() {
  return {
    projects: {
      findById: vi.fn().mockResolvedValue({
        id: PROJECT_ID,
        tenantId: TENANT_ID,
        spaceId: 'space-1',
        ownerUserId: ACTOR_ID,
        createdByUserId: ACTOR_ID,
        title: 'Project',
        visibility: 'private',
        status: 'active',
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    },
    memberships: {
      findActive: vi.fn().mockResolvedValue({
        id: 'membership-1',
        tenantId: TENANT_ID,
        userId: ACTOR_ID,
        role: 'member',
        joinedAt: NOW,
        removedAt: null,
      }),
    },
    collaborators: {
      findByProjectAndUserLocked: vi.fn().mockResolvedValue(null),
    },
  };
}

function pendingAsset(): AssetSnapshot {
  return {
    id: ASSET_ID,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    uploadedByUserId: ACTOR_ID,
    objectKey:
      'tenants/team-1/story-projects/project-1/assets/asset-1/original',
    originalFileName: 'cover.png',
    contentType: 'image/png',
    byteSize: 2048,
    checksum: null,
    status: 'pending_upload',
    uploadExpiresAt: EXPIRES_AT,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function assetRequest() {
  return {
    tenantId: TENANT_ID,
    actorUserId: ACTOR_ID,
    projectId: PROJECT_ID,
    assetId: ASSET_ID,
  };
}

function objectStorageConfig() {
  return {
    endpoint: 'http://minio.test',
    region: 'us-east-1',
    accessKey: 'access',
    secretKey: 'secret',
    bucket: 'assets',
    presignedUrlTtlSeconds: 600,
    forcePathStyle: true,
  };
}
