import type {
  KeysetPage,
  KeysetPageRequest,
} from '../../../platform/pagination/keyset-page.js';

export const ASSET_REPOSITORY = Symbol('ASSET_REPOSITORY');

export type AssetStatus = 'pending_upload' | 'uploaded' | 'failed' | 'deleted';

export interface AssetSnapshot {
  id: string;
  tenantId: string;
  projectId: string;
  uploadedByUserId: string;
  objectKey: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  checksum: string | null;
  status: AssetStatus;
  uploadExpiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssetRepository {
  create(asset: AssetSnapshot): Promise<AssetSnapshot>;
  findById(request: {
    tenantId: string;
    projectId: string;
    assetId: string;
  }): Promise<AssetSnapshot | null>;
  listForProject(request: {
    tenantId: string;
    projectId: string;
    page: KeysetPageRequest;
  }): Promise<KeysetPage<AssetSnapshot>>;
  transition(request: {
    tenantId: string;
    projectId: string;
    assetId: string;
    from: AssetStatus | readonly AssetStatus[];
    to: AssetStatus;
    completedAt?: Date | null;
    checksum?: string | null;
  }): Promise<AssetSnapshot | null>;
}
