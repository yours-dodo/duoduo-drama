import { describe, expect, it } from 'vitest';

import { AssetUploadInvalidError } from './asset-errors.js';
import {
  assetObjectKey,
  MAX_ASSET_BYTES,
  validateAssetUpload,
} from './asset-upload-policy.js';

describe('asset upload policy', () => {
  it('normalizes a valid file name and keeps its metadata', () => {
    expect(
      validateAssetUpload({
        fileName: '  cover.webp  ',
        contentType: 'image/webp',
        byteSize: 2048,
      }),
    ).toEqual({
      fileName: 'cover.webp',
      contentType: 'image/webp',
      byteSize: 2048,
    });
  });

  it.each([
    { fileName: '', contentType: 'image/png', byteSize: 1 },
    { fileName: 'cover\n.webp', contentType: 'image/png', byteSize: 1 },
    { fileName: 'cover.png', contentType: 'application/pdf', byteSize: 1 },
    { fileName: 'cover.png', contentType: 'image/png', byteSize: 0 },
    {
      fileName: 'cover.png',
      contentType: 'image/png',
      byteSize: MAX_ASSET_BYTES + 1,
    },
    { fileName: 'cover.png', contentType: 'image/png', byteSize: 1.5 },
  ])(
    'rejects invalid metadata: $fileName / $contentType / $byteSize',
    (input) => {
      expect(() => validateAssetUpload(input)).toThrow(AssetUploadInvalidError);
    },
  );

  it('creates a tenant- and project-scoped object key', () => {
    expect(
      assetObjectKey({
        tenantId: 'team-1',
        projectId: 'project-1',
        assetId: 'asset-1',
      }),
    ).toBe('tenants/team-1/story-projects/project-1/assets/asset-1/original');
  });
});
